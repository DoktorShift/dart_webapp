import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { goalText, parseGoal, reachedCount, readGoals, saveGoal } from "../lib/profile/goal.ts"

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

test("how many periods reached the goal", () => {
  assert.equal(reachedCount([50, null, 60, 61.2, 40], 60), 2)
  assert.equal(reachedCount([], 60), 0)
})
