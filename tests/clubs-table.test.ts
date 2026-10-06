import { test } from "node:test"
import assert from "node:assert/strict"
import type { SeasonRules } from "../lib/protocol/club.ts"
import type { ClubResultDecision, ClubSeason } from "../lib/protocol/club-state.ts"
import type { ClubGame } from "../lib/clubs/games.ts"
import { countsFor, seasonTable } from "../lib/clubs/table.ts"
import { DEFAULT_RULES } from "../lib/clubs/seasons.ts"

// The season table from the club's games (lib/clubs/table.ts): which games belong to a season,
// which count under its confirmation rule and the leaders' decisions, and how ties are split.

const [ANNA, BEN, CARL, DORA] = ["a", "b", "c", "d"].map((c) => c.repeat(64))
const NOW = 1_790_000_000

function season(rules: Partial<SeasonRules> = {}, extra: Partial<ClubSeason> = {}): ClubSeason {
  return { id: "5".repeat(32), name: "Saison", starts: NOW, ended: false, versions: [{ version: 1, rules: { ...DEFAULT_RULES, confirmations: "none", ...rules }, event: "e".repeat(64), at: NOW - 10 }], ...extra }
}

let n = 0
// A game of `seats` (pubkey or a guest alias), won by `winner`, with legs per seat.
function game(seats: (string | { guest: string })[], winner: number | null, legs: number[], opts: { at?: number; by?: string; confirm?: Record<number, "confirm" | "dispute">; mode?: string; stats?: { darts: number[]; points: number[] } } = {}): ClubGame {
  n += 1
  const id = n.toString(16).padStart(64, "0")
  return {
    match: id,
    by: opts.by ?? ANNA,
    named: opts.at ?? NOW + n,
    agreement: {
      engine: 1,
      rules: { type: "x01", modeId: opts.mode ?? "501", startScore: 501, doubleIn: false, doubleOut: true, cutThroat: false, bullFinish: false, legsToWin: 3, setsToWin: 1, startRule: "alternate" },
      seats: seats.map((s) => (typeof s === "string" ? { alias: s[0].toUpperCase(), pubkey: s } : { alias: s.guest })),
      visibility: "public",
    },
    authority: opts.by ?? ANNA,
    result: { event: `r${id.slice(1)}`, by: opts.by ?? ANNA, at: opts.at ?? NOW + n, winner, legs, ...(opts.stats ? { stats: opts.stats } : {}) },
    confirmations: Object.fromEntries(Object.entries(opts.confirm ?? {}).map(([seat, verdict]) => [seat, { verdict, event: "f".repeat(64), at: NOW + 1000, pubkey: seats[Number(seat)] as string }])),
  }
}

test("points per win, draw and loss; legs on both sides; guests have no row but their games count", () => {
  const games = [game([ANNA, BEN], 0, [3, 1]), game([BEN, { guest: "Gast 1" }], 0, [3, 2]), game([ANNA, BEN], null, [2, 2])]
  const t = seasonTable(season(), games)
  const row = (p: string) => t.ranked.find((r) => r.pubkey === p)
  assert.deepEqual({ ...row(ANNA) }, { pubkey: ANNA, alias: "A", games: 2, wins: 1, draws: 1, losses: 0, points: 3, legsFor: 5, legsAgainst: 3, average: null, rank: 1 })
  assert.equal(row(BEN)?.points, 3)
  assert.equal(row(BEN)?.games, 3)
  assert.equal(t.ranked.length, 2)
})

test("only the season's modes and period count", () => {
  const s = season({ modes: ["501"] }, { ends: NOW + 100 })
  const games = [game([ANNA, BEN], 0, [3, 0], { at: NOW - 5 }), game([ANNA, BEN], 0, [3, 0], { mode: "cricket" }), game([ANNA, BEN], 0, [3, 0], { at: NOW + 200 }), game([ANNA, BEN], 1, [0, 3], { at: NOW + 50 })]
  const t = seasonTable(s, games)
  assert.equal(t.counted.length, 1)
  assert.equal(t.ranked[0].pubkey, BEN)
  // An ended season takes nothing recorded after its end.
  const ended = seasonTable(season({}, { ended: true, endedAt: NOW + 10 }), [game([ANNA, BEN], 0, [3, 0], { at: NOW + 20 })])
  assert.equal(ended.counted.length, 0)
})

