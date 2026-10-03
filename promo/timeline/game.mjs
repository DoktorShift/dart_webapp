// The game the film follows: six friends, 501, double out. Every number on screen comes from
// these darts through the app's own rules engine, so scores, checkout routes and the result
// screen's statistics are exactly what the app computes.
import { replay, tagThrow } from "../../lib/game/engine.ts"

export const NAMES = ["Mia", "Leo", "Sam", "Jonas", "Lena", "Ben"]
const S = (n) => ({ segment: n, multiplier: 1 })
const D = (n) => ({ segment: n, multiplier: 2 })
const T = (n) => ({ segment: n, multiplier: 3 })
export const BULL = { segment: 25, multiplier: 2 }
export const darts = { S, D, T }

// Visits per round, in throwing order. Round 1 is played on camera from Mia to Jonas; the late
// segment starts at Lena's visit in round 4, and Mia checks out 170 at the start of round 5.
export const ROUNDS = [
  [[T(20), S(20), T(20)], [S(20), T(20), S(5)], [T(19), S(19), S(3)], [S(20), S(1), S(20)], [T(20), T(20), S(20)], [S(5), S(20), S(1)]],
  [[T(20), S(20), S(5)], [S(20), S(20), S(20)], [T(19), S(19), S(19)], [T(20), S(20), S(1)], [T(20), S(20), S(20)], [S(20), S(20), S(5)]],
  [[S(20), S(20), S(20)], [T(20), S(20), S(20)], [S(19), S(19), S(19)], [S(20), S(20), S(20)], [T(20), T(17), S(10)], [S(20), S(0), S(20)]],
  [[S(20), S(6), S(20)], [T(20), S(20), S(1)], [S(20), S(20), S(20)], [S(20), S(5), S(20)], [T(20), T(20), S(10)], "noScore"],
]
export const CHECKOUT = [T(20), T(20), BULL]

export const players = (names) => names.map((name, i) => ({ id: `p${i + 1}`, name }))
export const config501 = (names) => ({
  modeId: "501", modeName: "501", type: "x01", startScore: 501, doubleOut: true, doubleIn: false,
  cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: players(names),
})

// A throw log as the app stores it (each throw tagged with its visit and leg).
export function throwLog(config, visits) {
  const log = []
  for (const visit of visits) {
    const throws = visit === "noScore" ? [{ kind: "noScore" }] : visit.map((dart) => ({ kind: "dart", dart }))
    for (const t of throws) log.push(tagThrow(replay(config, log), t))
  }
  return log
}

export const savedMatch = (id, config, throws) => ({
  id, config, throws, startedAt: "2026-10-03T19:00:00.000Z", acknowledgedLegs: 0, status: "playing",
})

export { replay }
