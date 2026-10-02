import { test } from "node:test"
import assert from "node:assert/strict"
import { suggestCheckout } from "../lib/game/checkout.ts"

const value = (label: string) =>
  label === "Bull" ? 50 : label === "25" ? 25 : label.startsWith("T") ? 3 * +label.slice(1) : label.startsWith("D") ? 2 * +label.slice(1) : +label

test("every double-out route adds up, fits the darts left and ends on a double", () => {
  for (let score = 2; score <= 170; score++) {
    for (let darts = 1; darts <= 3; darts++) {
      const route = suggestCheckout(score, darts, true)
      if (!route) continue
      assert.equal(route.reduce((sum, l) => sum + value(l), 0), score, `${score} with ${darts}`)
      assert.ok(route.length <= darts, `${score} with ${darts}`)
      assert.ok(/^D\d+$|^Bull$/.test(route.at(-1)!), `${score} with ${darts}`)
    }
  }
})

test("bogey numbers have no route", () => {
  for (const score of [159, 162, 163, 165, 166, 168, 169]) assert.equal(suggestCheckout(score, 3, true), null)
})

test("standard routes", () => {
  assert.deepEqual(suggestCheckout(170, 3, true), ["T20", "T20", "Bull"])
  assert.deepEqual(suggestCheckout(125, 3, true), ["25", "T20", "D20"])
  assert.deepEqual(suggestCheckout(158, 3, true), ["T20", "T20", "D19"])
  assert.deepEqual(suggestCheckout(61, 2, true), ["T15", "D8"])
  assert.equal(suggestCheckout(99, 2, true), null)
})

test("single out", () => {
  assert.deepEqual(suggestCheckout(180, 3, false), ["T20", "T20", "T20"])
  assert.deepEqual(suggestCheckout(57, 1, false), ["T19"])
})