test("confirmations: none, one opponent, every other player; a dispute stops a game until a leader decides", () => {
  const recorded = (confirm: Record<number, "confirm" | "dispute">) => game([ANNA, BEN, CARL], 0, [3, 1, 0], { by: ANNA, confirm })
  const opponent = { ...DEFAULT_RULES, confirmations: "opponent" as const }
  const all = { ...DEFAULT_RULES, confirmations: "all" as const }
  assert.equal(countsFor(recorded({}), opponent), "confirmations")
  assert.equal(countsFor(recorded({ 1: "confirm" }), opponent), true)
  assert.equal(countsFor(recorded({ 1: "confirm" }), all), "confirmations")
  assert.equal(countsFor(recorded({ 1: "confirm", 2: "confirm" }), all), true)
  assert.equal(countsFor(recorded({ 1: "confirm", 2: "dispute" }), opponent), "disputed")
  // The recorder's own seat needs no confirmation; a game with only guests besides needs a leader.
  assert.equal(countsFor(game([ANNA, { guest: "Gast 1" }], 0, [3, 0], { by: ANNA }), opponent), "confirmations")
  const disputed = recorded({ 1: "dispute" })
  const decision = (result: string, count: boolean): ClubResultDecision => ({ season: "5".repeat(32), match: disputed.match, result, count, event: "9".repeat(64), by: BEN, at: NOW + 2000 })
  assert.equal(countsFor(disputed, opponent, decision(disputed.result!.event, true)), true)
  assert.equal(countsFor(recorded({ 1: "confirm" }), opponent, decision(disputed.result!.event, false)), true, "a decision about another result doesn't apply")
  const table = seasonTable(season({ confirmations: "opponent" }), [disputed, recorded({ 1: "confirm" })], { [disputed.match]: decision(disputed.result!.event, false) })
  assert.deepEqual(table.open.map((o) => o.why), ["excluded"])
  assert.equal(table.counted.length, 1)
})

test("ties split by the rules' order, head to head within the tied group; what still ties shares the rank", () => {
  const s = season({ tiebreak: ["headToHead", "legDifference"] })
  const games = [
    game([ANNA, BEN], 0, [3, 2]),
    game([BEN, CARL], 0, [3, 0]),
    game([CARL, ANNA], 0, [3, 0]),
    game([DORA, { guest: "Gast" }], 0, [3, 0]),
    game([DORA, { guest: "Gast" }], 1, [0, 3]),
  ]
  // Everyone has 2 points. Head to head Anna, Ben and Carl took 2 points each from their games
  // against each other, Dora none (she played only guests); leg difference then decides among
  // the three: Ben +2, Carl 0, Anna -2.
  const t = seasonTable(s, games)
  assert.deepEqual(
    t.ranked.map((r) => [r.alias, r.rank]),
    [["B", 1], ["C", 2], ["A", 3], ["D", 4]],
  )
  const level = seasonTable(season({ tiebreak: ["wins"] }), [game([ANNA, { guest: "Gast" }], 0, [3, 0]), game([BEN, { guest: "Gast" }], 0, [3, 0])])
  assert.deepEqual(
    level.ranked.map((r) => r.rank),
    [1, 1],
  )
})

test("the minimum of games keeps players out of the ranking, not out of the list", () => {
  const t = seasonTable(season({ minGames: 2 }), [game([ANNA, BEN], 0, [3, 0]), game([ANNA, CARL], 0, [3, 0])])
  assert.deepEqual(t.ranked.map((r) => r.pubkey), [ANNA])
  assert.deepEqual(t.unranked.map((r) => r.pubkey).sort(), [BEN, CARL])
})

test("the average weights games by their darts", () => {
  const t = seasonTable(season(), [game([ANNA, BEN], 0, [1, 0], { stats: { darts: [15, 15], points: [501, 300] } }), game([ANNA, BEN], 0, [1, 0], { stats: { darts: [45, 45], points: [501, 400] } })])
  // (501 + 501) / 60 × 3 = 50.1
  assert.equal(t.ranked.find((r) => r.pubkey === ANNA)?.average, 50.1)
})
