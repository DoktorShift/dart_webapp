import { correctDart, replay, tagThrow, visitBySeq } from "../lib/game/engine.ts"
import type { MatchConfig, Throw } from "../lib/game/types.ts"
import type { V1MatchRecord } from "../lib/storage/v1.ts"
import { config, dart, play } from "./helpers.ts"
import { ANNA, BEN, saved } from "./storage-helpers.ts"

// Example games with figures worked out by hand (see the comments), not by running the code
// under test.

const players = [
  { id: ANNA, name: "Anna" },
  { id: BEN, name: "Ben" },
]
const visit = (total: number, darts = 3, atDouble?: number): Throw => ({ kind: "visit", total, darts, ...(atDouble === undefined ? {} : { atDouble }) })
const misses = () => [dart(0), dart(0), dart(0)]

// A: 301, double out, entered dart by dart. Anna wins in 6 darts.
//   Anna T20 T20 T20 = 180 (121 left) · Ben 20 20 20 = 60 · Anna T20 T15 D8 = 121, checkout.
//   Anna: 6 darts, 301 points, average 150.5. Darts at a double: only D8 (16 left) = 1.
//   Ben: 3 darts, 60 points, never on a double.
export const A_CONFIG: MatchConfig = config({ modeId: "301", modeName: "301", startScore: 301, players })
export const matchA = () =>
  saved(A_CONFIG, play(A_CONFIG, [dart(20, 3), dart(20, 3), dart(20, 3), dart(20), dart(20), dart(20), dart(20, 3), dart(15, 3), dart(8, 2)]), "match-a")

// B: 301, double out, visit totals without "darts at a double". Ben wins.
//   Anna 100 (201) · Ben 140 (161) · Anna 60 (141) · Ben 26 (135) · Anna 41 (100) · Ben 135 checkout.
//   Anna: 9 darts, 201 points; every visit left more than 50, so no dart can have been at a double.
//   Ben: 9 darts, 301 points; the checkout's darts at a double weren't asked: not measured.
export const B_CONFIG: MatchConfig = config({ modeId: "301", modeName: "301", startScore: 301, players })
export const matchB = () => saved(B_CONFIG, play(B_CONFIG, [visit(100), visit(140), visit(60), visit(26), visit(41), visit(135)]), "match-b")

// C: a 1.0.0 result (totals only): 501, Anna beat Ben, 18 darts each, Anna 501 points, Ben 400.
export const recordC = (): V1MatchRecord => ({
  id: "mut3p9t1-9znimr",
  finishedAt: "2026-09-01T20:00:00.000Z",
  modeId: "501",
  modeName: "501",
  modeType: "x01",
  players: [
    { name: "Anna", won: true, darts: 18, points: 501 },
    { name: "Ben", won: false, darts: 18, points: 400 },
  ],
})

// D: Cricket. Anna T20 T19 T18 (9 marks) · Ben 3 misses · Anna T17 T16 T15 (9) · Ben 3 misses ·
//   Anna Bull (2 marks) and 25 (1): everything closed, 0 points each, Anna wins.
//   Anna: 8 darts, 21 marks, 7.875 marks per round. Ben: 6 darts, 0 marks.
export const D_CONFIG: MatchConfig = config({ modeId: "cricket", modeName: "Cricket", type: "cricket", startScore: 0, players })
export const matchD = () =>
  saved(
    D_CONFIG,
    play(D_CONFIG, [dart(20, 3), dart(19, 3), dart(18, 3), ...misses(), dart(17, 3), dart(16, 3), dart(15, 3), ...misses(), dart(25, 2), dart(25)]),
    "match-d",
  )

// E: Around the Clock alone. 24 darts, 4 of them misses: 20 hits, hit rate 20/24.
export const E_CONFIG: MatchConfig = config({ modeId: "clock", modeName: "Around the Clock", type: "clock", startScore: 0, players: [players[0]] })
export const matchE = () =>
  saved(
    E_CONFIG,
    play(
      E_CONFIG,
      [1, 2, 3, 4, 0, 5, 6, 7, 8, 9, 10, 0, 11, 12, 13, 14, 15, 16, 0, 17, 18, 19, 0, 20].map((n) => dart(n)),
    ),
    "match-e",
  )

// F: 101 with a bust. Anna T20 T19: bust after 2 darts, 0 points · Ben 3 misses · Anna T20 1 D20 = 101.
//   Anna: 5 darts, 101 points, average 60.6; one dart at a double (D20 at 40), one checkout.
//   Ben: 3 darts, 0 points: an average of 0, which is known, not missing.
export const F_CONFIG: MatchConfig = config({ modeId: "301", modeName: "301", startScore: 101, players })
export const matchF = () => saved(F_CONFIG, play(F_CONFIG, [dart(20, 3), dart(19, 3), ...misses(), dart(20, 3), dart(1), dart(20, 2)]), "match-f")

// G: 141 with a correction. Anna 20 20 20, then her first dart corrected to T20: 100 (41 left) ·
//   Ben 3 misses · Anna 1 (40 left), D20. Anna: 5 darts, 141 points, average 84.6.
export const G_CONFIG: MatchConfig = config({ modeId: "301", modeName: "301", startScore: 141, players })
const playOn = (c: MatchConfig, log: Throw[], throws: Throw[]) => throws.reduce<Throw[]>((acc, t) => [...acc, tagThrow(replay(c, acc), t)], log)
export function matchG() {
  const log = play(G_CONFIG, [dart(20), dart(20), dart(20), ...misses()])
  const corrected = correctDart(G_CONFIG, log, visitBySeq(replay(G_CONFIG, log), 0)!, 0, { segment: 20, multiplier: 3 }).rescored
  return saved(G_CONFIG, playOn(G_CONFIG, corrected, [dart(1), dart(20, 2)]), "match-g")
}

// H: 32, one player, a visit of 32 in 2 darts, both at a double (asked): 1 checkout in 2 darts.
// I: the same visit without asking: the darts at a double are an estimate, so unknown.
export const H_CONFIG: MatchConfig = config({ modeId: "301", modeName: "301", startScore: 32, players: [players[0]] })
export const matchH = () => saved(H_CONFIG, play(H_CONFIG, [visit(32, 2, 2)]), "match-h")
export const matchI = () => saved(H_CONFIG, play(H_CONFIG, [visit(32, 2)]), "match-i")

// J: 101, one player: visit 61 (40 left, so a dart at a double was possible, not asked), then
//   40 in 1 dart at a double (asked). The game's darts at a double are not fully known.
export const J_CONFIG: MatchConfig = config({ modeId: "301", modeName: "301", startScore: 101, players: [players[0]] })
export const matchJ = () => saved(J_CONFIG, play(J_CONFIG, [visit(61), visit(40, 1, 1)]), "match-j")
