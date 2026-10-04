import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  addEntry,
  assignBoard,
  commitSeed,
  createDrawSeed,
  createTournament,
  drawOrder,
  freeBoards,
  nextMatch,
  previewChange,
  readyMatches,
  recordResult,
  recordWalkover,
  reinstate,
  removeEntry,
  resetMatch,
  resolveTournament,
  roundProgress,
  scoreWinner,
  startMatch,
  suggestBoards,
  TournamentError,
  verifySeed,
  withdraw,
} from "../lib/tournaments/engine.ts"
import type { MatchView, SlotSource, Tournament, TournamentFormat, TournamentSetup } from "../lib/tournaments/engine.ts"
import { bracketOrder } from "../lib/tournaments/draw.ts"

// Expected brackets, tables and places below are worked out by hand from the rules in
// docs/implementation/evidence/P6.01/ENGINE.md, not taken from the engine. Draw keys and lots
// are recomputed with node:crypto as an independent SHA-256.

// --- Helpers ---------------------------------------------------------------------------------

const field = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Spieler ${i + 1}` }))

// Seeded in entry order: p1 is seed 1, p2 seed 2, …
const make = (format: TournamentFormat, n: number, extra: Partial<TournamentSetup> = {}): Tournament =>
  createTournament({ format, participants: field(n), seeded: n, seed: "turnier-1", rules: { legsToWin: 3 }, ...extra })

const src = (s: SlotSource) =>
  s.type === "seed" ? `#${s.seed}` : s.type === "winner" ? `W ${s.match}` : s.type === "loser" ? `L ${s.match}` : `${s.group}${s.rank}`
const plan = (t: Tournament) => t.matches.map((m) => `${m.id} r${m.round}: ${src(m.slots[0])} v ${src(m.slots[1])}`)

const view = resolveTournament
const match = (t: Tournament, id: string) => {
  const m = view(t).match(id)
  assert.ok(m, `no match ${id}`)
  return m
}
const who = (t: Tournament, id: string) => match(t, id).slots.map((s) => s.participant)

// The given player wins the match, the loser takes `loserLegs` legs.
function win(t: Tournament, id: string, winner: string, loserLegs = 1): Tournament {
  const m = match(t, id)
  const slot = m.slots.findIndex((s) => s.participant === winner)
  assert.ok(slot >= 0, `${winner} does not play ${id} (${who(t, id).join(" v ")})`)
  const target = m.format.legsToWin
  return recordResult(t, id, { legs: slot === 0 ? [target, loserLegs] : [loserLegs, target] })
}

const seedNumber = (t: Tournament, id: string) => t.participants.findIndex((p) => p.id === id)
const favourite = (t: Tournament) => (m: MatchView) => {
  const [a, b] = m.slots.map((s) => s.participant!)
  return seedNumber(t, a) < seedNumber(t, b) ? a : b
}

// Plays every open match until nothing is left, the winner chosen per match.
function playAll(t: Tournament, choose: (m: MatchView, t: Tournament) => string): Tournament {
  for (let guard = 0; guard < 100000; guard++) {
    const open = view(t).matches.filter((m) => (m.state === "ready" || m.state === "live") && !m.affected)
    if (open.length === 0) return t
    for (const m of open) t = win(t, m.id, choose(m, t))
  }
  throw new Error("tournament does not end")
}

// Small deterministic random numbers for the property tests (mulberry32).
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
const coin = (rand: () => number) => (m: MatchView) => m.slots[rand() < 0.5 ? 0 : 1].participant!

const places = (t: Tournament) => Object.fromEntries(view(t).placements.map((p) => [p.participant, p.place === p.placeTo ? `${p.place}` : `${p.place}-${p.placeTo}`]))

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

const throwsCode = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof TournamentError && e.code === code, `expected ${code}`)

// --- Draw --------------------------------------------------------------------------------------

test("draw: the seed commitment is SHA-256 of the seed and can be checked", () => {
  assert.equal(commitSeed("abc"), sha("blueline-seed-v1\nabc"))
  assert.equal(verifySeed("abc", commitSeed("abc")), true)
  assert.equal(verifySeed("abc", commitSeed("abc").toUpperCase()), true)
  assert.equal(verifySeed("abd", commitSeed("abc")), false)
  const seed = createDrawSeed()
  assert.match(seed, /^[0-9a-f]{32}$/)
  assert.notEqual(seed, createDrawSeed())
})

test("draw: unseeded entries are ordered by SHA-256 draw keys, whatever order they were entered in", () => {
  const entries = field(8)
  const expected = [...entries].sort((a, b) => (sha(`blueline-draw-v1\nS\n${a.id}`) < sha(`blueline-draw-v1\nS\n${b.id}`) ? -1 : 1)).map((p) => p.id)
  assert.deepEqual(
    drawOrder(entries, "S").map((p) => p.id),
    expected,
  )
  assert.deepEqual(
    drawOrder([...entries].reverse(), "S").map((p) => p.id),
    expected,
  )
  // Another seed, another draw.
  assert.notDeepEqual(
    drawOrder(entries, "T").map((p) => p.id),
    expected,
  )
})

test("draw: seeded entries keep their places, the rest is drawn behind them", () => {
  const order = drawOrder(field(8), "S", 3).map((p) => p.id)
  assert.deepEqual(order.slice(0, 3), ["p1", "p2", "p3"])
  assert.deepEqual(
    [...order.slice(3)].sort(),
    ["p4", "p5", "p6", "p7", "p8"],
  )
})

test("draw: a late entry before the draw keeps everyone else's order; a withdrawal before it leaves no gap", () => {
  const setup: TournamentSetup = { format: "single", participants: field(7), seed: "S", rules: { legsToWin: 3 } }
  const before = createTournament(setup).participants.map((p) => p.id)
  const late = createTournament(addEntry(setup, { id: "late", name: "Nachmeldung" })).participants.map((p) => p.id)
  assert.equal(late.length, 8)
  assert.deepEqual(
    late.filter((id) => id !== "late"),
    before,
  )
  throwsCode(() => addEntry(setup, { id: "p1", name: "Doppelt" }), "duplicateParticipant")
  const fewer = removeEntry({ ...setup, seeded: 3 }, "p2")
  assert.equal(fewer.seeded, 2)
  assert.deepEqual(
    fewer.participants.map((p) => p.id),
    ["p1", "p3", "p4", "p5", "p6", "p7"],
  )
  throwsCode(() => removeEntry(setup, "nobody"), "unknownParticipant")
})

test("draw: the same setup always gives the same tournament, also after JSON", () => {
  const setup: TournamentSetup = { format: "double", participants: field(13), seed: "S", rules: { legsToWin: 3 } }
  const a = createTournament(setup)
  assert.deepEqual(createTournament(setup), a)
  const played = playAll(a, favourite(a))
  const copy = JSON.parse(JSON.stringify(played)) as Tournament
  assert.deepEqual(places(copy), places(played))
  assert.equal(view(copy).champion, view(played).champion)
})

test("bracket order: top seeds meet as late as possible", () => {
  assert.deepEqual(bracketOrder(2), [1, 2])
  assert.deepEqual(bracketOrder(4), [1, 4, 2, 3])
  assert.deepEqual(bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6])
  assert.deepEqual(bracketOrder(16), [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11])
})

// --- Single elimination ---------------------------------------------------------------------------

test("single elimination: brackets for 4, 5, 6, 8 and 13 players, byes to the top seeds", () => {
  assert.deepEqual(plan(make("single", 4)), ["K1-1 r1: #1 v #4", "K1-2 r1: #2 v #3", "K2-1 r2: W K1-1 v W K1-2"])
  // 5 in a bracket of 8: seeds 1, 2 and 3 have byes and start in round 2.
  assert.deepEqual(plan(make("single", 5)), ["K1-2 r1: #4 v #5", "K2-1 r2: #1 v W K1-2", "K2-2 r2: #2 v #3", "K3-1 r3: W K2-1 v W K2-2"])
  assert.deepEqual(plan(make("single", 6)), [
    "K1-2 r1: #4 v #5",
    "K1-4 r1: #3 v #6",
    "K2-1 r2: #1 v W K1-2",
    "K2-2 r2: #2 v W K1-4",
    "K3-1 r3: W K2-1 v W K2-2",
  ])
  assert.deepEqual(plan(make("single", 8)), [
    "K1-1 r1: #1 v #8",
    "K1-2 r1: #4 v #5",
    "K1-3 r1: #2 v #7",
    "K1-4 r1: #3 v #6",
    "K2-1 r2: W K1-1 v W K1-2",
    "K2-2 r2: W K1-3 v W K1-4",
    "K3-1 r3: W K2-1 v W K2-2",
  ])
  // 13 in a bracket of 16: byes for seeds 1, 2 and 3.
  assert.deepEqual(plan(make("single", 13)), [
    "K1-2 r1: #8 v #9",
    "K1-3 r1: #4 v #13",
    "K1-4 r1: #5 v #12",
    "K1-6 r1: #7 v #10",
    "K1-8 r1: #6 v #11",
    "K2-1 r2: #1 v W K1-2",
    "K2-2 r2: W K1-3 v W K1-4",
    "K2-3 r2: #2 v W K1-6",
    "K2-4 r2: #3 v W K1-8",
    "K3-1 r3: W K2-1 v W K2-2",
    "K3-2 r3: W K2-3 v W K2-4",
    "K4-1 r4: W K3-1 v W K3-2",
  ])
  const final = make("single", 13).matches.filter((m) => m.final)
  assert.deepEqual(
    final.map((m) => m.id),
    ["K4-1"],
  )
})

test("single elimination: no bye is ever a match; players with a bye are ready in round 2", () => {
  for (const n of [3, 5, 6, 7, 9, 13, 17, 31, 33, 100, 127]) {
    const t = make("single", n)
    const size = 2 ** Math.ceil(Math.log2(n))
    assert.equal(t.matches.length, n - 1, `${n}: one match per player knocked out`)
    assert.equal(t.matches.filter((m) => m.round === 1).length, n - size / 2, `${n}: first-round matches`)
    const v = view(t)
    assert.ok(v.matches.every((m) => m.state === "ready" || m.state === "pending"))
    // Every seed with a bye already sits in a round-2 match.
    for (let seed = 1; seed <= size - n; seed++) {
      const second = v.matches.find((m) => m.round === 2 && m.slots.some((s) => s.participant === `p${seed}`))
      assert.ok(second, `${n}: seed ${seed} starts in round 2`)
    }
  }
})

