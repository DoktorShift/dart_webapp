import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { goalText, parseGoal, reachedCount, readGoals, saveGoal, stepGoal, suggestedGoal } from "../lib/profile/goal.ts"

// Profil › Training › Ziel: a figure the player wants to reach, kept on this device.

beforeEach(resetStorage)

test("a goal is typed with a comma or a dot, a hit rate in percent, and must be within reason", () => {
  assert.equal(parseGoal("x01", "60"), 60)
  assert.equal(parseGoal("x01", "57,5"), 57.5)
  assert.equal(parseGoal("x01", " 57.25 "), 57.25)
  assert.equal(parseGoal("x01", "5"), null)
  assert.equal(parseGoal("x01", "181"), null)
  assert.equal(parseGoal("x01", "sixty"), null)
  assert.equal(parseGoal("x01", ""), null)
  assert.equal(parseGoal("cricket", "2,5"), 2.5)
  assert.equal(parseGoal("cricket", "12"), null)
  assert.equal(parseGoal("clock", "55"), 0.55)
  assert.equal(parseGoal("clock", "0"), null)
  assert.equal(parseGoal("clock", "100"), 1)
})

test("the goal comes back as the text to edit", () => {
  assert.equal(goalText("x01", 57.5), "57.5")
  assert.equal(goalText("x01", 60), "60")
  assert.equal(goalText("cricket", 2.25), "2.25")
  assert.equal(goalText("clock", 0.55), "55")
  assert.equal(goalText("x01", 57.5, "de"), "57,5")
  assert.equal(goalText("cricket", 2.25, "de"), "2,25")
})

test("goals are kept per game type and removed on their own", async () => {
  assert.deepEqual(await readGoals(), {})
  await saveGoal("x01", 60)
  await saveGoal("clock", 0.5)
  assert.deepEqual(await readGoals(), { x01: 60, clock: 0.5 })
  await saveGoal("x01", null)
  assert.deepEqual(await readGoals(), { clock: 0.5 })
})

test("the stepper starts a little above this month's figure and moves in sensible steps within the range", () => {
  assert.equal(suggestedGoal("x01", 50.1), 51)
  assert.equal(suggestedGoal("x01", 50), 51)
  assert.equal(suggestedGoal("x01", null), 60)
  assert.equal(suggestedGoal("cricket", 2.1), 2.25)
  assert.equal(suggestedGoal("clock", 0.47), 0.5)
  assert.equal(stepGoal("x01", 60, 1), 61)
  assert.equal(stepGoal("x01", 57.5, -1), 56.5)
  assert.equal(stepGoal("x01", 180, 1), 180)
  assert.equal(stepGoal("cricket", 2.5, 1), 2.75)
  assert.equal(stepGoal("clock", 0.5, -1), 0.45)
  assert.equal(stepGoal("clock", 0.03, -1), 0.01)
})

test("how many periods reached the goal", () => {
  assert.equal(reachedCount([50, null, 60, 61.2, 40], 60), 2)
  assert.equal(reachedCount([], 60), 0)
})
