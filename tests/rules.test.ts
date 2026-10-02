import { test } from "node:test"
import assert from "node:assert/strict"
import { legPosition, legsWonInGame, replay, setScore } from "../lib/game/engine.ts"
import { config, dart, miss3, play } from "./helpers.ts"

// Double In and sets.

test("double in: darts count only from the first double on", () => {
  const c = config({ startScore: 301, doubleIn: true })
  const s = replay(c, play(c, [dart(20, 3), dart(20, 2), dart(20)]))
  assert.deepEqual(s.scores, [241, 301])
  assert.equal(s.legVisits[0].total, 60)
  assert.equal(s.stats[0].darts, 3)
})

test("double in: a visit without a double scores nothing, the bull opens too", () => {
  const c = config({ startScore: 301, doubleIn: true })
  const s = replay(c, play(c, [dart(20, 3), dart(19, 3), dart(18, 3), dart(25, 2), dart(20)]))
  assert.deepEqual(s.scores, [301, 231])
  assert.deepEqual(s.opened, [false, true])
  assert.equal(s.legVisits[0].total, 0)
})

test("double in: a visit total with points opens the player", () => {
  const c = config({ startScore: 301, doubleIn: true })
  const s = replay(c, play(c, [{ kind: "visit", total: 0, darts: 3 }, { kind: "visit", total: 45, darts: 3 }]))
  assert.deepEqual(s.opened, [false, true])
  assert.deepEqual(s.scores, [301, 256])
})

test("double in: every leg starts closed again", () => {
  const c = config({ startScore: 301, doubleIn: true, legsToWin: 2 })
  // A opens and wins leg 1 with visit totals; leg 2 needs a double again.
  const s = replay(c, play(c, [{ kind: "visit", total: 180, darts: 3 }, ...miss3(), { kind: "visit", total: 121, darts: 3 }]))
  assert.equal(s.legIndex, 1)
  assert.deepEqual(s.opened, [false, false])
})

test("without double in, nothing changes", () => {
  const s = replay(config({ startScore: 301 }), [dart(20, 3)])
  assert.deepEqual(s.scores, [241, 301])
  assert.deepEqual(s.opened, [true, true])
})

// Two legs to a set, two sets to win: A wins legs 1 and 2 (set 1), then legs 3 and 4 (set 2).
const sets = config({ startScore: 40, legsToWin: 2, setsToWin: 2 })
const legFor = (winnerThrowsFirst: boolean) => (winnerThrowsFirst ? [dart(20, 2)] : [...miss3(), dart(20, 2)])

test("sets: winning the legs of a set wins the set and starts the next one", () => {
  // Leg 1: A starts and checks out. Leg 2: B starts, misses, A checks out: set 1 to A.
  const s = replay(sets, play(sets, [...legFor(true), ...legFor(false)]))
  assert.equal(s.outcome.type, "set")
  assert.deepEqual(s.setsWon, [1, 0])
  assert.deepEqual(s.legsWon, [0, 0])
  assert.equal(s.setIndex, 1)
  assert.equal(s.winner, null)
  assert.deepEqual(setScore(s, 0), [2, 0])
})

test("sets: the next set starts with the next player, legs take turns within it", () => {
  const s = replay(sets, play(sets, [...legFor(true), ...legFor(false)]))
  // Set 1 was started by A, so B starts set 2.
  assert.equal(s.current, 1)
  assert.deepEqual(legPosition(s, 2), { set: 2, leg: 1 })
  assert.deepEqual(legPosition(s, 1), { set: 1, leg: 2 })
})

test("sets: the game is won with the sets it needs", () => {
  // Set 2: B starts leg 3 and misses, A checks out; A starts leg 4 and checks out.
  const s = replay(sets, play(sets, [...legFor(true), ...legFor(false), ...legFor(false), ...legFor(true)]))
  assert.equal(s.winner, 0)
  assert.equal(s.outcome.type, "match")
  assert.deepEqual(s.setsWon, [2, 0])
  assert.equal(legsWonInGame(s, 0), 4)
})

test("legs only: the game ends at the legs it needs, legs are named without sets", () => {
  const c = config({ startScore: 40, legsToWin: 2 })
  const s = replay(c, play(c, [...legFor(true), ...legFor(false)]))
  assert.equal(s.winner, 0)
  assert.deepEqual(s.legsWon, [2, 0])
  assert.deepEqual(legPosition(s, 1), { set: null, leg: 2 })
})
