export type Multiplier = 1 | 2 | 3

// segment 0 = miss, 1–20 = numbers, 25 = bull (multiplier 1 = outer bull 25, 2 = bullseye 50)
export interface Dart {
  segment: number
  multiplier: Multiplier
}

// Where a throw was entered: its visit number and leg. Replay uses these so a correction
// earlier in the log never shifts later darts onto the wrong player or into the wrong leg.
export interface ThrowMeta {
  visit?: number
  leg?: number
  edited?: boolean
  // Set on the last throw of a finished leg whose result was kept after a correction:
  // the leg ends here with this thrower as winner, whatever the corrected scores add up to.
  closesLeg?: boolean
}

export type Throw =
  | ({ kind: "dart"; dart: Dart } & ThrowMeta)
  // A whole visit entered as a total (x01 only); atDouble = darts thrown at a double.
  | ({ kind: "visit"; total: number; darts: number; atDouble?: number } & ThrowMeta)
  // The rest of the visit missed (off the board, bounce-outs), undone in one step.
  | ({ kind: "noScore" } & ThrowMeta)
  // Someone else is throwing: wrong order, or a different player starts the leg.
  | ({ kind: "turn"; player: number } & ThrowMeta)
  // A player leaves the game; the others play on.
  | ({ kind: "retire"; player: number } & ThrowMeta)

export type GameType = "x01" | "cricket" | "clock"

export interface MatchPlayer {
  id: string
  name: string
}

export interface MatchConfig {
  modeId: string
  modeName: string
  type: GameType
  startScore: number
  doubleOut: boolean
  // x01: scoring starts with a double (or the bull). Older saved games don't have it: off.
  doubleIn?: boolean
  cutThroat: boolean
  bullFinish: boolean
  // Legs to win the game, or to win a set when the game is played in sets.
  legsToWin: number
  // Sets to win the game; 1 (or missing, in older saved games) means no sets.
  setsToWin?: number
  // Who throws first in the next leg: take turns, or the loser of the last leg ("mugs away").
  startRule?: "alternate" | "loser"
  players: MatchPlayer[]
}

export interface SavedMatch {
  id: string
  config: MatchConfig
  throws: Throw[]
  startedAt: string
  // Legs whose "leg won" sheet the players have dismissed.
  acknowledgedLegs: number
  // "paused" when the players chose Save and leave.
  status: "playing" | "paused"
  // Corrections, so Undo can take a correction back in one step.
  edits?: { before: Throw[]; afterLength: number }[]
}
