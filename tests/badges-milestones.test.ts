import { test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, saved } from "./storage-helpers.ts"
import { archivedAt, A_CONFIG, matchA, matchB, matchD, matchE, recordC } from "./storage-fixtures.ts"
import { dart, play } from "./helpers.ts"
import { MILESTONES } from "../lib/badges/catalog.ts"
import { evaluateMilestones, reachedIn, type MilestoneStatus } from "../lib/badges/milestones.ts"
import { fromV1Record, type ArchivedMatch } from "../lib/storage/archive.ts"

// The catalog's rules on the games of storage-fixtures.ts. Every expected figure is worked out by
// hand from the throws described there, not by running the code under test.

const anna = `id:${ANNA}`
const ben = `id:${BEN}`
const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T20:00:00.000Z`

// A: 301. Anna T20 T20 T20 = 180, then T20 T15 D8 = 121 out: 6 darts (a perfect leg in 301),
//    301 points, 301 × 300 / 6 = 15050 hundredths. Ben: one visit of 60 in 3 darts: 6000.
const A = archivedAt(matchA(), day(2))
// B: 301 in visit totals. Anna 100, 60, 41; Ben 140, 26, 135 out (wins). Ben: 9 darts, 301 points.
const B = archivedAt(matchB(), day(3))
// C: a 1.0.0 result, totals only: Anna beat Ben in 501, 18 darts, 501 points (average 83.5).
const C = fromV1Record(recordC())
// D: Cricket. Anna T20 T19 T18, then T17 T16 T15, then the bull: 21 marks in 8 darts.
const D = archivedAt(matchD(), day(4))
// E: Around the Clock alone, the whole round in 24 darts.
const E = archivedAt(matchE(), day(5))

const of = (statuses: MilestoneStatus[], id: string) => {
  const status = statuses.find((s) => s.milestone.id === id)
  assert.ok(status, id)
  return status
}
const reached = (statuses: MilestoneStatus[], id: string) => of(statuses, id).achieved
const progress = (statuses: MilestoneStatus[], id: string) => of(statuses, id).progress

test("the catalog: unique ids, a version for every rule", () => {
  assert.equal(new Set(MILESTONES.map((m) => m.id)).size, MILESTONES.length)
  for (const m of MILESTONES) assert.ok(Number.isInteger(m.version) && m.version >= 1, m.id)
})

test("X01: visits, finishes, a perfect leg and averages, each from the game it happened in", () => {
  const annaA = evaluateMilestones([A], anna)
  for (const id of ["first-100", "first-140", "first-180"]) assert.deepEqual(reached(annaA, id), { matchId: "match-a", finishedAt: day(2), modeId: "301", value: 180 }, id)
  assert.equal(reached(annaA, "checkout-100")?.value, 121)
  assert.equal(reached(annaA, "perfect-leg")?.value, 6)
  for (const id of ["average-40", "average-60", "average-80"]) assert.equal(reached(annaA, id)?.value, 15050, id)
  assert.equal(reached(annaA, "first-win")?.matchId, "match-a")

  // Ben's 60 in three darts is an average of exactly 60: the threshold counts.
  const benA = evaluateMilestones([A], ben)
  assert.equal(reached(benA, "average-60")?.value, 6000)
  assert.equal(reached(benA, "average-80"), null)
  assert.equal(progress(benA, "average-80"), 6000)
  assert.equal(reached(benA, "first-100"), null)
  assert.equal(progress(benA, "first-100"), 60)
  // No finish yet is unknown, not 0; no win yet is 0 of 1.
  assert.equal(progress(benA, "checkout-100"), null)
  assert.equal(progress(benA, "first-win"), 0)

  // Ben's 140 and his 135 out come in B, the next day.
  const benAB = evaluateMilestones([B, A], ben)
  assert.equal(reached(benAB, "first-140")?.matchId, "match-b")
  assert.equal(reached(benAB, "checkout-100")?.value, 135)
  assert.equal(reached(benAB, "first-180"), null)
  assert.equal(progress(benAB, "first-180"), 140)
  assert.equal(reached(benAB, "first-win")?.matchId, "match-b")
})

test("Cricket and Around the Clock", () => {
  const statuses = evaluateMilestones([D, E], anna)
  // Three triples on 20, 19 and 18 in the first visit; 21 × 300 / 8 = 787.5 marks per round.
  assert.equal(reached(statuses, "cricket-nine-marks")?.matchId, "match-d")
  assert.equal(reached(statuses, "cricket-mpr-3")?.value, 787)
  assert.deepEqual(reached(statuses, "clock-30"), { matchId: "match-e", finishedAt: day(5), modeId: "clock", value: 24 })
  // Ben threw only misses in D: none of his figures reach anything.
  const benD = evaluateMilestones([D], ben)
  assert.equal(progress(benD, "cricket-nine-marks"), 0)
  assert.equal(progress(benD, "cricket-mpr-3"), 0)
  // X01 milestones know of no X01 game.
  assert.equal(progress(statuses, "first-180"), null)
})

test("games count in the order they were finished, practice included; wins only against others", () => {
  const games = Array.from({ length: 10 }, (_, i) => archivedAt({ ...matchE(), id: `clock-${i}` }, day(10 + i)))
  const nine = evaluateMilestones(games.slice(0, 9), anna)
  assert.equal(reached(nine, "games-10"), null)
  assert.equal(progress(nine, "games-10"), 9)
  // Solo games are never wins.
  assert.equal(progress(nine, "first-win"), 0)
  const ten = evaluateMilestones([...games].reverse(), anna)
  assert.deepEqual(reached(ten, "games-10"), { matchId: "clock-9", finishedAt: day(19), modeId: "clock", value: 10 })
  assert.equal(progress(ten, "games-50"), 10)
})

test("imported 1.0.0 totals count for games and wins, never for a milestone that needs throws", () => {
  const aliases = new Map([["anna", ANNA]])
  const statuses = evaluateMilestones([C], anna, { aliases })
  // Anna won C, on 1 September: her first win, from the totals.
  assert.deepEqual(reached(statuses, "first-win"), { matchId: C.id, finishedAt: "2026-09-01T20:00:00.000Z", modeId: "501", value: 1 })
  assert.equal(progress(statuses, "games-10"), 1)
  // C's totals are an average of 83.5, but without throws nothing about them is known.
  for (const m of MILESTONES.filter((m) => m.basis === "throws")) assert.deepEqual([of(statuses, m.id).achieved, of(statuses, m.id).progress], [null, null], m.id)
  // Without the assignment the result belongs to the name "anna", not to the player.
  assert.equal(reached(evaluateMilestones([C], anna), "first-win"), null)
})

test("a correction moves or takes back a milestone", () => {
  // A again, Anna's first dart corrected to a T19: 177, then T20 T14 D11 = 124 out.
  const corrected: ArchivedMatch = archivedAt(
    saved(A_CONFIG, play(A_CONFIG, [dart(19, 3), dart(20, 3), dart(20, 3), dart(20), dart(20), dart(20), dart(20, 3), dart(14, 3), dart(11, 2)]), "match-a"),
    day(2),
  )
  const before = evaluateMilestones([A, B], anna)
  const after = evaluateMilestones([corrected, B], anna)
  assert.equal(reached(before, "first-180")?.matchId, "match-a")
  assert.equal(reached(after, "first-180"), null)
  assert.equal(progress(after, "first-180"), 177)
  assert.equal(reached(after, "checkout-100")?.value, 124)
  // The game a milestone is reached in can change: Anna's first 100+ was in A, and stays there.
  assert.equal(reached(after, "first-100")?.matchId, "match-a")
  // Without A at all (undone or deleted), B's 100 is the first.
  assert.equal(reached(evaluateMilestones([B], anna), "first-100")?.matchId, "match-b")
})

test("what a finished game made a player reach", () => {
  const statuses = evaluateMilestones([B, A], ben)
  assert.deepEqual(
    reachedIn(statuses, "match-b").map((s) => s.milestone.id),
    ["first-win", "first-100", "first-140", "checkout-100", "average-80"],
  )
  // A gave Ben his 40 and 60 average, nothing else.
  assert.deepEqual(
    reachedIn(statuses, "match-a").map((s) => s.milestone.id),
    ["average-40", "average-60"],
  )
})
