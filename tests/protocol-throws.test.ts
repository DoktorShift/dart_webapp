import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { correctDart, correctVisitTotal, replay, restartLegLog, visitBySeq } from "../lib/game/engine.ts"
import type { MatchConfig, Throw } from "../lib/game/types.ts"
import { DART_ALPHABET, decodeThrows, encodeThrows } from "../lib/protocol/throws.ts"
import { config, dart, miss3, play } from "./helpers.ts"

// Logs as they are stored: JSON drops keys holding undefined.
const stored = (log: Throw[]): Throw[] => JSON.parse(JSON.stringify(log))

const roundTrips = (c: MatchConfig, log: Throw[]) => {
  const text = encodeThrows(log)
  assert.deepEqual(decodeThrows(text), stored(log))
  const a = replay(c, log)
  const b = replay(c, decodeThrows(text))
  assert.deepEqual([b.scores, b.legResults.map((r) => r.winner), b.winner, b.visitSeq], [a.scores, a.legResults.map((r) => r.winner), a.winner, a.visitSeq])
  return text
}

test("the recorded P0.01 game (Anna vs Ben, 301) round-trips and replays to the same result", () => {
  const storage = JSON.parse(readFileSync(new URL("../docs/implementation/evidence/P0.01/storage-finished.json", import.meta.url), "utf8"))
  const match = JSON.parse(storage["dart-scorer.current-match.v1"])
  const text = roundTrips(match.config, match.throws)
  // T20 T20 20 | 20 19 20 | T20 T17 Bull
  assert.equal(text, "1775.525.7y-")
  assert.equal(replay(match.config, decodeThrows(text)).winner, 0)
})

test("a game corrected in the app (P0.05 recording) round-trips and replays to the same result", () => {
  const storage = JSON.parse(readFileSync(new URL("../docs/implementation/evidence/P0.05/storage-corrected.json", import.meta.url), "utf8"))
  const match = JSON.parse(storage["dart-scorer.current-match.v1"])
  assert.ok(match.throws.some((t: Throw) => t.edited))
  const text = roundTrips(match.config, match.throws)
  // T20 T20 20 | 20 !5 20 | T20 T17 Bull: the corrected dart keeps its mark.
  assert.equal(text, "1775.5!M5.7y-")
  const s = replay(match.config, decodeThrows(text))
  assert.equal(s.winner, 0)
  assert.equal(s.scores[1], 256)
})

test("one character per dart, one per visit change", () => {
  const c = config({ startScore: 301 })
  const log = play(c, [dart(20, 3), dart(20, 3), dart(20), dart(20), dart(19), dart(20), dart(20, 3), dart(17, 3), dart(25, 2)])
  assert.equal(encodeThrows(log), `1${DART_ALPHABET[59]}${DART_ALPHABET[59]}${DART_ALPHABET[57]}.${DART_ALPHABET[57]}${DART_ALPHABET[54]}${DART_ALPHABET[57]}.${DART_ALPHABET[59]}${DART_ALPHABET[50]}-`)
})

test("corrections: an edited dart, a busted visit and the next player's darts survive", () => {
  const c = config({ startScore: 101 })
  const log = play(c, [dart(20, 3), dart(1), dart(1), dart(5), dart(5), dart(5)])
  const plan = correctDart(c, log, visitBySeq(replay(c, log), 0)!, 1, { segment: 20, multiplier: 3 })
  assert.ok(plan.rescored.some((t) => t.edited))
  const text = roundTrips(c, plan.rescored)
  assert.match(text, /!/)
})

test("corrections: a kept leg result carries closesLeg", () => {
  const c = config({ startScore: 301, legsToWin: 2 })
  const leg1 = [dart(20, 3), dart(20, 3), dart(20, 3), ...miss3(), dart(20, 3), dart(11, 3), dart(14, 2)]
  const leg2 = [dart(20), dart(20), dart(20), dart(19), dart(19), dart(19)]
  const log = play(c, [...leg1, ...leg2])
  const plan = correctDart(c, log, visitBySeq(replay(c, log), 0)!, 0, { segment: 19, multiplier: 3 })
  assert.ok(plan.keepResult)
  const text = roundTrips(c, plan.keepResult.throws)
  assert.match(text, /!#|#/)
  assert.match(text, /\//)
})

test("corrections: a no-score visit spelled out, and a corrected visit total", () => {
  const c = config({ startScore: 101 })
  const log = play(c, [dart(20), { kind: "noScore" }])
  roundTrips(c, log)
  const plan = correctDart(c, log, replay(c, log).lastVisit[0]!, 2, { segment: 19, multiplier: 1 })
  roundTrips(c, plan.rescored)

  const v = config({ startScore: 501 })
  const visits = play(v, [{ kind: "visit", total: 100, darts: 3 }, { kind: "visit", total: 60, darts: 3, atDouble: 1 }])
  const fixed = correctVisitTotal(v, visits, visitBySeq(replay(v, visits), 0)!, 140, 3)
  // correctVisitTotal leaves atDouble: undefined in memory; storage drops it.
  assert.ok("atDouble" in fixed.rescored[0])
  const text = roundTrips(v, fixed.rescored)
  assert.ok(text.includes("!(v140,3)"))
  assert.ok(text.includes("(v60,3,1)"))
})

test("turns, a player leaving and a restarted leg keep their tags", () => {
  const c = config({ startScore: 301, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }] })
  const log = play(c, [{ kind: "turn", player: 2 }, dart(20), dart(20), dart(20), { kind: "retire", player: 1 }, dart(5), dart(5), dart(5)])
  roundTrips(c, log)
  const restarted = restartLegLog(log, 0)!
  // The departure is kept without its visit tag.
  assert.equal(restarted.at(-1)?.visit, undefined)
  const text = roundTrips(c, restarted)
  assert.match(text, /\[,0\]\(r1\)/)
})

