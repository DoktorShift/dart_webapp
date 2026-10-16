import { isGuestId } from "../protocol/tournament.ts"
import type { TournamentRead } from "./read.ts"

// The end of a tournament, as the badges area wants it to give its badges (the badges track's
// lib/badges/organizer.ts `BadgeOccasion`, mirrored here field for field so the two modules
// need not import each other): who finished it signs the awards, every participant with a
// profile gets one, the winner and, in formats that end with a final, the finalist get theirs.
// Guest places count only once linked to a profile (the linked player is the recipient).
//
// Integration point (badges track, wired by the coordinator): the organizer's finish flow
// (components/tournaments/organize-screen.tsx) builds this and shows how many profiles would
// get badges; the call is
//   issueAwards(session.pubkey, occasion, (badge, name) => BADGES_TEXTS[locale].organizer[badge](name))
// from lib/badges/organizer.ts, which sends only what is missing and returns { given, known }.

export interface TournamentOccasion {
  scope: "tournament"
  scopeId: string
  occasionId: string
  name: string
  ended: { event: string; by: string; at: number }
  places: { pubkey: string; place: number; games: number }[]
  final: boolean
}

// Formats whose last match is a final between two players (the loser is the finalist).
const ENDS_WITH_FINAL = new Set(["single", "double", "groups"])

export function badgeOccasion(read: TournamentRead): TournamentOccasion | null {
  const { state, view } = read
  if (!state?.finished || !view) return null
  const profileOf = (participant: string) => (isGuestId(participant) ? (state.participants[participant]?.player ?? null) : participant)
  const games = (participant: string) => view.matches.filter((m) => m.state !== "void" && m.slots.some((s) => s.participant === participant)).length
  const places = view.placements.flatMap((p) => {
    const pubkey = profileOf(p.participant)
    return pubkey ? [{ pubkey, place: p.place, games: games(p.participant) }] : []
  })
  return {
    scope: "tournament",
    scopeId: state.id,
    occasionId: state.id,
    name: state.settings.name,
    ended: state.finished,
    places,
    final: ENDS_WITH_FINAL.has(state.settings.format),
  }
}