test("single elimination: favourites win, places are shared per round", () => {
  let t = make("single", 8)
  t = playAll(t, favourite(t))
  assert.deepEqual(who(t, "K2-1"), ["p1", "p4"])
  assert.deepEqual(who(t, "K2-2"), ["p2", "p3"])
  assert.deepEqual(who(t, "K3-1"), ["p1", "p2"])
  const v = view(t)
  assert.equal(v.champion, "p1")
  assert.equal(v.complete, true)
  assert.deepEqual(places(t), { p1: "1", p2: "2", p3: "3-4", p4: "3-4", p5: "5-8", p6: "5-8", p7: "5-8", p8: "5-8" })
  assert.equal(v.status.p1, "champion")
  assert.equal(v.status.p8, "eliminated")
})

test("single elimination: places with byes (5 and 13 players)", () => {
  let five = make("single", 5)
  five = playAll(five, favourite(five))
  assert.deepEqual(places(five), { p1: "1", p2: "2", p3: "3-4", p4: "3-4", p5: "5" })
  let thirteen = make("single", 13)
  thirteen = playAll(thirteen, favourite(thirteen))
  assert.deepEqual(places(thirteen), {
    p1: "1",
    p2: "2",
    p3: "3-4",
    p4: "3-4",
    p5: "5-8",
    p6: "5-8",
    p7: "5-8",
    p8: "5-8",
    p9: "9-13",
    p10: "9-13",
    p11: "9-13",
    p12: "9-13",
    p13: "9-13",
  })
})

test("single elimination: a place is known as soon as a player is out", () => {
  let t = make("single", 8)
  t = win(t, "K1-1", "p8")
  assert.deepEqual(places(t), { p1: "5-8" })
  assert.equal(view(t).status.p1, "eliminated")
  assert.equal(view(t).champion, null)
})

test("single elimination: the final can be longer", () => {
  let t = make("single", 4, { rules: { legsToWin: 3, final: { legsToWin: 5 } } })
  t = win(win(t, "K1-1", "p1"), "K1-2", "p2")
  assert.deepEqual(match(t, "K2-1").format, { legsToWin: 5 })
  throwsCode(() => recordResult(t, "K2-1", { legs: [3, 1] }), "invalidScore")
  t = recordResult(t, "K2-1", { legs: [4, 5] })
  assert.equal(view(t).champion, "p2")
})

// --- Double elimination -------------------------------------------------------------------------

test("double elimination: plan for 4 players", () => {
  assert.deepEqual(plan(make("double", 4)), [
    "W1-1 r1: #1 v #4",
    "W1-2 r1: #2 v #3",
    "L1-1 r1: L W1-1 v L W1-2",
    "W2-1 r2: W W1-1 v W W1-2",
    "L2-1 r2: W L1-1 v L W2-1",
    "GF r1: W W2-1 v W L2-1",
    "GF2 r2: W W2-1 v W L2-1",
  ])
})

test("double elimination: plan for 8 players, losers of W2 come in crossed", () => {
  assert.deepEqual(plan(make("double", 8)), [
    "W1-1 r1: #1 v #8",
    "W1-2 r1: #4 v #5",
    "W1-3 r1: #2 v #7",
    "W1-4 r1: #3 v #6",
    "L1-1 r1: L W1-1 v L W1-2",
    "L1-2 r1: L W1-3 v L W1-4",
    "W2-1 r2: W W1-1 v W W1-2",
    "W2-2 r2: W W1-3 v W W1-4",
    "L2-1 r2: W L1-1 v L W2-2",
    "L2-2 r2: W L1-2 v L W2-1",
    "L3-1 r3: W L2-1 v W L2-2",
    "W3-1 r3: W W2-1 v W W2-2",
    "L4-1 r4: W L3-1 v L W3-1",
    "GF r1: W W3-1 v W L4-1",
    "GF2 r2: W W3-1 v W L4-1",
  ])
})

test("double elimination: plan for 5 players, byes leave no empty losers' matches", () => {
  assert.deepEqual(plan(make("double", 5)), [
    "W1-2 r1: #4 v #5",
    "W2-1 r2: #1 v W W1-2",
    "W2-2 r2: #2 v #3",
    "L2-1 r1: L W1-2 v L W2-2",
    "L3-1 r2: W L2-1 v L W2-1",
    "W3-1 r3: W W2-1 v W W2-2",
    "L4-1 r3: W L3-1 v L W3-1",
    "GF r1: W W3-1 v W L4-1",
    "GF2 r2: W W3-1 v W L4-1",
  ])
  assert.deepEqual(
    plan(make("double", 5, { grandFinalReset: false })).slice(-1),
    ["GF r1: W W3-1 v W L4-1"],
  )
})

test("double elimination: plan for 6 players, byes for seeds 1 and 2", () => {
  // Bracket of 8: W1-1 (1 v 8) and W1-3 (2 v 7) are byes, so L1 has nobody to pair: the losers of
  // W1-2 and W1-4 go straight to L2 (shown as losers' round 1), crossed against the losers of W2.
  assert.deepEqual(plan(make("double", 6)), [
    "W1-2 r1: #4 v #5",
    "W1-4 r1: #3 v #6",
    "W2-1 r2: #1 v W W1-2",
    "W2-2 r2: #2 v W W1-4",
    "L2-1 r1: L W1-2 v L W2-2",
    "L2-2 r1: L W1-4 v L W2-1",
    "L3-1 r2: W L2-1 v W L2-2",
    "W3-1 r3: W W2-1 v W W2-2",
    "L4-1 r3: W L3-1 v L W3-1",
    "GF r1: W W3-1 v W L4-1",
    "GF2 r2: W W3-1 v W L4-1",
  ])
})

test("double elimination: plan for 13 players in a bracket of 16", () => {
  // Byes for seeds 1, 2 and 3 (W1-1, W1-5, W1-7). Only L1-2 keeps two players; the other first
  // losers' matches pass the loser of W1-2, W1-6 and W1-8 on to L2. Drops in L2 and L4 are
  // crossed in pairs; the loser of the winners' final meets the losers' survivor in L6.
  assert.deepEqual(plan(make("double", 13)), [
    "W1-2 r1: #8 v #9",
    "W1-3 r1: #4 v #13",
    "W1-4 r1: #5 v #12",
    "W1-6 r1: #7 v #10",
    "W1-8 r1: #6 v #11",
    "L1-2 r1: L W1-3 v L W1-4",
    "W2-1 r2: #1 v W W1-2",
    "W2-2 r2: W W1-3 v W W1-4",
    "W2-3 r2: #2 v W W1-6",
    "W2-4 r2: #3 v W W1-8",
    "L2-1 r2: L W1-2 v L W2-2",
    "L2-2 r2: W L1-2 v L W2-1",
    "L2-3 r2: L W1-6 v L W2-4",
    "L2-4 r2: L W1-8 v L W2-3",
    "L3-1 r3: W L2-1 v W L2-2",
    "L3-2 r3: W L2-3 v W L2-4",
    "W3-1 r3: W W2-1 v W W2-2",
    "W3-2 r3: W W2-3 v W W2-4",
    "L4-1 r4: W L3-1 v L W3-2",
    "L4-2 r4: W L3-2 v L W3-1",
    "L5-1 r5: W L4-1 v W L4-2",
    "W4-1 r4: W W3-1 v W W3-2",
    "L6-1 r6: W L5-1 v L W4-1",
    "GF r1: W W4-1 v W L6-1",
    "GF2 r2: W W4-1 v W L6-1",
  ])
  // Every player but the champion can lose twice: 2 · 13 − 2 matches, plus the reset.
  assert.equal(make("double", 13).matches.length, 25)
})

test("double elimination: 8 players played through by hand; the crossing avoids the rematch 4 v 5", () => {
  let t = make("double", 8)
  t = win(t, "W1-1", "p1")
  t = win(t, "W1-2", "p5")
  t = win(t, "W1-3", "p2")
  t = win(t, "W1-4", "p3")
  assert.deepEqual(who(t, "L1-1"), ["p8", "p4"])
  assert.deepEqual(who(t, "L1-2"), ["p7", "p6"])
  t = win(t, "L1-1", "p4")
  t = win(t, "L1-2", "p6")
  t = win(t, "W2-1", "p1")
  t = win(t, "W2-2", "p3")
  // In uncrossed order p4 would meet p5, who just beat them in W1-2.
  assert.deepEqual(who(t, "L2-1"), ["p4", "p2"])
  assert.deepEqual(who(t, "L2-2"), ["p6", "p5"])
  t = win(t, "L2-1", "p2")
  t = win(t, "L2-2", "p5")
  assert.deepEqual(who(t, "L3-1"), ["p2", "p5"])
  t = win(t, "L3-1", "p2")
  t = win(t, "W3-1", "p1")
  assert.deepEqual(who(t, "L4-1"), ["p2", "p3"])
  t = win(t, "L4-1", "p3")
  assert.deepEqual(who(t, "GF"), ["p1", "p3"])
  t = win(t, "GF", "p1")
  const v = view(t)
  assert.equal(match(t, "GF2").state, "void")
  assert.equal(v.champion, "p1")
  assert.equal(v.complete, true)
  assert.deepEqual(places(t), { p1: "1", p3: "2", p2: "3", p5: "4", p4: "5-6", p6: "5-6", p7: "7-8", p8: "7-8" })
})

function fourToGrandFinal() {
  let t = make("double", 4)
  t = win(t, "W1-1", "p1")
  t = win(t, "W1-2", "p2")
  t = win(t, "L1-1", "p3")
  t = win(t, "W2-1", "p1")
  t = win(t, "L2-1", "p3")
  assert.deepEqual(who(t, "GF"), ["p1", "p3"])
  return t
}

test("double elimination: no reset when the winners' champion wins the grand final", () => {
  const t = win(fourToGrandFinal(), "GF", "p1")
  assert.equal(match(t, "GF2").state, "void")
  assert.equal(view(t).champion, "p1")
  assert.equal(view(t).complete, true)
  assert.deepEqual(places(t), { p1: "1", p3: "2", p2: "3", p4: "4" })
})

test("double elimination: reset when the losers' bracket player wins the grand final", () => {
  let t = win(fourToGrandFinal(), "GF", "p3")
  const reset = match(t, "GF2")
  assert.equal(reset.state, "ready")
  assert.deepEqual(who(t, "GF2"), ["p1", "p3"])
  assert.equal(view(t).champion, null)
  // Nobody is placed second before the reset is played.
  assert.deepEqual(places(t), { p2: "3", p4: "4" })
  const champion = win(t, "GF2", "p1")
  assert.equal(view(champion).champion, "p1")
  assert.deepEqual(places(champion), { p1: "1", p3: "2", p2: "3", p4: "4" })
  t = win(t, "GF2", "p3")
  assert.equal(view(t).champion, "p3")
  assert.deepEqual(places(t), { p3: "1", p1: "2", p2: "3", p4: "4" })
})

