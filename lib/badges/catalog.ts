import type { GameType } from "../game/types.ts"

// The BlueLine badge catalog (PLAN.md "Auszeichnungen gewinnen und im Profil zeigen"): which
// badges exist, the exact rule of each, the data it needs and the rule's version. Their names and
// explanations are in the language catalogs (lib/i18n/features/badges.screens.*), by id; a
// published definition carries them in the language it was published in.
//
// A rule never changes under its version. A new condition is a new version, and with it the d tag
// of the definition (blueline:<scope>:…:<id>:v<version>, lib/protocol/badges.ts badgeD), so an
// award keeps meaning what it meant when it was given. A new picture changes no achievement.
//
// Personal milestones are reached by a player on their own games (lib/badges/milestones.ts):
// first "on this device", in public only as "Selbst erreicht" once the player shows them
// (decision 0001, F3). Club and tournament badges come from the named organizer, recognitions
// from whoever gives them (lib/badges/organizer.ts).

// "results": who played and who won, which 1.0.0 results know too. "throws": the full throw log,
// scored by the game engine; imported totals never reach such a milestone.
export type DataBasis = "results" | "throws"

// What a milestone measures in one game, in whole units (averages in hundredths):
// "games" and "wins" are counted across games; every other figure is one game's.
export type Measure =
  | "games" // finished games, practice included
  | "wins" // games won against at least one other player
  | "highestVisit" // X01: the best visit, in points
  | "highestCheckout" // X01: the best finish, in points
  | "perfectLeg" // X01: darts of a leg won in the fewest darts possible (9 in 501), else none
  | "average" // X01: points per three darts across the game, × 100
  | "marksPerRound" // Cricket: marks per three darts across the game, × 100
  | "triplesInVisit" // Cricket: triples on 15 to 20 in one visit (three are nine marks)
  | "clockDarts" // Around the Clock: darts for a whole round, in the fewest leg won

export interface Milestone {
  id: string
  version: number
  // Where it is listed: games of every kind, or one game type.
  group: "games" | GameType
  basis: DataBasis
  measure: Measure
  // Reached when a figure is at least the target (counts: when the count gets there). Figures
  // where fewer is better ("clockDarts") are reached at or below it.
  target: number
}

const milestone = (id: string, group: Milestone["group"], basis: DataBasis, measure: Measure, target: number): Milestone => ({ id, version: 1, group, basis, measure, target })

export const MILESTONES: readonly Milestone[] = [
  milestone("first-win", "games", "results", "wins", 1),
  milestone("games-10", "games", "results", "games", 10),
  milestone("games-50", "games", "results", "games", 50),
  milestone("games-100", "games", "results", "games", 100),
  milestone("first-100", "x01", "throws", "highestVisit", 100),
  milestone("first-140", "x01", "throws", "highestVisit", 140),
  milestone("first-180", "x01", "throws", "highestVisit", 180),
  milestone("checkout-100", "x01", "throws", "highestCheckout", 100),
  // Reached with any perfect leg; its figure is the darts it took (perfectLegDarts in the engine).
  milestone("perfect-leg", "x01", "throws", "perfectLeg", 1),
  milestone("average-40", "x01", "throws", "average", 4000),
  milestone("average-60", "x01", "throws", "average", 6000),
  milestone("average-80", "x01", "throws", "average", 8000),
  milestone("cricket-mpr-3", "cricket", "throws", "marksPerRound", 300),
  milestone("cricket-nine-marks", "cricket", "throws", "triplesInVisit", 3),
  milestone("clock-30", "clock", "throws", "clockDarts", 30),
]

// Fewer is better for these figures.
export const lowerIsBetter = (measure: Measure) => measure === "clockDarts"

export const milestoneById = (id: string): Milestone | undefined => MILESTONES.find((m) => m.id === id)

// Badges an organizer awards from their own device when a tournament or a club season ends
// (lib/badges/organizer.ts has who gets which), and the recognition anyone can give by name.
export const ORGANIZER_BADGES = {
  "tournament-winner": { scope: "tournament", version: 1 },
  "tournament-finalist": { scope: "tournament", version: 1 },
  "tournament-participant": { scope: "tournament", version: 1 },
  "season-winner": { scope: "club", version: 1 },
  "season-regular": { scope: "club", version: 1 },
} as const
export type OrganizerBadgeId = keyof typeof ORGANIZER_BADGES

export const RECOGNITION_VERSION = 1