test("logs saved before throws were tagged decode the same", () => {
  const c = config({ startScore: 301 })
  const legacy: Throw[] = [dart(20), dart(20), dart(20), dart(1), dart(1), dart(1)]
  const text = roundTrips(c, legacy)
  assert.equal(text.slice(0, 4), "1[,]")
})

test("a snapshot can carry the log from a later throw on", () => {
  const c = config({ startScore: 301, legsToWin: 2 })
  const leg1 = [dart(20, 3), dart(20, 3), dart(20, 3), ...miss3(), dart(20, 3), dart(11, 3), dart(14, 2)]
  const log = play(c, [...leg1, dart(20), dart(20), dart(20)])
  const from = log.findIndex((t) => t.leg === 1)
  const tail = encodeThrows(log, from)
  // The first token moves the cursor to the leg's first visit.
  assert.match(tail, /^1[[/.]/)
  assert.deepEqual(decodeThrows(tail), stored(log.slice(from)))
})

test("random logs round-trip (seeded)", () => {
  let seed = 0x5eed1
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed % n
  }
  const randomDart = (): Throw => {
    const k = rnd(66)
    if (k < 60) return dart(Math.floor(k / 3) + 1, ((k % 3) + 1) as 1 | 2 | 3)
    return [dart(0), dart(25), dart(25, 2)][k % 3]
  }
  for (let round = 0; round < 300; round++) {
    const log: Throw[] = []
    let visit = 0
    let leg = 0
    const length = rnd(40)
    for (let i = 0; i < length; i++) {
      const pick = rnd(20)
      let t: Throw =
        pick < 14
          ? randomDart()
          : pick === 14
            ? { kind: "noScore" }
            : pick === 15
              ? { kind: "visit", total: rnd(181), darts: 1 + rnd(3), ...(rnd(2) ? { atDouble: rnd(4) } : {}) }
              : pick === 16
                ? { kind: "turn", player: rnd(6) }
                : pick === 17
                  ? { kind: "retire", player: rnd(6) }
                  : randomDart()
      const step = rnd(10)
      if (step < 3) visit += 1
      else if (step === 3) visit += 2 + rnd(7)
      else if (step === 4) {
        leg += 1
        visit += 1 + rnd(3)
      }
      const tagging = rnd(12)
      t = { ...t, ...(tagging === 0 ? {} : tagging === 1 ? { leg } : { visit, leg }) }
      if (rnd(9) === 0) t = { ...t, edited: true }
      if (rnd(13) === 0) t = { ...t, closesLeg: true }
      log.push(t)
    }
    assert.deepEqual(decodeThrows(encodeThrows(log)), stored(log))
  }
})

test("false flags read as unset, exactly as the engine treats them", () => {
  const t: Throw = { kind: "dart", dart: { segment: 1, multiplier: 1 }, visit: 0, leg: 0, edited: false, closesLeg: false }
  assert.deepEqual(decodeThrows(encodeThrows([t])), [{ kind: "dart", dart: { segment: 1, multiplier: 1 }, visit: 0, leg: 0 }])
})

test("about 1.3 bytes per dart for a full 501 leg", () => {
  const c = config()
  const visit = [dart(20, 3), dart(20), dart(5)]
  const darts: Throw[] = []
  for (let i = 0; i < 20; i++) darts.push(...visit)
  const log = play(c, darts)
  const bytes = encodeThrows(log).length
  assert.ok(bytes / log.length < 1.4, `${bytes} bytes for ${log.length} darts`)
  assert.ok(JSON.stringify(log).length / log.length > 40)
})

test("darts that cannot exist are refused, not encoded", () => {
  assert.throws(() => encodeThrows([dart(0, 2)]), /no such dart/)
  assert.throws(() => encodeThrows([dart(25, 3)]), /no such dart/)
  assert.throws(() => encodeThrows([dart(21)]), /no such dart/)
  assert.throws(() => encodeThrows([{ kind: "visit", total: 181, darts: 3 }]), /visit total/)
  assert.throws(() => encodeThrows([{ kind: "visit", total: 60, darts: 0 }]), /visit darts/)
  assert.throws(() => encodeThrows([{ kind: "turn", player: 6 }]), /player/)
  assert.throws(() => encodeThrows([{ kind: "dart", dart: { segment: 1, multiplier: 1 }, visit: -1 }]), /out of range/)
})

test("damaged text is refused with a position, never half-read", () => {
  for (const bad of ["", "2A", "1A?", "1(v100,3", "1(v100)", "1(v181,3)", "1(v01,3)", "1(x1)", "1(t9)", "1[1", "1[a,1]", "1!", "1!.", "1#A.!"]) {
    assert.throws(() => decodeThrows(bad), /throw log/, bad)
  }
})