test("double elimination: without reset one grand final decides", () => {
  let t = make("double", 4, { grandFinalReset: false })
  t = win(win(win(win(win(t, "W1-1", "p1"), "W1-2", "p2"), "L1-1", "p3"), "W2-1", "p1"), "L2-1", "p3")
  t = win(t, "GF", "p3")
  assert.equal(view(t).match("GF2"), undefined)
  assert.equal(view(t).champion, "p3")
  assert.deepEqual(places(t), { p3: "1", p1: "2", p2: "3", p4: "4" })
})

test("double elimination: no champion while a played reset waits after a grand final correction", () => {
  let t = win(win(fourToGrandFinal(), "GF", "p3"), "GF2", "p3")
  assert.equal(view(t).champion, "p3")
  // The grand final is corrected: p1 won it, so the reset was not needed, but it was played.
  t = win(t, "GF", "p1")
  const reset = match(t, "GF2")
  assert.deepEqual([reset.state, reset.affected], ["finished", true])
  assert.equal(view(t).champion, null)
  assert.equal(view(t).complete, false)
  assert.equal(view(t).status.p1, "active")
  // p3 has lost twice now, so second place is fixed; first is not, while GF2 waits.
  assert.deepEqual(places(t), { p3: "2", p2: "3", p4: "4" })
  // The organizer takes the reset back: it is not needed, the tournament is complete.
  t = resetMatch(t, "GF2")
  assert.equal(match(t, "GF2").state, "void")
  assert.equal(view(t).champion, "p1")
  assert.equal(view(t).complete, true)
  assert.deepEqual(places(t), { p1: "1", p3: "2", p2: "3", p4: "4" })
})

test("double elimination: a no-show loses one match and plays on in the losers' bracket", () => {
  let t = make("double", 4)
  t = recordWalkover(t, "W1-1", "p1", "noShow")
  const m = match(t, "W1-1")
  assert.equal(m.state, "walkover")
  assert.equal(m.walkover, "noShow")
  assert.equal(m.score, null)
  assert.equal(m.winner, "p1")
  t = win(t, "W1-2", "p2")
  assert.deepEqual(who(t, "L1-1"), ["p4", "p3"])
  assert.equal(match(t, "L1-1").state, "ready")
  assert.equal(view(t).status.p4, "active")
})

test("double elimination: a dropped player never meets a winners' bracket opponent in the first losers' match", () => {
  // Full fields, every drop except the loser of the winners' final. With byes the losers' bracket
  // is shorter and a rematch can be unavoidable: with 5 players the loser of 4 v 5 meets the
  // losers of both second-round matches, and either of them can be the player who beat them.
  for (const n of [8, 16, 32, 64]) {
    const rand = random(n)
    for (let run = 0; run < 25; run++) {
      const t = playAll(make("double", n), coin(rand))
      const v = view(t)
      const met = new Set<string>()
      const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
      for (const m of v.matches) if (m.bracket === "winners") met.add(pair(m.slots[0].participant!, m.slots[1].participant!))
      const winnersFinal = v.matches.filter((m) => m.bracket === "winners").at(-1)!.id
      for (const m of v.matches) {
        if (m.bracket !== "losers") continue
        // The first losers' match of a player who just dropped: a slot taken from a winners' match.
        const fromWinners = m.slots.some((s) => s.source.type === "loser" && s.source.match.startsWith("W") && s.source.match !== winnersFinal)
        if (!fromWinners) continue
        assert.ok(!met.has(pair(m.slots[0].participant!, m.slots[1].participant!)), `${n} players, ${m.id}: rematch right after the drop`)
      }
    }
  }
})

// --- Round robin --------------------------------------------------------------------------------

test("round robin: circle method for 4 players", () => {
  assert.deepEqual(plan(make("roundRobin", 4)), [
    "R1-1 r1: #1 v #4",
    "R1-2 r1: #2 v #3",
    "R2-1 r2: #1 v #3",
    "R2-2 r2: #2 v #4",
    "R3-1 r3: #1 v #2",
    "R3-2 r3: #3 v #4",
  ])
})

test("round robin: 5 players, one rests each round", () => {
  const t = make("roundRobin", 5)
  assert.deepEqual(plan(t), [
    "R1-1 r1: #2 v #5",
    "R1-2 r1: #3 v #4",
    "R2-1 r2: #1 v #5",
    "R2-2 r2: #2 v #3",
    "R3-1 r3: #1 v #4",
    "R3-2 r3: #3 v #5",
    "R4-1 r4: #1 v #3",
    "R4-2 r4: #2 v #4",
    "R5-1 r5: #1 v #2",
    "R5-2 r5: #4 v #5",
  ])
  assert.deepEqual(
    t.rests.map((r) => `${r.round}:${r.participant}`),
    ["1:p1", "2:p4", "3:p2", "4:p5", "5:p3"],
  )
})

