import { applyThrow, newMatchState, perfectLegDarts, type MatchState } from "../game/engine.ts"
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

// The marks the engine credited in the player's best visit. A game's figures keep only the
// total, so the darts are replayed once more and every visit's marks are read off as they are
// credited (lib/game/engine.ts applyCricketDart: a hit on a number everyone closed scores none).
function bestVisitMarks(match: ArchivedMatch, seat: number): number | null {
  if (!match.config || !match.throws) return null
  const s = newMatchState(match.config)
  const perVisit = new Map<number, number>()
  let best = 0
  for (const t of match.throws) {
    const before = s.stats[seat].marks
    applyThrow(s, t)
    const visit = s.throwVisit[s.throwCount - 1]
    const marks = (perVisit.get(visit) ?? 0) + s.stats[seat].marks - before
    perVisit.set(visit, marks)
    best = Math.max(best, marks)
  }
  return s.stats[seat].darts > 0 ? best : null
}

type GameMeasure = Exclude<Measure, "games" | "wins">

// One game's figure; null when the game has none.
function figureOf(measure: GameMeasure, seat: number, match: ArchivedMatch, state: MatchState): number | null {
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
    case "marksInVisit":
      return bestVisitMarks(match, seat)
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
      figure = state ? figureOf(measure, seat, match, state) : null
      if (figure === null) continue
      progress = progress === null ? figure : lower ? Math.min(progress, figure) : Math.max(progress, figure)
    }
    if (reached(figure)) return { milestone, achieved: { matchId: match.id, finishedAt: match.finishedAt, modeId: match.modeId, value: figure }, progress: null }
  }
  return { milestone, achieved: null, progress }
}

type Who = Pick<StatsOptions, "aliases" | "sameAs">

// The player's games (statistics key, lib/storage/stats.ts playerKey) in the order they ended.
function gamesOf(matches: readonly ArchivedMatch[], key: string, options: Who): PlayedGame[] {
  const games: PlayedGame[] = []
  for (const match of [...matches].sort(byFinish)) {
    const seat = match.players.findIndex((p) => playerKey(match, p, options.aliases, options.sameAs) === key)
    if (seat >= 0) games.push({ match, seat, state: matchState(match) })
  }
  return games
}

// Every milestone of the catalog for the player with this statistics key, in catalog order.
export function evaluateMilestones(matches: readonly ArchivedMatch[], key: string, options: Who = {}): MilestoneStatus[] {
  const games = gamesOf(matches, key, options)
  return MILESTONES.map((m) => evaluate(m, games))
}

// Whether one game still meets a milestone for the player, after corrections: its own figure
// does (a count: the count up to it). null when the game is not on this device, so nothing
// can be said about it here.
export function holdsIn(milestone: Milestone, matches: readonly ArchivedMatch[], key: string, matchId: string, options: Who = {}): boolean | null {
  const games = gamesOf(matches, key, options)
  const index = games.findIndex((g) => g.match.id === matchId)
  if (index < 0) return null
  if (milestone.measure === "games" || milestone.measure === "wins") return evaluate(milestone, games.slice(0, index + 1)).achieved !== null
  return evaluate(milestone, [games[index]]).achieved !== null
}

// The milestones a game made this player reach: the ones whose first game it is.
export const reachedIn = (statuses: readonly MilestoneStatus[], matchId: string) => statuses.filter((s) => s.achieved?.matchId === matchId)
