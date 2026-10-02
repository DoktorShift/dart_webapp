import { test } from "node:test"
import assert from "node:assert/strict"
import { checkoutRate, perfectLegDarts, replay } from "../lib/game/engine.ts"
import { config, dart } from "./helpers.ts"

const visit = (total: number, darts = 3, atDouble?: number) => ({ kind: "visit" as const, total, darts, atDouble })

test("perfect legs: a nine-darter in 501, per dart or by visit totals", () => {
  const c = config({ players: [{ id: "a", name: "A" }] })
  const perDart = replay(c, [
    ...Array.from({ length: 6 }, () => dart(20, 3)),
    dart(20, 3),
    dart(19, 3),
    dart(12, 2),
  ])
  assert.equal(perDart.winner, 0)
  assert.equal(perfectLegDarts(c, perDart.legResults[0]), 9)

  const byTotals = replay(c, [visit(180), visit(180), visit(141)])
  assert.equal(perfectLegDarts(c, byTotals.legResults[0]), 9)
})

test("perfect legs: other legs and other games are not called out", () => {
  const c = config({ players: [{ id: "a", name: "A" }] })
  const twelve = replay(c, [visit(180), visit(180), visit(100), visit(41)])
  assert.equal(perfectLegDarts(c, twelve.legResults[0]), null)

  const short = config({ startScore: 301, players: [{ id: "a", name: "A" }] })
  assert.equal(perfectLegDarts(short, replay(short, [visit(180), visit(121)]).legResults[0]), 6)
})

test("checkout rate: without the darts-at-double question, visits on a double count every dart", () => {
  const c = config({ startScore: 40, players: [{ id: "a", name: "A" }] })
  // Two visits that missed the double, then a checkout with the second dart.
  const s = replay(c, [visit(0), visit(0), visit(40, 2)])
  assert.equal(s.stats[0].dartsAtDouble, 3 + 3 + 2)
  assert.equal(Math.round((checkoutRate(s.stats[0]) ?? 0) * 100), 13)
})

test("checkout rate: the scorer's answer wins over the estimate", () => {
  const c = config({ startScore: 40, players: [{ id: "a", name: "A" }] })
  const s = replay(c, [visit(0, 3, 1), visit(40, 3, 3)])
  assert.equal(s.stats[0].dartsAtDouble, 4)
})

test("checkout rate: a checkout from outside double range counts one dart at the double", () => {
  const c = config({ startScore: 100, players: [{ id: "a", name: "A" }] })
  const s = replay(c, [visit(100, 3)])
  assert.equal(s.stats[0].dartsAtDouble, 1)
})