test("round robin: everyone meets everyone once, or twice with sides swapped", () => {
  for (let n = 2; n <= 14; n++) {
    for (const double of [false, true]) {
      const t = make("roundRobin", n, { doubleRoundRobin: double })
      const meetings = new Map<string, string[]>()
      const games = new Map<number, number>()
      for (const m of t.matches) {
        const [a, b] = m.slots.map((s) => (s.type === "seed" ? s.seed : 0))
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`
        meetings.set(key, [...(meetings.get(key) ?? []), `${a}-${b}`])
        games.set(a, (games.get(a) ?? 0) + 1)
        games.set(b, (games.get(b) ?? 0) + 1)
      }
      assert.equal(meetings.size, (n * (n - 1)) / 2, `${n}: every pair`)
      for (const [key, list] of meetings) {
        assert.equal(list.length, double ? 2 : 1, `${n}: ${key}`)
        if (double) assert.notEqual(list[0], list[1], `${n}: ${key} with sides swapped`)
      }
      for (let s = 1; s <= n; s++) assert.equal(games.get(s), double ? 2 * (n - 1) : n - 1)
      // Nobody plays twice in one round.
      const rounds = new Map<number, Set<number>>()
      for (const m of t.matches) {
        const seen = rounds.get(m.round) ?? new Set()
        for (const s of m.slots) {
          const seed = s.type === "seed" ? s.seed : 0
          assert.ok(!seen.has(seed), `${n}: seed ${seed} twice in round ${m.round}`)
          seen.add(seed)
        }
        rounds.set(m.round, seen)
      }
    }
  }
})

// Enters results by pair: "a-b" → [legs of a, legs of b].
function enter(t: Tournament, results: Record<string, [number, number]>): Tournament {
  for (const [pair, [x, y]] of Object.entries(results)) {
    const [a, b] = pair.split("-")
    const m = view(t).matches.find((v) => v.slots[0].participant === a && v.slots[1].participant === b)
    const n = view(t).matches.find((v) => v.slots[0].participant === b && v.slots[1].participant === a)
    if (m) t = recordResult(t, m.id, { legs: [x, y] })
    else if (n) t = recordResult(t, n.id, { legs: [y, x] })
    else throw new Error(`no match ${pair}`)
  }
  return t
}
const table = (t: Tournament, group = 0) => view(t).standings[group].rows.map((r) => `${r.participant} ${r.points}P ${r.legsFor}:${r.legsAgainst} ${r.decidedBy ?? "-"}`)

test("round robin table: points first, then leg difference", () => {
  const t = enter(make("roundRobin", 4), { "p1-p4": [3, 0], "p2-p3": [3, 2], "p1-p3": [1, 3], "p2-p4": [3, 1], "p1-p2": [3, 0], "p3-p4": [2, 3] })
  assert.deepEqual(table(t), ["p1 4P 7:3 -", "p2 4P 6:6 legDifference", "p3 2P 7:7 points", "p4 2P 4:8 legDifference"])
  assert.equal(view(t).standings[0].complete, true)
  assert.equal(view(t).champion, "p1")
  assert.deepEqual(places(t), { p1: "1", p2: "2", p3: "3", p4: "4" })
})

test("round robin table: legs won before head-to-head", () => {
  // Three players, one win each. p1 and p2 both +1 in legs; p1 won 5, p2 won 4.
  const t = enter(make("roundRobin", 3), { "p1-p2": [3, 1], "p1-p3": [2, 3], "p2-p3": [3, 0] })
  assert.deepEqual(table(t), ["p1 2P 5:4 -", "p2 2P 4:3 legsWon", "p3 2P 3:5 legDifference"])
})

test("round robin table: head-to-head when points, legs and legs won are level", () => {
  const t = enter(make("roundRobin", 4), { "p1-p2": [3, 2], "p1-p3": [2, 3], "p1-p4": [3, 0], "p2-p3": [3, 0], "p2-p4": [3, 2], "p3-p4": [1, 3] })
  assert.deepEqual(table(t), ["p1 4P 8:5 -", "p2 4P 8:5 headToHead", "p4 2P 5:7 points", "p3 2P 4:8 legDifference"])
})

test("round robin table: the lot from the draw seed decides a circular tie", () => {
  // p1 beats p2, p2 beats p3, p3 beats p1, all 3:1; everyone beats p4 3:1.
  const t = enter(make("roundRobin", 4), { "p1-p2": [3, 1], "p2-p3": [3, 1], "p1-p3": [1, 3], "p1-p4": [3, 1], "p2-p4": [3, 1], "p3-p4": [3, 1] })
  const lot = (id: string) => sha(`blueline-lot-v1\nturnier-1\n${id}`)
  const expected = ["p1", "p2", "p3"].sort((a, b) => (lot(a) < lot(b) ? -1 : 1))
  assert.deepEqual(
    view(t).standings[0].rows.map((r) => r.participant),
    [...expected, "p4"],
  )
  assert.deepEqual(
    view(t).standings[0].rows.map((r) => r.decidedBy),
    [null, "lot", "lot", "points"],
  )
})

test("round robin table: head-to-head step by step — whoever is still level is compared again among themselves", () => {
  // p1–p4: 4 points and 8:8 legs each; p5: 4 points and 7:7, fewer legs won. Wins among p1–p4:
  // p1 2 (p2, p3), p2 2 (p3, p4), p3 1 (p4), p4 1 (p1). The first step splits {p1, p2} from
  // {p3, p4}; the second compares each pair alone, so their direct match decides: p1 beat p2, p3
  // beat p4. The lot never decides, whatever the draw seed.
  const results: Record<string, [number, number]> = {
    "p1-p2": [3, 2],
    "p1-p3": [3, 0],
    "p1-p4": [1, 3],
    "p2-p3": [3, 2],
    "p2-p4": [3, 0],
    "p3-p4": [3, 2],
    "p1-p5": [1, 3],
    "p2-p5": [0, 3],
    "p3-p5": [3, 0],
    "p4-p5": [3, 1],
  }
  for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"])
    assert.deepEqual(
      table(enter(make("roundRobin", 5, { seed }), results)),
      ["p1 4P 8:8 -", "p2 4P 8:8 headToHead", "p3 4P 8:8 headToHead", "p4 4P 8:8 headToHead", "p5 4P 7:7 legsWon"],
      seed,
    )
})

test("round robin table: set difference comes before leg difference", () => {
  // Sets to 2, legs to 2. One win each; by legs p3 (+1) would be above p1 (−3).
  let t = make("roundRobin", 3, { rules: { legsToWin: 2, setsToWin: 2 } })
  const set = (id: string, legs: [number, number], sets: [number, number]) => (t = recordResult(t, id, { legs, sets }))
  const id = (a: string, b: string) => view(t).matches.find((m) => m.slots[0].participant === a && m.slots[1].participant === b)!.id
  set(id("p1", "p2"), [4, 4], [2, 1])
  set(id("p2", "p3"), [4, 2], [2, 0])
  set(id("p1", "p3"), [2, 5], [1, 2])
  const rows = view(t).standings[0].rows
  assert.deepEqual(
    rows.map((r) => `${r.participant} ${r.setsFor}:${r.setsAgainst} ${r.legsFor}:${r.legsAgainst} ${r.decidedBy ?? "-"}`),
    ["p2 3:2 8:6 -", "p1 3:3 6:9 sets", "p3 2:3 7:6 sets"],
  )
})

test("scores: legs and sets have to be able to end the match", () => {
  const legs = { legsToWin: 3 }
  assert.equal(scoreWinner(legs, { legs: [3, 2] }), 0)
  assert.equal(scoreWinner(legs, { legs: [0, 3] }), 1)
  for (const bad of [[3, 3], [2, 1], [4, 1], [3, -1], [3, 1.5]] as [number, number][])
    assert.throws(() => scoreWinner(legs, { legs: bad }), TournamentError, JSON.stringify(bad))
  assert.throws(() => scoreWinner(legs, { legs: [3, 1], sets: [1, 0] }), TournamentError)
  const sets = { legsToWin: 3, setsToWin: 3 }
  assert.equal(scoreWinner(sets, { legs: [9, 0], sets: [3, 0] }), 0)
  assert.equal(scoreWinner(sets, { legs: [13, 12], sets: [3, 2] }), 0)
  assert.equal(scoreWinner(sets, { legs: [10, 11], sets: [2, 3] }), 1)
  assert.throws(() => scoreWinner(sets, { legs: [8, 0], sets: [3, 0] }), TournamentError)
  assert.throws(() => scoreWinner(sets, { legs: [9, 7], sets: [3, 0] }), TournamentError)
  assert.throws(() => scoreWinner(sets, { legs: [9, 3], sets: [3, 3] }), TournamentError)
  assert.throws(() => scoreWinner(sets, { legs: [9, 3] }), TournamentError)
})

// --- Groups then knockout -----------------------------------------------------------------------

test("groups: snake seeding, round robin in each group, cross-over A1–B2 into the knockout", () => {
  const t = make("groups", 8, { groups: { count: 2, advance: 2 } })
  assert.deepEqual(t.groups, [
    { label: "A", members: ["p1", "p4", "p5", "p8"] },
    { label: "B", members: ["p2", "p3", "p6", "p7"] },
  ])
  assert.deepEqual(plan(t), [
    "GA1-1 r1: #1 v #8",
    "GA1-2 r1: #4 v #5",
    "GB1-1 r1: #2 v #7",
    "GB1-2 r1: #3 v #6",
    "GA2-1 r2: #1 v #5",
    "GA2-2 r2: #4 v #8",
    "GB2-1 r2: #2 v #6",
    "GB2-2 r2: #3 v #7",
    "GA3-1 r3: #1 v #4",
    "GA3-2 r3: #5 v #8",
    "GB3-1 r3: #2 v #3",
    "GB3-2 r3: #6 v #7",
    "K1-1 r1: A1 v B2",
    "K1-2 r1: B1 v A2",
    "K2-1 r2: W K1-1 v W K1-2",
  ])
})

test("groups: four groups — each runner-up in the other half from its group winner", () => {
  const t = make("groups", 16, { groups: { count: 4, advance: 2 } })
  assert.deepEqual(
    t.groups.map((g) => `${g.label}: ${g.members.join(" ")}`),
    ["A: p1 p8 p9 p16", "B: p2 p7 p10 p15", "C: p3 p6 p11 p14", "D: p4 p5 p12 p13"],
  )
  assert.deepEqual(plan(t).slice(-7), [
    "K1-1 r1: A1 v B2",
    "K1-2 r1: D1 v C2",
    "K1-3 r1: B1 v A2",
    "K1-4 r1: C1 v D2",
    "K2-1 r2: W K1-1 v W K1-2",
    "K2-2 r2: W K1-3 v W K1-4",
    "K3-1 r3: W K2-1 v W K2-2",
  ])
  // Two groups with four going through: A1–B4, B2–A3, B1–A4, A2–B3.
  assert.deepEqual(plan(make("groups", 8, { groups: { count: 2, advance: 4 } })).slice(-7, -3), [
    "K1-1 r1: A1 v B4",
    "K1-2 r1: B2 v A3",
    "K1-3 r1: B1 v A4",
    "K1-4 r1: A2 v B3",
  ])
  // Three groups, two each: 6 in a bracket of 8, byes to A1 and B1.
  assert.deepEqual(plan(make("groups", 12, { groups: { count: 3, advance: 2 } })).slice(-5), [
    "K1-2 r1: B2 v C2",
    "K1-4 r1: C1 v A2",
    "K2-1 r2: A1 v W K1-2",
    "K2-2 r2: B1 v W K1-4",
    "K3-1 r3: W K2-1 v W K2-2",
  ])
})

function groupStage() {
  let t = make("groups", 8, { groups: { count: 2, advance: 2 } })
  t = enter(t, {
    "p1-p8": [3, 0],
    "p4-p5": [3, 1],
    "p1-p5": [3, 0],
    "p4-p8": [3, 0],
    "p1-p4": [3, 0],
    "p5-p8": [3, 2],
    "p2-p7": [3, 0],
    "p3-p6": [3, 0],
    "p2-p6": [3, 1],
    "p3-p7": [3, 0],
    "p2-p3": [1, 3],
    "p6-p7": [3, 2],
  })
  return t
}

test("groups: tables decide the knockout, then knockout places", () => {
  let t = groupStage()
  assert.deepEqual(
    view(t).standings.map((s) => s.rows.map((r) => r.participant).join(" ")),
    ["p1 p4 p5 p8", "p3 p2 p6 p7"],
  )
  assert.deepEqual(who(t, "K1-1"), ["p1", "p2"])
  assert.deepEqual(who(t, "K1-2"), ["p3", "p4"])
  // Out after the groups: places 5–6 for the thirds, 7–8 for the fourths.
  assert.deepEqual(places(t), { p5: "5-6", p6: "5-6", p8: "7-8", p7: "7-8" })
  t = win(win(t, "K1-1", "p1"), "K1-2", "p3")
  t = win(t, "K2-1", "p1")
  assert.equal(view(t).champion, "p1")
  assert.deepEqual(places(t), { p1: "1", p3: "2", p2: "3-4", p4: "3-4", p5: "5-6", p6: "5-6", p7: "7-8", p8: "7-8" })
})

test("groups: the knockout waits until a group is complete", () => {
  let t = make("groups", 8, { groups: { count: 2, advance: 2 } })
  t = enter(t, { "p1-p8": [3, 0], "p4-p5": [3, 1], "p1-p5": [3, 0], "p4-p8": [3, 0], "p1-p4": [3, 0] })
  assert.deepEqual(who(t, "K1-1"), [null, null])
  t = enter(t, { "p5-p8": [3, 2] })
  assert.deepEqual(who(t, "K1-1"), ["p1", null])
  assert.deepEqual(who(t, "K1-2"), [null, "p4"])
})

test("groups: a group result corrected after the knockout was played marks the knockout as affected", () => {
  let t = groupStage()
  t = win(win(win(t, "K1-1", "p1"), "K1-2", "p3"), "K2-1", "p1")
  const corrected = enter(t, { "p2-p3": [3, 1] })
  assert.deepEqual(
    view(corrected).standings[1].rows.map((r) => r.participant),
    ["p2", "p3", "p6", "p7"],
  )
  const semi = match(corrected, "K1-1")
  assert.equal(semi.affected, true)
  assert.equal(semi.state, "finished")
  assert.deepEqual(semi.recorded, ["p1", "p2"])
  assert.deepEqual(who(corrected, "K1-1"), ["p1", "p3"])
  // The recorded result stays, nothing after it moves on from it.
  assert.equal(semi.winner, null)
  assert.equal(match(corrected, "K2-1").affected, true)
  assert.equal(view(corrected).champion, null)
  assert.deepEqual(
    previewChange(t, corrected)
      .filter((c) => c.kind === "affected")
      .map((c) => c.match),
    ["K1-1", "K1-2", "K2-1"],
  )
})

// --- Results and corrections ------------------------------------------------------------------

test("corrections: a match not yet started simply gets the new player", () => {
  let t = make("single", 8)
  t = win(win(t, "K1-1", "p1"), "K1-2", "p4")
  assert.deepEqual(who(t, "K2-1"), ["p1", "p4"])
  const corrected = win(t, "K1-2", "p5", 2)
  assert.deepEqual(who(corrected, "K2-1"), ["p1", "p5"])
  assert.equal(match(corrected, "K2-1").state, "ready")
  assert.deepEqual(previewChange(t, corrected), [
    { match: "K1-2", kind: "result", before: ["p4", "p5"], after: ["p4", "p5"] },
    { match: "K2-1", kind: "players", before: ["p1", "p4"], after: ["p1", "p5"] },
  ])
})

test("corrections: a score correction with the same winner changes nothing after it", () => {
  let t = make("single", 4)
  t = win(win(t, "K1-1", "p1"), "K1-2", "p2")
  t = win(t, "K2-1", "p1")
  const corrected = win(t, "K1-1", "p1", 2)
  assert.deepEqual(match(corrected, "K1-1").score, { legs: [3, 2] })
  assert.deepEqual(
    previewChange(t, corrected).map((c) => `${c.match} ${c.kind}`),
    ["K1-1 result"],
  )
  assert.equal(view(corrected).champion, "p1")
})

test("corrections: a started match is marked affected, never silently re-staffed", () => {
  let t = make("single", 8)
  t = win(win(t, "K1-1", "p1"), "K1-2", "p4")
  t = startMatch(t, "K2-1", "Board 1")
  const corrected = win(t, "K1-2", "p5")
  const semi = match(corrected, "K2-1")
  assert.equal(semi.state, "live")
  assert.equal(semi.affected, true)
  assert.deepEqual(semi.recorded, ["p1", "p4"])
  assert.deepEqual(who(corrected, "K2-1"), ["p1", "p5"])
  assert.deepEqual(previewChange(t, corrected).find((c) => c.match === "K2-1")?.kind, "affected")
  // Nobody may be called to an affected match. Its new players wait for the decision; p4 is out.
  assert.deepEqual(nextMatch(view(corrected), "p5"), { match: semi, state: "waiting" })
  assert.deepEqual(nextMatch(view(corrected), "p1"), { match: semi, state: "waiting" })
  assert.equal(nextMatch(view(corrected), "p4"), null)
  throwsCode(() => assignBoard(corrected, "K2-1", "Board 2"), "notReady")
  // The organizer decides: start again with the new pairing …
  const again = resetMatch(corrected, "K2-1")
  assert.equal(match(again, "K2-1").state, "ready")
  assert.equal(match(again, "K2-1").affected, false)
  assert.deepEqual(previewChange(corrected, again), [{ match: "K2-1", kind: "resolved", before: ["p1", "p5"], after: ["p1", "p5"] }])
  // … or enter the result the new pairing played.
  const replayed = win(corrected, "K2-1", "p5")
  assert.equal(match(replayed, "K2-1").affected, false)
  assert.equal(match(replayed, "K2-1").winner, "p5")
  // Taking the correction back makes the running match fit again.
  const undone = win(corrected, "K1-2", "p4")
  assert.equal(match(undone, "K2-1").state, "live")
  assert.equal(match(undone, "K2-1").affected, false)
  assert.equal(match(undone, "K2-1").board, "Board 1")
  assert.deepEqual(
    previewChange(corrected, undone).map((c) => `${c.match} ${c.kind}`),
    ["K1-2 result", "K2-1 resolved"],
  )
})

test("corrections: everything after a finished match that no longer fits waits for the decision", () => {
  let t = make("single", 4)
  t = win(win(t, "K1-1", "p1"), "K1-2", "p2")
  t = win(t, "K2-1", "p1")
  const corrected = win(t, "K1-1", "p4")
  assert.equal(match(corrected, "K2-1").affected, true)
  assert.equal(view(corrected).champion, null)
  assert.equal(view(corrected).complete, false)
  // p1 is out after the correction; the final's players are not placed yet.
  assert.deepEqual(places(corrected), { p1: "3-4", p3: "3-4" })
})

test("corrections never change a started or finished match silently (property)", () => {
  const rand = random(7)
  const cases: [TournamentFormat, number, Partial<TournamentSetup>][] = [
    ["single", 13, {}],
    ["single", 16, {}],
    ["double", 9, {}],
    ["double", 16, {}],
    ["groups", 12, { groups: { count: 3, advance: 2 } }],
    ["roundRobin", 6, {}],
  ]
  for (const [format, n, extra] of cases) {
    for (let run = 0; run < 15; run++) {
      const done = playAll(make(format, n, extra), coin(rand))
      const before = view(done)
      const finished = before.matches.filter((m) => m.state === "finished")
      const target = finished[Math.floor(rand() * finished.length)]
      const loser = target.loser!
      const corrected = win(done, target.id, loser)
      const after = view(corrected)
      for (const m of before.matches) {
        if (m.id === target.id || !done.records[m.id]) continue
        assert.deepEqual(corrected.records[m.id], done.records[m.id], `${format} ${n}: record of ${m.id} unchanged`)
        const now = after.match(m.id)!
        const samePlayers = now.slots.every((s, i) => s.participant === m.slots[i].participant)
        if (samePlayers && !now.affected) assert.equal(now.winner, m.winner, `${format} ${n}: ${m.id} keeps its winner`)
        else assert.equal(now.affected, true, `${format} ${n}: ${m.id} no longer fits and must be marked`)
      }
    }
  }
})

// --- Withdrawals, disqualification, walkovers ---------------------------------------------------

test("withdrawal after the draw, before the start: the opponent goes through by walkover", () => {
  let t = withdraw(make("single", 4), "p4", "withdrawn")
  const m = match(t, "K1-1")
  assert.equal(m.state, "walkover")
  assert.equal(m.walkover, "withdrawn")
  assert.equal(m.winner, "p1")
  assert.equal(m.score, null)
  assert.deepEqual(who(t, "K2-1"), ["p1", null])
  assert.equal(view(t).status.p4, "withdrawn")
  assert.deepEqual(places(t), { p4: "3-4" })
  t = playAll(t, favourite(t))
  assert.equal(view(t).champion, "p1")
})

test("disqualification: walkovers like a withdrawal, but no place, and the others close up", () => {
  let t = withdraw(make("single", 4), "p4", "disqualified")
  t = playAll(t, favourite(t))
  assert.equal(view(t).status.p4, "disqualified")
  assert.deepEqual(places(t), { p1: "1", p2: "2", p3: "3" })
  // 8 players, p8 disqualified before the start: seven places, the first-round losers share 5–7.
  let eight = withdraw(make("single", 8), "p8", "disqualified")
  eight = playAll(eight, favourite(eight))
  assert.deepEqual(places(eight), { p1: "1", p2: "2", p3: "3-4", p4: "3-4", p5: "5-7", p6: "5-7", p7: "5-7" })
  // A withdrawal after a played match turns into a disqualification later.
  let later = win(make("single", 4), "K1-1", "p1")
  later = withdraw(later, "p1", "withdrawn")
  assert.equal(match(later, "K2-1").state, "pending")
  later = withdraw(later, "p1", "disqualified")
  assert.equal(view(later).status.p1, "disqualified")
  later = playAll(later, favourite(later))
  assert.equal(view(later).champion, "p2")
  // p2 wins the final by walkover. Nobody lost the final as a placed player: the losers of the
  // semi-finals share 2–3.
  assert.deepEqual(places(later), { p2: "1", p3: "2-3", p4: "2-3" })
})

test("withdrawal during a match: the live match is lost by walkover; reinstating takes it back", () => {
  let t = startMatch(make("single", 4), "K1-2")
  t = withdraw(t, "p3", "withdrawn")
  assert.equal(match(t, "K1-2").state, "walkover")
  assert.equal(match(t, "K1-2").winner, "p2")
  t = reinstate(t, "p3")
  assert.equal(match(t, "K1-2").state, "live")
  throwsCode(() => reinstate(t, "p3"), "notWithdrawn")
})

test("both players of a match withdrawn: nobody moves on, the next opponent has a free pass", () => {
  let t = make("single", 8)
  t = withdraw(withdraw(t, "p4", "withdrawn"), "p5", "withdrawn")
  const both = match(t, "K1-2")
  assert.equal(both.state, "walkover")
  assert.equal(both.winner, null)
  t = win(t, "K1-1", "p1")
  const next = match(t, "K2-1")
  assert.equal(next.state, "walkover")
  assert.equal(next.walkover, "bye")
  assert.equal(next.winner, "p1")
  assert.deepEqual(
    next.slots.map((s) => s.empty),
    [false, true],
  )
  t = playAll(t, favourite(t))
  assert.equal(view(t).champion, "p1")
  // Five out in round 1 (two in the empty match) share 4–8.
  assert.deepEqual(places(t), { p1: "1", p2: "2", p3: "3", p4: "4-8", p5: "4-8", p6: "4-8", p7: "4-8", p8: "4-8" })
})

test("withdrawal in double elimination: walkover in both brackets, out in the losers' bracket", () => {
  let t = withdraw(make("double", 4), "p4", "withdrawn")
  assert.equal(match(t, "W1-1").winner, "p1")
  t = win(t, "W1-2", "p2")
  assert.equal(match(t, "L1-1").state, "walkover")
  assert.equal(match(t, "L1-1").winner, "p3")
  t = playAll(t, favourite(t))
  assert.equal(view(t).champion, "p1")
  assert.deepEqual(places(t), { p1: "1", p2: "2", p3: "3", p4: "4" })
})

test("withdrawal in a round robin: open matches are walkovers, a win without legs; listed last", () => {
  let t = make("roundRobin", 4)
  t = enter(t, { "p1-p4": [3, 1], "p2-p3": [3, 2] })
  t = withdraw(t, "p4", "withdrawn")
  assert.equal(match(t, "R2-2").state, "walkover")
  assert.equal(match(t, "R2-2").winner, "p2")
  assert.equal(match(t, "R3-2").winner, "p3")
  t = enter(t, { "p1-p3": [3, 0], "p1-p2": [3, 1] })
  assert.deepEqual(table(t), ["p1 6P 9:2 -", "p2 4P 4:5 points", "p3 2P 2:6 points", "p4 0P 1:3 -"])
  assert.equal(view(t).standings[0].rows[3].inactive, true)
  assert.equal(view(t).champion, "p1")
})

test("withdrawal during the group stage: listed last, the next player goes through", () => {
  let t = make("groups", 8, { groups: { count: 2, advance: 2 } })
  // Group A is p1 p4 p5 p8. After round 1, p4 (who beat p5) withdraws.
  t = enter(t, { "p1-p8": [3, 0], "p4-p5": [3, 1] })
  t = withdraw(t, "p4", "withdrawn")
  assert.equal(t.withdrawals.p4.afterGroup, undefined)
  assert.equal(match(t, "GA2-2").walkover, "withdrawn")
  assert.equal(match(t, "GA2-2").winner, "p8")
  assert.equal(match(t, "GA3-1").winner, "p1")
  t = enter(t, { "p1-p5": [3, 0], "p5-p8": [3, 2] })
  // p1 6 points; p5 and p8 2 points and −4 legs each, p5 won more legs (4 to 2); p4 would be second
  // on 2 points and +2 legs, but is listed last.
  assert.deepEqual(table(t, 0), ["p1 6P 6:0 -", "p5 2P 4:8 points", "p8 2P 2:6 legsWon", "p4 2P 3:1 -"])
  assert.equal(view(t).standings[0].rows[3].inactive, true)
  t = enter(t, { "p2-p7": [3, 0], "p3-p6": [3, 0], "p2-p6": [3, 1], "p3-p7": [3, 0], "p2-p3": [1, 3], "p6-p7": [3, 2] })
  assert.deepEqual(who(t, "K1-1"), ["p1", "p2"])
  assert.deepEqual(who(t, "K1-2"), ["p3", "p5"])
  assert.deepEqual(places(t), { p8: "5-6", p6: "5-6", p4: "7-8", p7: "7-8" })
})

test("withdrawal after the group stage: the group place stays, the knockout match is a walkover", () => {
  let t = win(groupStage(), "K1-1", "p1")
  t = withdraw(t, "p1", "withdrawn")
  assert.equal(t.withdrawals.p1.afterGroup, true)
  // The tables and the knockout already played stay as they are.
  assert.deepEqual(
    view(t).standings.map((s) => s.rows.map((r) => r.participant).join(" ")),
    ["p1 p4 p5 p8", "p3 p2 p6 p7"],
  )
  assert.equal(view(t).standings[0].rows[0].inactive, false)
  assert.equal(match(t, "K1-1").affected, false)
  assert.equal(match(t, "K1-1").winner, "p1")
  t = win(t, "K1-2", "p3")
  const final = match(t, "K2-1")
  assert.deepEqual([final.state, final.walkover, final.winner], ["walkover", "withdrawn", "p3"])
  assert.equal(view(t).champion, "p3")
  assert.deepEqual(places(t), { p3: "1", p1: "2", p2: "3-4", p4: "3-4", p5: "5-6", p6: "5-6", p7: "7-8", p8: "7-8" })
  assert.equal(view(t).status.p1, "withdrawn")
  // After the end nobody can withdraw or be disqualified any more, and no withdrawal can be taken
  // back (that would reopen the final).
  throwsCode(() => withdraw(t, "p3", "disqualified"), "tournamentComplete")
  throwsCode(() => reinstate(t, "p1"), "tournamentComplete")
  // The knockout match a withdrawn player gave away takes no result either.
  const open = win(withdraw(win(groupStage(), "K1-1", "p1"), "p1", "withdrawn"), "K1-2", "p3")
  throwsCode(() => win(open, "K2-1", "p1"), "notReady")
})

test("a withdrawn or disqualified player cannot be entered as the winner of the matches the withdrawal gives away", () => {
  const t = withdraw(make("single", 4), "p4", "disqualified")
  const before = JSON.stringify(t)
  throwsCode(() => recordResult(t, "K1-1", { legs: [0, 3] }), "notReady")
  throwsCode(() => recordResult(t, "K1-1", { legs: [3, 0] }), "notReady")
  throwsCode(() => recordWalkover(t, "K1-1", "p4", "noShow"), "notReady")
  assert.equal(JSON.stringify(t), before)
  assert.deepEqual([match(t, "K1-1").state, match(t, "K1-1").winner], ["walkover", "p1"])
  // Withdrawn during a match: the live match is lost. If it was in fact played to the end, the
  // result goes in after taking the withdrawal back, and the withdrawal follows.
  let live = withdraw(startMatch(make("single", 4), "K1-2"), "p3", "withdrawn")
  throwsCode(() => win(live, "K1-2", "p3"), "notReady")
  live = withdraw(win(reinstate(live, "p3"), "K1-2", "p3"), "p3", "withdrawn")
  assert.deepEqual([match(live, "K1-2").state, match(live, "K1-2").winner], ["finished", "p3"])
  // A result entered before the withdrawal can still be corrected, either way.
  let played = withdraw(win(make("single", 4), "K1-1", "p1"), "p1", "withdrawn")
  played = win(played, "K1-1", "p4")
  assert.deepEqual(who(played, "K2-1"), ["p4", null])
  played = win(played, "K1-1", "p1", 2)
  assert.deepEqual(match(played, "K1-1").score, { legs: [3, 2] })
  assert.deepEqual(who(played, "K2-1"), ["p1", null])
})

test("nobody wins the tournament after withdrawing: a final won before waits for the organizer", () => {
  // The final was played; a correction marked it; meanwhile p1 was disqualified; then the
  // correction was taken back, so the final fits again with p1 as its winner.
  let t = win(win(win(make("single", 4), "K1-1", "p1"), "K1-2", "p2"), "K2-1", "p1")
  t = win(t, "K1-2", "p3")
  assert.equal(match(t, "K2-1").affected, true)
  t = withdraw(t, "p1", "disqualified")
  t = win(t, "K1-2", "p2")
  const final = match(t, "K2-1")
  assert.deepEqual([final.state, final.affected, final.winner], ["finished", true, null])
  assert.deepEqual(final.recorded, ["p1", "p2"])
  assert.equal(view(t).champion, null)
  assert.equal(view(t).complete, false)
  assert.equal(view(t).status.p1, "disqualified")
  assert.equal(view(t).status.p2, "active")
  assert.deepEqual(nextMatch(view(t), "p2"), { match: final, state: "waiting" })
  // The organizer decides: play it again, which p2 wins by walkover …
  const again = resetMatch(t, "K2-1")
  assert.deepEqual([match(again, "K2-1").state, match(again, "K2-1").walkover, view(again).champion], ["walkover", "withdrawn", "p2"])
  assert.deepEqual(places(again), { p2: "1", p3: "2-3", p4: "2-3" })
  // … or correct the final …
  assert.equal(view(win(t, "K2-1", "p2")).champion, "p2")
  // … or take the disqualification back.
  assert.equal(view(reinstate(t, "p1")).champion, "p1")
})

test("a withdrawn player has no next match, also where the opponent is not known yet", () => {
  let t = win(make("single", 4), "K1-1", "p1")
  assert.equal(nextMatch(view(t), "p1")?.state, "waiting")
  t = withdraw(t, "p1", "withdrawn")
  assert.equal(nextMatch(view(t), "p1"), null)
})

test("walkover in a round robin counts in the table without legs", () => {
  let t = make("roundRobin", 3)
  const id = view(t).matches.find((m) => m.slots[0].participant === "p2" && m.slots[1].participant === "p3")!.id
  t = recordWalkover(t, id, "p3", "retired")
  const row = view(t).standings[0].rows.find((r) => r.participant === "p3")!
  assert.deepEqual([row.played, row.wins, row.legsFor, row.legsAgainst], [1, 1, 0, 0])
  assert.equal(match(t, id).walkover, "retired")
})

// --- Boards and next match ---------------------------------------------------------------------

test("next match: live, ready, waiting or nothing", () => {
  let t = make("single", 4)
  assert.deepEqual(nextMatch(view(t), "p1"), { match: match(t, "K1-1"), state: "ready" })
  t = startMatch(t, "K1-2", "Board 2")
  assert.equal(nextMatch(view(t), "p2")?.state, "live")
  assert.equal(nextMatch(view(t), "p2")?.match.board, "Board 2")
  t = win(t, "K1-1", "p1")
  assert.deepEqual(nextMatch(view(t), "p1"), { match: match(t, "K2-1"), state: "waiting" })
  assert.equal(nextMatch(view(t), "p4"), null)
})

test("boards: one match per board, freed when the match ends; ready matches suggested without double-booking", () => {
  let t = make("roundRobin", 4)
  const boards = ["B1", "B2", "B3"]
  assert.deepEqual(suggestBoards(view(t), boards), [
    { match: "R1-1", board: "B1" },
    { match: "R1-2", board: "B2" },
  ])
  t = startMatch(t, "R1-1", "B1")
  throwsCode(() => assignBoard(t, "R1-2", "B1"), "boardBusy")
  throwsCode(() => startMatch(t, "R2-1"), "playerBusy")
  t = assignBoard(t, "R1-2", "B2")
  assert.equal(match(t, "R1-2").board, "B2")
  assert.equal(match(t, "R1-2").state, "ready")
  assert.deepEqual(freeBoards(view(t), boards), ["B3"])
  // Everyone of round 2 is playing or called.
  assert.deepEqual(suggestBoards(view(t), boards), [])
  t = win(t, "R1-1", "p1")
  assert.equal(match(t, "R1-1").board, "B1")
  assert.deepEqual(freeBoards(view(t), boards), ["B1", "B3"])
  assert.deepEqual(
    readyMatches(view(t)).map((m) => m.id),
    ["R2-1", "R2-2", "R3-1", "R3-2"],
  )
  // p3 is called to B2, so neither R2-1 (p1 v p3) nor R2-2 (p2 v p4) can go yet … p2 too.
  assert.deepEqual(suggestBoards(view(t), boards), [])
  t = assignBoard(t, "R1-2", null)
  assert.equal(match(t, "R1-2").board, null)
})

test("boards: a called match that has to wait again after a correction gives its board up", () => {
  let t = make("double", 8)
  t = win(win(win(win(t, "W1-1", "p1"), "W1-2", "p4"), "W1-3", "p2"), "W1-4", "p3")
  t = win(win(t, "L1-1", "p8"), "W2-2", "p2")
  assert.deepEqual(who(t, "L2-1"), ["p8", "p3"])
  t = assignBoard(t, "L2-1", "B1")
  // W1-1 corrected: L1-1 was played by p8 and p5, now p1 drops instead of p8, so L1-1 is affected
  // and L2-1 waits for its first player again.
  const corrected = win(t, "W1-1", "p8")
  assert.equal(match(corrected, "L1-1").affected, true)
  assert.equal(match(corrected, "L2-1").state, "pending")
  assert.equal(match(corrected, "L2-1").board, null)
  // B1 is free for another match, and the waiting match does not take it back later.
  let moved = assignBoard(corrected, "W2-1", "B1")
  assert.equal(match(moved, "W2-1").board, "B1")
  moved = win(resetMatch(moved, "L1-1"), "L1-1", "p1")
  assert.equal(match(moved, "L2-1").state, "ready")
  assert.equal(match(moved, "L2-1").board, null)
  assert.equal(moved.boards["L2-1"], undefined)
})

test("boards: a result taken back gives up the board it was played on, a start taken back keeps it", () => {
  // Plain undo: R1-1 was played on B1, B1 moved on to R1-2, then R1-1 is taken back.
  let t = make("roundRobin", 4)
  t = win(startMatch(t, "R1-1", "B1"), "R1-1", "p1")
  t = startMatch(t, "R1-2", "B1")
  t = resetMatch(t, "R1-1")
  assert.deepEqual([match(t, "R1-1").state, match(t, "R1-1").board], ["ready", null])
  // Started without a board it gets none, not a second match on B1.
  t = startMatch(t, "R1-1")
  const onB1 = (x: Tournament) => view(x).matches.filter((m) => m.board === "B1" && (m.state === "ready" || m.state === "live")).map((m) => m.id)
  assert.deepEqual(onB1(t), ["R1-2"])
  assert.equal(match(t, "R1-1").board, null)

  // Correction, then reset: the semi-final K2-1 was played on B1, B1 moved on to K1-3, then K1-2 is
  // corrected and the organizer has K2-1 played again.
  let k = make("single", 8)
  k = win(startMatch(k, "K1-1", "B1"), "K1-1", "p1")
  k = win(startMatch(k, "K1-2", "B2"), "K1-2", "p4")
  k = win(startMatch(k, "K2-1", "B1"), "K2-1", "p1")
  k = startMatch(k, "K1-3", "B1")
  k = win(k, "K1-2", "p5")
  assert.deepEqual([match(k, "K2-1").affected, match(k, "K2-1").board], [true, "B1"])
  k = resetMatch(k, "K2-1")
  assert.deepEqual([match(k, "K2-1").state, match(k, "K2-1").board], ["ready", null])
  assert.deepEqual(onB1(k), ["K1-3"])
  assert.deepEqual(freeBoards(view(k), ["B1", "B2"]), ["B2"])
  throwsCode(() => startMatch(k, "K2-1", "B1"), "boardBusy")
  k = startMatch(k, "K2-1", "B2")
  // A start taken back keeps its board: nobody else could take it while the match was live.
  const undone = resetMatch(k, "K2-1")
  assert.deepEqual([match(undone, "K2-1").state, match(undone, "K2-1").board], ["ready", "B2"])

  // Damaged stored data with a stale board: starting without a board refuses instead of putting a
  // second match on B1.
  const busy = startMatch(make("roundRobin", 4), "R1-2", "B1")
  throwsCode(() => startMatch({ ...busy, boards: { ...busy.boards, "R1-1": "B1" } }, "R1-1"), "boardBusy")
})

test("boards: 128 players and 16 boards are all used, nobody twice", () => {
  const t = make("single", 128)
  const suggestion = suggestBoards(
    view(t),
    Array.from({ length: 16 }, (_, i) => `B${i + 1}`),
  )
  assert.equal(suggestion.length, 16)
  const players = suggestion.flatMap((s) => who(t, s.match))
  assert.equal(new Set(players).size, 32)
})

test("progress per round", () => {
  let t = make("single", 8)
  t = win(win(t, "K1-1", "p1"), "K1-2", "p4")
  t = startMatch(t, "K1-3")
  assert.deepEqual(roundProgress(view(t)), [
    { bracket: "main", group: null, round: 1, total: 4, decided: 2, live: 1, ready: 1, pending: 0 },
    { bracket: "main", group: null, round: 2, total: 2, decided: 0, live: 0, ready: 1, pending: 1 },
    { bracket: "main", group: null, round: 3, total: 1, decided: 0, live: 0, ready: 0, pending: 1 },
  ])
})

// --- Rejected input -----------------------------------------------------------------------------

test("invalid setups and changes are rejected without changing anything", () => {
  throwsCode(() => make("single", 1), "tooFewParticipants")
  throwsCode(() => make("double", 2), "tooFewParticipants")
  throwsCode(() => make("single", 129), "tooManyParticipants")
  throwsCode(() => make("roundRobin", 65), "tooManyParticipants")
  throwsCode(() => make("groups", 128, { groups: { count: 1, advance: 2 } }), "invalidSetup")
  throwsCode(() => createTournament({ format: "single", participants: [...field(3), { id: "p1", name: "x" }], seed: "s", rules: { legsToWin: 3 } }), "duplicateParticipant")
  throwsCode(() => createTournament({ format: "single", participants: field(3), seed: "", rules: { legsToWin: 3 } }), "invalidSetup")
  throwsCode(() => make("single", 4, { rules: { legsToWin: 0 } }), "invalidSetup")
  throwsCode(() => make("groups", 8, { groups: { count: 5, advance: 1 } }), "invalidSetup")
  throwsCode(() => make("groups", 8, { groups: { count: 2, advance: 5 } }), "invalidSetup")
  throwsCode(() => make("groups", 8), "invalidSetup")
  throwsCode(() => make("toString" as TournamentFormat, 4), "invalidSetup")
  throwsCode(() => createTournament({ format: "single", participants: [...field(3), { id: "p4", name: "  " }], seed: "s", rules: { legsToWin: 3 } }), "invalidParticipant")
  throwsCode(() => make("single", 4, { rules: { legsToWin: 3, setsToWin: 0 } }), "invalidSetup")

  const t = make("single", 4)
  const before = JSON.stringify(t)
  throwsCode(() => recordResult(t, "K2-1", { legs: [3, 0] }), "notReady")
  throwsCode(() => recordResult(t, "K9-9", { legs: [3, 0] }), "unknownMatch")
  throwsCode(() => recordResult(t, "K1-1", { legs: [3, 3] }), "invalidScore")
  throwsCode(() => recordWalkover(t, "K1-1", "p2", "noShow"), "notInMatch")
  throwsCode(() => resetMatch(t, "K1-1"), "noRecord")
  throwsCode(() => startMatch(t, "K2-1"), "notReady")
  throwsCode(() => withdraw(t, "nobody", "withdrawn"), "unknownParticipant")
  throwsCode(() => withdraw(withdraw(t, "p1", "withdrawn"), "p1", "withdrawn"), "alreadyWithdrawn")
  throwsCode(() => startMatch(startMatch(t, "K1-1"), "K1-1"), "notReady")
  assert.equal(JSON.stringify(t), before)
})

// --- Properties over many random tournaments ----------------------------------------------------

// Everyone but the disqualified has a place; shared places fit exactly and cover 1 … n.
function checkPlaces(t: Tournament, label: string) {
  const v = view(t)
  const n = t.participants.filter((p) => t.withdrawals[p.id]?.kind !== "disqualified").length
  assert.equal(v.placements.length, n, `${label}: everyone placed`)
  const groups = new Map<string, number>()
  for (const p of v.placements) groups.set(`${p.place}-${p.placeTo}`, (groups.get(`${p.place}-${p.placeTo}`) ?? 0) + 1)
  // Shared places fit exactly and together cover 1 … n.
  let next = 1
  for (const key of [...groups.keys()].sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]))) {
    const [from, to] = key.split("-").map(Number)
    assert.equal(from, next, `${label}: places continue at ${next}`)
    assert.equal(groups.get(key), to - from + 1, `${label}: ${key} shared by ${to - from + 1}`)
    next = to + 1
  }
  assert.equal(next, n + 1)
}

test("property: every format ends with exactly one champion and complete places", () => {
  const rand = random(42)
  const runs: [TournamentFormat, number, Partial<TournamentSetup>][] = []
  for (let n = 2; n <= 40; n++) runs.push(["single", n, {}])
  for (let n = 3; n <= 40; n++) runs.push(["double", n, {}], ["double", n, { grandFinalReset: false }])
  for (let n = 2; n <= 12; n++) runs.push(["roundRobin", n, {}], ["roundRobin", n, { doubleRoundRobin: true }])
  for (const [n, count, advance] of [
    [6, 2, 1],
    [8, 2, 2],
    [9, 3, 2],
    [10, 2, 3],
    [12, 3, 2],
    [12, 4, 2],
    [16, 4, 2],
    [17, 4, 2],
    [20, 5, 2],
    [24, 8, 1],
    [32, 8, 2],
    [12, 2, 4],
  ])
    runs.push(["groups", n, { groups: { count, advance } }])
  for (const [format, n, extra] of runs) {
    const label = `${format} ${n} ${JSON.stringify(extra)}`
    const t = playAll(make(format, n, { ...extra, seeded: 0, seed: `run-${n}` }), coin(rand))
    const v = view(t)
    assert.equal(v.complete, true, label)
    assert.ok(v.champion, `${label}: champion`)
    assert.equal(Object.values(v.status).filter((s) => s === "champion").length, 1, label)
    checkPlaces(t, label)
    assert.equal(v.placements[0].participant, v.champion)

    const played = v.matches.filter((m) => m.state === "finished")
    const losses = new Map<string, number>()
    const games = new Map<string, number>()
    for (const m of played) {
      losses.set(m.loser!, (losses.get(m.loser!) ?? 0) + 1)
      for (const s of m.slots) games.set(s.participant!, (games.get(s.participant!) ?? 0) + 1)
    }
    if (format === "single") {
      assert.equal(played.length, n - 1, label)
      for (const p of t.participants) assert.equal(losses.get(p.id) ?? 0, p.id === v.champion ? 0 : 1, `${label}: ${p.id}`)
    }
    if (format === "double") {
      const gf = v.match("GF")!
      const resetPlayed = v.match("GF2")?.state === "finished"
      assert.equal(resetPlayed, extra.grandFinalReset !== false && gf.winner === gf.slots[1].participant, `${label}: reset only after the losers' champion won`)
      assert.equal(played.length, 2 * n - 2 + (resetPlayed ? 1 : 0), label)
      for (const p of t.participants) {
        const l = losses.get(p.id) ?? 0
        // Without a reset the winners' champion can lose the only grand final as first loss.
        const lostOnlyFinal = extra.grandFinalReset === false && p.id === gf.loser && gf.loser === gf.slots[0].participant
        if (p.id === v.champion) assert.ok(l <= 1, `${label}: champion lost ${l}`)
        else assert.equal(l, lostOnlyFinal ? 1 : 2, `${label}: ${p.id} out after two losses`)
      }
    }
    if (format === "roundRobin") {
      for (const p of t.participants) assert.equal(games.get(p.id) ?? 0, (n - 1) * (extra.doubleRoundRobin ? 2 : 1), `${label}: ${p.id}`)
    }
    if (format === "groups") {
      for (const g of t.groups)
        for (const p of g.members) {
          const inGroup = played.filter((m) => m.bracket === "group" && m.slots.some((s) => s.participant === p)).length
          assert.equal(inGroup, g.members.length - 1, `${label}: ${p} in group ${g.label}`)
        }
    }
  }
})

test("property: random withdrawals, no-shows and corrections still end with one champion", () => {
  const rand = random(99)
  const groupSetups: [number, number][] = [
    [2, 2],
    [3, 2],
    [4, 1],
    [2, 3],
  ]
  for (const format of ["single", "double", "groups", "roundRobin"] as TournamentFormat[]) {
    for (let run = 0; run < 30; run++) {
      const n = format === "roundRobin" ? 5 + Math.floor(rand() * 6) : 8 + Math.floor(rand() * 20)
      const [count, advance] = groupSetups[run % groupSetups.length]
      let t = make(format, n, { seeded: 0, seed: `w-${run}`, ...(format === "groups" && { groups: { count, advance } }) })
      // Two players leave at random moments: before their match, during it or after the group stage.
      const quitters = [...new Set([1 + Math.floor(rand() * n), 1 + Math.floor(rand() * n)])].map((i) => `p${i}`)
      for (let step = 0; step < 10000; step++) {
        const v = view(t)
        const open = v.matches.filter((m) => (m.state === "ready" || m.state === "live") && !m.affected)
        const affected = v.matches.filter((m) => m.affected)
        if (affected.length) {
          t = resetMatch(t, affected[0].id)
          continue
        }
        if (!open.length) break
        const m = open[Math.floor(rand() * open.length)]
        const quitter = quitters.find((q) => !t.withdrawals[q])
        const r = rand()
        if (r < 0.04 && quitter) t = withdraw(t, quitter, rand() < 0.5 ? "withdrawn" : "disqualified")
        else if (r < 0.1) t = recordWalkover(t, m.id, coin(rand)(m), "noShow")
        else if (r < 0.2 && m.state === "ready" && !v.matches.some((x) => x.state === "live" && x.slots.some((s) => m.slots.some((o) => o.participant === s.participant))))
          t = startMatch(t, m.id)
        else t = win(t, m.id, coin(rand)(m))
        // Now and then a correction of an earlier result.
        if (rand() < 0.08) {
          const done = view(t).matches.filter((x) => x.state === "finished" && !x.affected)
          if (done.length) {
            const c = done[Math.floor(rand() * done.length)]
            t = win(t, c.id, c.loser!)
          }
        }
      }
      const v = view(t)
      const label = `${format} ${n} run ${run}`
      assert.equal(v.complete, true, label)
      assert.ok(v.champion, `${label}: champion`)
      assert.ok(!t.withdrawals[v.champion!], `${label}: a withdrawn player cannot win`)
      checkPlaces(t, label)
    }
  }
})

test("property: reusing the last state gives exactly what a fresh computation gives", () => {
  const rand = random(5)
  const strip = (t: Tournament) => {
    const v = view(t)
    return JSON.stringify({ matches: v.matches, standings: v.standings, placements: v.placements, status: v.status, champion: v.champion, complete: v.complete })
  }
  for (const format of ["single", "double", "groups", "roundRobin"] as TournamentFormat[]) {
    let t = make(format, 12, format === "groups" ? { groups: { count: 3, advance: 2 } } : {})
    for (let step = 0; step < 200; step++) {
      const v = view(t)
      const open = v.matches.filter((m) => m.state === "ready" && !m.affected)
      const done = v.matches.filter((m) => m.state === "finished" && !m.affected)
      if (!open.length && !done.length) break
      if (done.length && (rand() < 0.2 || !open.length)) {
        const c = done[Math.floor(rand() * done.length)]
        t = win(t, c.id, c.loser!)
      } else {
        const m = open[Math.floor(rand() * open.length)]
        const busy = v.matches.some((x) => x.state === "live" && x.slots.some((s) => m.slots.some((o) => o.participant === s.participant)))
        t = rand() < 0.3 && !busy ? startMatch(t, m.id, `B${step}`) : win(t, m.id, coin(rand)(m))
      }
      const affected = view(t).matches.find((m) => m.affected)
      if (affected && rand() < 0.5) t = resetMatch(t, affected.id)
      // A deep copy has new arrays, so nothing can be reused for it.
      assert.equal(strip(t), strip(structuredClone(t)), `${format} step ${step}`)
    }
  }
})

test("property: a board never serves two ready or live matches, also after resets and corrections", () => {
  const rand = random(17)
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]
  const boards = ["B1", "B2", "B3"]
  const cases: [TournamentFormat, number, Partial<TournamentSetup>][] = [
    ["single", 11, {}],
    ["double", 9, {}],
    ["groups", 10, { groups: { count: 2, advance: 2 } }],
    ["roundRobin", 6, {}],
  ]
  let resets = 0
  for (const [format, n, extra] of cases) {
    for (let run = 0; run < 8; run++) {
      let t = make(format, n, { ...extra, seeded: 0, seed: `boards-${run}` })
      for (let step = 0; step < 250; step++) {
        const v = view(t)
        const live = v.matches.filter((m) => m.state === "live" && !m.affected)
        const called = v.matches.filter((m) => m.state === "ready" && m.board !== null)
        const entered = v.matches.filter((m) => t.records[m.id])
        const finished = v.matches.filter((m) => m.state === "finished" && !m.affected)
        const r = rand()
        try {
          if (r < 0.3) for (const s of suggestBoards(v, boards)) t = rand() < 0.5 ? startMatch(t, s.match, s.board) : assignBoard(t, s.match, s.board)
          else if (r < 0.45 && called.length) t = startMatch(t, pick(called).id)
          else if (r < 0.75 && live.length) {
            const m = pick(live)
            t = win(t, m.id, coin(rand)(m))
          } else if (r < 0.88 && entered.length) {
            t = resetMatch(t, pick(entered).id)
            resets++
          } else if (finished.length) {
            const c = pick(finished)
            t = win(t, c.id, c.loser!)
          }
        } catch (e) {
          // A called match whose player is playing elsewhere by now may not start; nothing else
          // may be refused here (a board the view shows as this match's is free).
          if (!(e instanceof TournamentError) || e.code !== "playerBusy") throw e
        }
        const used = view(t).matches.filter((m) => m.board !== null && (m.state === "ready" || m.state === "live")).map((m) => m.board)
        assert.equal(new Set(used).size, used.length, `${format} run ${run} step ${step}: ${used.join(" ")}`)
      }
    }
  }
  assert.ok(resets > 100, `only ${resets} resets`)
})

