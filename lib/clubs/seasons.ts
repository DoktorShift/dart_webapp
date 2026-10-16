import type { SeasonRules } from "../protocol/club.ts"
import type { ClubSeason, ClubState } from "../protocol/club-state.ts"
import { buildRecord } from "../protocol/records.ts"
import { newObjectId } from "../storage/ids.ts"
import type { ClubGame } from "./games.ts"
import { afterState, send, type Author, type Sent } from "./send.ts"

// Seasons and their rules (PLAN.md "Clubs und Saisons"): set up before the first game that
// counts, versioned, changed after the start only with a reason everyone sees; leaders decide
// results the rules can't (club.result). The table itself is table.ts.

export const DEFAULT_RULES: SeasonRules = {
  modes: ["501"],
  points: { win: 2, draw: 1, loss: 0 },
  confirmations: "opponent",
  minGames: 0,
  tiebreak: ["headToHead", "legDifference", "wins", "average"],
}

const seal = (state: ClubState) => (state.info.visibility === "closed" ? { seal: { readers: Object.keys(state.members) } } : {})

export interface SeasonInput {
  name: string
  starts: number
  ends?: number
  rules: SeasonRules
}

export function createSeason(state: ClubState, input: SeasonInput, author: Author): Promise<Sent> {
  const content = { season: newObjectId(), name: input.name.trim(), starts: input.starts, ...(input.ends !== undefined ? { ends: input.ends } : {}), rules: input.rules }
  return send(state.id, [{ template: buildRecord("club.season", content, { created_at: afterState(state), root: state.id }), ...seal(state) }], author)
}

// A new version of the rules. From the season's start on it needs a reason (the reducer refuses
// it without one): a table never changes silently.
export function changeRules(state: ClubState, season: ClubSeason, rules: SeasonRules, author: Author, reason?: string): Promise<Sent> {
  const last = season.versions[season.versions.length - 1]
  const content = { season: season.id, version: last.version + 1, rules, ...(reason?.trim() ? { reason: reason.trim() } : {}) }
  return send(state.id, [{ template: buildRecord("club.season.rules", content, { created_at: afterState(state), root: state.id }), ...seal(state) }], author)
}

export const endSeason = (state: ClubState, season: ClubSeason, author: Author) =>
  send(state.id, [{ template: buildRecord("club.season.end", { season: season.id }, { created_at: afterState(state), root: state.id }), ...seal(state) }], author)

// A leader decides whether this exact result counts for the season (a disputed one, or one no
// player with a profile can confirm).
export function decideResult(state: ClubState, season: ClubSeason, game: ClubGame, count: boolean, author: Author, reason?: string): Promise<Sent> {
  if (!game.result) throw new Error("no result to decide")
  const before = state.results[season.id]?.[game.match]
  const content = { season: season.id, match: game.match, result: game.result.event, count, prev: before?.event ?? state.id, ...(reason?.trim() ? { reason: reason.trim() } : {}) }
  return send(state.id, [{ template: buildRecord("club.result", content, { created_at: afterState(state, game.result.at), root: state.id }), ...seal(state) }], author)
}

export const seasonStarted = (season: ClubSeason, now: number) => season.starts <= now
