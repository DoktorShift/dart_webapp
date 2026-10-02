import { test } from "node:test"
import assert from "node:assert/strict"
import { correctDart, replay, visitBySeq } from "../lib/game/engine.ts"
import { config, dart, miss3, play } from "./helpers.ts"

test("correcting an earlier visit recalculates everything after it", () => {
  const c = config({ startScore: 301 })
  const log = play(c, [dart(5), dart(20), dart(20), ...miss3(), dart(20, 3), dart(20, 3), dart(20, 3), ...miss3()])
  const visit = visitBySeq(replay(c, log), 0)!
  const plan = correctDart(c, log, visit, 0, { segment: 20, multiplier: 3 })
  assert.equal(plan.dropped, 0)
  assert.deepEqual(replay(c, plan.rescored).scores, [301 - 100 - 180, 301])
})

test("a correction that busts a visit drops its later darts, the next player keeps theirs", () => {
  const c = config({ startScore: 101 })
  const log = play(c, [dart(20, 3), dart(1), dart(1), dart(5), dart(5), dart(5)])
  const plan = correctDart(c, log, visitBySeq(replay(c, log), 0)!, 1, { segment: 20, multiplier: 3 })
  assert.equal(plan.dropped, 1)
  assert.deepEqual(replay(c, plan.rescored).scores, [101, 86])
})

test("a correction that un-busts a visit keeps the next player's darts with them", () => {
  const c = config({ startScore: 101 })
  const log = play(c, [dart(20, 3), dart(20, 3), dart(5), dart(5), dart(5)])
  const plan = correctDart(c, log, visitBySeq(replay(c, log), 0)!, 1, { segment: 1, multiplier: 1 })
  const s = replay(c, plan.rescored)
  assert.deepEqual(s.scores, [40, 86])
  assert.equal(s.current, 0)
})

test("correcting a dart inside a no-score visit", () => {
  const c = config({ startScore: 101 })
  const log = play(c, [dart(20), { kind: "noScore" }])
  const plan = correctDart(c, log, replay(c, log).lastVisit[0]!, 2, { segment: 19, multiplier: 1 })
  assert.equal(plan.rescored.length, 3)
  assert.equal(replay(c, plan.rescored).scores[0], 62)
})

// Leg 1: A checks out 301 in 6 darts (180, then T20 T11 D14). Leg 2: B and A throw a visit each.
const finishedLegGame = () => {
  const c = config({ startScore: 301, legsToWin: 2 })
  const leg1 = [dart(20, 3), dart(20, 3), dart(20, 3), ...miss3(), dart(20, 3), dart(11, 3), dart(14, 2)]
  const leg2 = [dart(20), dart(20), dart(20), dart(19), dart(19), dart(19)]
  return { c, log: play(c, [...leg1, ...leg2]) }
}

test("finished leg: a correction that would change its result offers to keep it", () => {
  const { c, log } = finishedLegGame()
  const plan = correctDart(c, log, visitBySeq(replay(c, log), 0)!, 0, { segment: 19, multiplier: 3 })
  assert.equal(plan.keepResult?.winner, 0)
  assert.ok(plan.dropped > 0)

  const kept = replay(c, plan.keepResult!.throws)
  assert.deepEqual(kept.legsWon, [1, 0])
  assert.deepEqual(kept.scores, [301 - 57, 301 - 60])
  assert.equal(kept.pastLegs[0].at(-1)?.keptResult, true)
  assert.equal(kept.stats[0].points, 177 + 121 + 57)

  const rescored = replay(c, plan.rescored)
  assert.deepEqual(rescored.legsWon, [0, 0])
  assert.equal(rescored.legIndex, 0)
})

test("finished leg: a correction that keeps its result applies directly", () => {
  const { c, log } = finishedLegGame()
  const plan = correctDart(c, log, visitBySeq(replay(c, log), 1)!, 0, { segment: 1, multiplier: 1 })
  assert.equal(plan.keepResult, undefined)
  assert.equal(plan.dropped, 0)
  assert.deepEqual(replay(c, plan.rescored).legsWon, [1, 0])
})

test("finished leg: a leg kept as played stays won after another correction", () => {
  const { c, log } = finishedLegGame()
  const kept = correctDart(c, log, visitBySeq(replay(c, log), 0)!, 0, { segment: 19, multiplier: 3 }).keepResult!.throws
  const again = correctDart(c, kept, visitBySeq(replay(c, kept), 0)!, 1, { segment: 19, multiplier: 3 })
  assert.deepEqual(replay(c, again.keepResult!.throws).legsWon, [1, 0])
})