test("property: the lot only orders players whom head-to-head cannot separate", () => {
  // One leg per match, so leg difference and legs won follow the points and ties are common.
  const rand = random(3)
  const seen = new Set<string>()
  for (let run = 0; run < 80; run++) {
    const n = 4 + (run % 6)
    let t = make("roundRobin", n, { rules: { legsToWin: 1 }, doubleRoundRobin: run % 3 === 0, seed: `lot-${run}` })
    for (const m of view(t).matches) t = recordResult(t, m.id, { legs: rand() < 0.5 ? [1, 0] : [0, 1] })
    const v = view(t)
    const rows = v.standings[0].rows
    rows.forEach((r) => seen.add(r.decidedBy ?? "-"))
    // Every run of rows the lot ordered: among exactly these players, everyone has the same number
    // of wins, so no further head-to-head step could separate them.
    for (let start = 0, i = 1; i <= rows.length; i++) {
      if (i < rows.length && rows[i].decidedBy === "lot") continue
      const tied = new Map(rows.slice(start, i).map((r) => [r.participant, 0]))
      for (const m of v.matches) if (tied.has(m.slots[0].participant!) && tied.has(m.slots[1].participant!)) tied.set(m.winner!, tied.get(m.winner!)! + 1)
      assert.equal(new Set(tied.values()).size, 1, `run ${run}: ${[...tied].join(" ")} ordered by lot`)
      start = i
    }
  }
  assert.ok(seen.has("lot") && seen.has("headToHead"), "ties of both kinds occurred")
})

