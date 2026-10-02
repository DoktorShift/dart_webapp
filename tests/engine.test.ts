import { test } from "node:test"
import assert from "node:assert/strict"
import { marksPerRound, replay, restartLegLog, threeDartAverage } from "../lib/game/engine.ts"
import { config, dart, miss3, play } from "./helpers.ts"

test("x01: darts subtract once and a visit is three darts", () => {
  const s = replay(config({ startScore: 101 }), [dart(20, 3), dart(20), dart(1)])
  assert.deepEqual(s.scores, [20, 101])
  assert.equal(s.current, 1)
})

test("x01: a bust ends the visit and resets to the visit start", () => {
  const c = config({ startScore: 101 })
  const s = replay(c, [dart(20, 3), dart(20), dart(1), ...miss3(), dart(19, 3)])
  assert.deepEqual(s.scores, [20, 101])
  assert.equal(s.outcome.type, "bust")
})

test("x01: leaving 1 or finishing on a single is a bust with double out", () => {
  assert.equal(replay(config({ startScore: 32 }), [dart(19), dart(12)]).scores[0], 32)
  assert.equal(replay(config({ startScore: 32 }), [dart(16), dart(16)]).scores[0], 32)
  assert.equal(replay(config({ startScore: 32, doubleOut: false }), [dart(16), dart(16)]).winner, 0)
  assert.equal(replay(config({ startScore: 50 }), [dart(25, 2)]).winner, 0)
})

test("x01: visit totals, including busts and checkouts", () => {
  const s = replay(config(), [
    { kind: "visit", total: 180, darts: 3 },
    { kind: "visit", total: 60, darts: 3 },
    { kind: "visit", total: 100, darts: 3 },
  ])
  assert.deepEqual(s.scores, [221, 441])
  assert.equal(s.stats[0].max180s, 1)
  assert.equal(replay(config({ startScore: 40 }), [{ kind: "visit", total: 41, darts: 3 }]).outcome.type, "bust")
  assert.equal(replay(config({ startScore: 40 }), [{ kind: "visit", total: 40, darts: 2 }]).winner, 0)
})

test("x01: 3-dart average", () => {
  const s = replay(config(), [dart(20, 3), dart(20, 3), dart(20, 3)])
  assert.equal(threeDartAverage(s.stats[0]), 180)
})

test("no score ends the visit with misses, undone as one entry", () => {
  const s = replay(config({ startScore: 101 }), [dart(20), { kind: "noScore" }])
  assert.deepEqual(s.scores, [81, 101])
  assert.equal(s.stats[0].darts, 3)
  assert.equal(s.current, 1)
})

test("legs: the starter alternates, or the loser starts", () => {
  const c = config({ startScore: 40, legsToWin: 3 })
  assert.equal(replay(c, play(c, [dart(20, 2)])).current, 1)
  assert.equal(replay(c, play(c, [dart(20, 2), dart(20, 2)])).current, 0)
  const mugsAway = config({ startScore: 40, legsToWin: 3, startRule: "loser" })
  assert.equal(replay(mugsAway, play(mugsAway, [dart(20, 2), dart(20, 2)])).current, 0)
})

test("turns: a different player can throw, also at the start of a leg", () => {
  const c = config()
  const s = replay(c, play(c, [{ kind: "turn", player: 1 }, dart(20)]))
  assert.equal(s.legStarter, 1)
  assert.deepEqual(s.scores, [501, 481])
})

test("a player who leaves is skipped; the last one standing wins", () => {
  const three = config({ players: ["A", "B", "C"].map((name) => ({ id: name, name })) })
  const s = replay(three, play(three, [dart(20), { kind: "retire", player: 1 }, dart(20), dart(20)]))
  assert.deepEqual(s.active, [true, false, true])
  assert.equal(s.current, 2)
  assert.equal(replay(config(), play(config(), [{ kind: "retire", player: 1 }])).winner, 0)
})

test("cricket: marks, points and cut-throat", () => {
  const c = config({ type: "cricket", modeId: "cricket", startScore: 0 })
  let s = replay(c, [dart(20, 3), dart(20, 2), dart(0)])
  assert.deepEqual(s.points, [40, 0])
  s = replay(c, [dart(20, 3), ...miss3().slice(0, 2), dart(20, 3), dart(20, 3)])
  assert.deepEqual(s.points, [0, 0])
  s = replay({ ...c, cutThroat: true }, [dart(20, 3), dart(20, 2), dart(0)])
  assert.deepEqual(s.points, [0, 40])
  s = replay(c, [dart(20, 3), dart(19, 3), dart(18, 3), ...miss3(), dart(17, 3), dart(16, 3), dart(15, 3), ...miss3(), dart(25, 2), dart(25)])
  assert.equal(s.winner, 0)
  assert.equal(marksPerRound(s.stats[0]), 7.88)
})

test("around the clock: 1 to 20, optionally the bull", () => {
  const solo = config({ type: "clock", modeId: "clock", startScore: 0, players: [{ id: "a", name: "A" }] })
  const all = Array.from({ length: 20 }, (_, i) => dart(i + 1))
  assert.equal(replay(solo, all).winner, 0)
  const bull = { ...solo, bullFinish: true }
  const s = replay(bull, all)
  assert.equal(s.winner, null)
  assert.equal(s.clockTargets[s.progress[0]], 25)
})

test("restarting a leg clears its darts but keeps players who left", () => {
  const three = config({ players: ["A", "B", "C"].map((name) => ({ id: name, name })) })
  const log = play(three, [dart(20), dart(20), dart(20), { kind: "retire", player: 2 }, dart(5)])
  const restarted = restartLegLog(log, 0)!
  const s = replay(three, restarted)
  assert.deepEqual(s.scores, [501, 501, 501])
  assert.deepEqual(s.active, [true, true, false])
  assert.equal(s.current, 0)
})
