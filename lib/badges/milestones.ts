import { perfectLegDarts, type MatchState } from "../game/engine.ts"
import type { ArchivedMatch } from "../storage/archive.ts"
import { matchState, playerKey, type StatsOptions } from "../storage/stats.ts"
import { lowerIsBetter, MILESTONES, type Measure, type Milestone } from "./catalog.ts"

// Which personal milestones (./catalog.ts) a player has reached on this device, in which game,
// and how far they are from the others ("7 von 10 Spielen"). Worked out from the archive every
// time, never stored: a corrected, undone or deleted game changes the answer by itself.
//
// Games count in the order they were finished. A milestone that needs throws looks only at games
// with their full throw log that this engine can score; imported 1.0.0 totals count for games and
// wins only (PLAN.md: "Vollständige passende Spieldaten").

export interface Achievement {
  matchId: string
  finishedAt: string
  modeId: string
  // The figure that met the condition, in the milestone's unit (catalog.ts Measure).
  value: number
}

export interface MilestoneStatus {
  milestone: Milestone
  // The first game it was reached in; null while it is not.
  achieved: Achievement | null
  // While not reached: the count so far, or the best figure so far; null when no game of the
  // kind it needs is known yet.
  progress: number | null
}

const time = (iso: string) => Date.parse(iso) || 0
const byFinish = (a: ArchivedMatch, b: ArchivedMatch) => time(a.finishedAt) - time(b.finishedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

interface PlayedGame {
  match: ArchivedMatch
  seat: number
  state: MatchState | null
}

// The player's visits in a scored game (the last leg's are still open when the game ends).
const visitsOf = (state: MatchState, seat: number) => [...state.pastLegs.flat(), ...state.legVisits].filter((v) => v.player === seat)

type GameMeasure = Exclude<Measure, "games" | "wins">

// One game's figure; null when the game has none.
function figureOf(measure: GameMeasure, seat: number, state: MatchState): number | null {
  const st = state.stats[seat]
  const legsWon = state.legResults.filter((r) => r.winner === seat)
  switch (measure) {
    case "highestVisit":
      return st.visits > 0 ? st.highestVisit : null
    case "highestCheckout":
      return st.highestCheckout > 0 ? st.highestCheckout : null
    case "perfectLeg":
      return legsWon.map((r) => perfectLegDarts(state.config, r)).find((darts) => darts !== null) ?? null
    case "average":
      return st.darts > 0 ? Math.floor((st.points * 300) / st.darts) : null
    case "marksPerRound":
      return st.darts > 0 ? Math.floor((st.marks * 300) / st.darts) : null
    case "triplesInVisit":
      return Math.max(0, ...visitsOf(state, seat).map((v) => v.darts.filter((d) => d.multiplier === 3 && d.segment >= 15 && d.segment <= 20).length))
    case "clockDarts":
      return legsWon.length > 0 ? Math.min(...legsWon.map((r) => r.dartsUsed)) : null
  }
}

function evaluate(milestone: Milestone, games: readonly PlayedGame[]): MilestoneStatus {
  const { measure, target } = milestone
  const lower = lowerIsBetter(measure)
  const reached = (figure: number) => (lower ? figure <= target : figure >= target)
  let progress: number | null = null
  for (const { match, seat, state } of games) {
    if (milestone.group !== "games" && match.modeType !== milestone.group) continue
    let figure: number | null
    if (measure === "games" || measure === "wins") {
      const counts = measure === "games" || (match.players.length >= 2 && match.players[seat].won)
      figure = (progress ?? 0) + (counts ? 1 : 0)
      progress = figure
    } else {
      // Only games with their full throw log have these figures.
      figure = state ? figureOf(measure, seat, state) : null
      if (figure === null) continue
      progress = progress === null ? figure : lower ? Math.min(progress, figure) : Math.max(progress, figure)
    }
    if (reached(figure)) return { milestone, achieved: { matchId: match.id, finishedAt: match.finishedAt, modeId: match.modeId, value: figure }, progress: null }
  }
  return { milestone, achieved: null, progress }
}

// Every milestone of the catalog for the player with this statistics key (lib/storage/stats.ts
// playerKey), in catalog order.
export function evaluateMilestones(matches: readonly ArchivedMatch[], key: string, options: Pick<StatsOptions, "aliases" | "sameAs"> = {}): MilestoneStatus[] {
  const games: PlayedGame[] = []
  for (const match of [...matches].sort(byFinish)) {
    const seat = match.players.findIndex((p) => playerKey(match, p, options.aliases, options.sameAs) === key)
    if (seat >= 0) games.push({ match, seat, state: matchState(match) })
  }
  return MILESTONES.map((m) => evaluate(m, games))
}

// The milestones a game made this player reach: the ones whose first game it is.
export const reachedIn = (statuses: readonly MilestoneStatus[], matchId: string) => statuses.filter((s) => s.achieved?.matchId === matchId)