// --- Load: 128 participants, 16 boards ------------------------------------------------------

test("load: 128 participants and 16 boards — draw, calls to boards and results under 50 ms", () => {
  // Processor time of this thread (of the process on Node 22), so other work on the machine does
  // not count. The draw is the fastest of three identical draws; for calls and results the 99th
  // percentile counts, so a single garbage collection pause does not decide the test.
  const clock = () => {
    const used = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : process.cpuUsage()
    return (used.user + used.system) / 1000
  }
  const cost = (fn: () => void) => {
    const before = clock()
    fn()
    return clock() - before
  }
  const p99 = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(0.99 * (list.length - 1))]
  const boards = Array.from({ length: 16 }, (_, i) => `B${i + 1}`)
  // Knockout formats are played to the end. The largest tables (a round robin of 64 with 2016
  // matches, two groups of 64 with 4032) cost the same for every result, so 300 results measure them.
  const setups: [string, number, Partial<TournamentSetup>, number][] = [
    ["single", 128, { format: "single" }, Infinity],
    ["double", 128, { format: "double" }, Infinity],
    ["groups 32×4", 128, { format: "groups", groups: { count: 32, advance: 2 } }, Infinity],
    ["groups 2×64", 128, { format: "groups", groups: { count: 2, advance: 4 } }, 300],
    ["round robin", 64, { format: "roundRobin" }, 300],
  ]
  // Warm up once, like an app that has already drawn a tournament.
  playAll(make("double", 16), coin(random(1)))
  for (const [label, n, setup, limit] of setups) {
    let t!: Tournament
    const draw = Math.min(
      ...[1, 2, 3].map(() =>
        cost(() => {
          t = createTournament({ participants: field(n), seed: "load", rules: { legsToWin: 3 }, format: "single", ...setup })
          view(t)
        }),
      ),
    )
    assert.ok(draw < 50, `${label}: draw took ${draw.toFixed(1)} ms`)
    // Call ready matches to free boards and start them, then enter their results.
    const calls: number[] = []
    const results: number[] = []
    while (results.length < limit) {
      for (const c of suggestBoards(view(t), boards))
        calls.push(
          cost(() => {
            t = startMatch(t, c.match, c.board)
            view(t)
          }),
        )
      const live = view(t).matches.filter((m) => m.state === "live")
      if (live.length === 0) break
      for (const m of live)
        results.push(
          cost(() => {
            t = recordResult(t, m.id, { legs: [3, results.length % 3] })
            view(t)
          }),
        )
    }
    assert.ok(p99(calls) < 50, `${label}: 99% of ${calls.length} calls to a board within ${p99(calls).toFixed(1)} ms`)
    assert.ok(p99(results) < 50, `${label}: 99% of ${results.length} results within ${p99(results).toFixed(1)} ms`)
    if (limit === Infinity) {
      assert.equal(view(t).complete, true, label)
      // single: 127; double: 2 · 128 − 2 (no reset when the favourite wins); groups: 32 · 6 + 63.
      const expected: Record<string, number> = { single: 127, double: 254, "groups 32×4": 255 }
      assert.equal(results.length, expected[label], label)
    }
  }
})

