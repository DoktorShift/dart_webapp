import { test } from "node:test"
import assert from "node:assert/strict"
import { compactBoardNames } from "../lib/game/board-names.ts"

test("crowded board names stay short, distinguish collisions and preserve unique first names", () => {
  const labels = compactBoardNames(["Anna Schmidt", "Anna Schneider", "Maximilianxxxxxx", "Carla von Testhausen", "Anna Schmitz", "Fritz"])
  assert.equal(labels[3], "Carla")
  assert.equal(new Set(labels.map((label) => label.toLowerCase())).size, labels.length)
  assert.ok(labels.every((label) => Array.from(label).length <= 10))
})
