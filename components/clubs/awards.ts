import { currentPlan, type BadgeOccasion } from "../../lib/badges/organizer.ts"
import { readClub } from "../../lib/clubs/club.ts"
import type { ClubGame } from "../../lib/clubs/games.ts"
import { loadStoredClub } from "../../lib/clubs/store.ts"
import { rulesOf, seasonTable } from "../../lib/clubs/table.ts"
import { nowSeconds } from "../../lib/nostr/time.ts"
import { getSession } from "../../lib/profile/session.ts"
import { mayIssueClubBadge, type ClubSeason, type ClubState } from "../../lib/protocol/club-state.ts"

// A club's side of its badges (lib/badges/organizer.ts): the end of a season is their occasion
// and its end record their evidence. The clubs also answer the badges area's questions about a
// club (registered in ./register.ts): who may award its badges, an owner or admin at the award's
// time (mayIssueClubBadge), and whether a season's awards still stand. Both read the club's copy
// on this device without asking the signer; a club not kept here is unknown, and the badges area
// doesn't show its badges then.

export type SeasonEnd = NonNullable<ClubSeason["ended"]>

// The occasion of a season's end: its final table's places (players with a profile and enough
// games for a rank) and the games counted for each.
export function seasonOccasion(state: ClubState, season: ClubSeason, ended: SeasonEnd, games: readonly ClubGame[]): BadgeOccasion {
  const table = seasonTable({ ...season, ended }, games, state.results[season.id])
  return {
    scope: "club",
    scopeId: state.id,
    occasionId: season.id,
    name: season.name,
    ended,
    places: table.ranked.flatMap((row) => (row.rank === null ? [] : [{ pubkey: row.pubkey, place: row.rank, games: row.games }])),
    minGames: table.rules.minGames,
  }
}

// Whether the awards resting on `evidence` (a season's end record) still stand: no game recorded
// in the season was corrected or voided at or after its end, which would change its final table.
// undefined when no season of this club ended with that record.
export function seasonStands(state: ClubState, games: readonly ClubGame[], evidence: string): boolean | undefined {
  const season = Object.values(state.seasons).find((s) => s.ended?.event === evidence)
  if (!season?.ended) return undefined
  const end = season.ended.at
  const modes = rulesOf(season).modes
  return !games.some((g) => g.named >= season.starts && g.named <= end && modes.includes(g.agreement.rules.modeId) && g.revisedAt !== null && g.revisedAt >= end)
}

// The ends of the seasons `issuer` ended whose badges aren't all given yet. A season whose awards
// can't be told (no relay answered) isn't listed: unknown is not missing.
export async function seasonsMissingAwards(state: ClubState, games: readonly ClubGame[], issuer: string): Promise<BadgeOccasion[]> {
  const ended = Object.values(state.seasons).flatMap((season) => (season.ended?.by === issuer ? [seasonOccasion(state, season, season.ended, games)] : []))
  const plans = await Promise.all(ended.map(async (occasion) => ({ occasion, plan: await currentPlan(issuer, occasion) })))
  return plans.flatMap(({ occasion, plan }) => (plan && plan.missing.length > 0 ? [occasion] : []))
}

// The club as this device has it, replayed with the content keys it opened before.
async function clubHere(club: string): Promise<{ state: ClubState; games: ClubGame[] } | null> {
  const stored = await loadStoredClub(club)
  if (!stored) return null
  const { view } = await readClub(stored, { reader: getSession()?.pubkey ?? null, signer: null, now: nowSeconds() })
  return view.state ? { state: view.state, games: view.games } : null
}

// The badges area's two questions (lib/badges/issuers.ts IssuerCheck).
export async function mayAward(club: string, issuer: string, at: number): Promise<boolean | undefined> {
  const here = await clubHere(club)
  return here ? mayIssueClubBadge(here.state, issuer, at) : undefined
}

export async function awardsStand(club: string, evidence: string): Promise<boolean | undefined> {
  const here = await clubHere(club)
  return here ? seasonStands(here.state, here.games, evidence) : undefined
}