// --- Names ----------------------------------------------------------------------------------

test("round names: knockout rounds from the end, by bracket size", async () => {
  const { tournamentsDe } = await import("../lib/i18n/features/tournaments.de.ts")
  const { roundLabel } = await import("../lib/tournaments/labels.ts")
  const name = (t: Tournament, id: string) => roundLabel(tournamentsDe, match(t, id))
  const five = make("single", 5)
  assert.deepEqual(
    ["K1-2", "K2-1", "K3-1"].map((id) => name(five, id)),
    ["Viertelfinale", "Halbfinale", "Finale"],
  )
  assert.equal(name(make("single", 32), "K1-1"), "Runde 1")
  assert.equal(name(make("single", 32), "K2-1"), "Achtelfinale")
  const de = make("double", 5)
  assert.deepEqual(
    ["W2-1", "W3-1", "L2-1", "L4-1", "GF", "GF2"].map((id) => name(de, id)),
    ["Gewinnerrunde 2", "Finale der Gewinnerrunde", "Verliererrunde 1", "Finale der Verliererrunde", "Finale", "Entscheidungsspiel"],
  )
  assert.equal(name(make("groups", 8, { groups: { count: 2, advance: 2 } }), "GB2-1"), "Gruppe B, Runde 2")
  assert.equal(name(make("roundRobin", 4), "R3-1"), "Runde 3")
})
