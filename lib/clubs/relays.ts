import { query, subscribe, type Closer } from "../nostr/client.ts"
import { generalRelays, mergeRelays } from "../nostr/relays.ts"
import type { Filter, NostrEvent } from "../nostr/types.ts"
import { KIND_RECORD } from "../protocol/kinds.ts"
import { tagValue } from "../protocol/tags.ts"
import { CALENDAR_RSVP_KIND, CALENDAR_TIME_KIND } from "./dates.ts"

// What relays hold about clubs. Everything is asked at the general relays (decision 0002 §5)
// plus the relays an invite link named. "No relay answered" is unknown, never empty: callers
// keep showing what this device has, with the time relays last answered.

export const clubRelays = (hints: readonly string[] = []) => mergeRelays(generalRelays(), hints)

// What else belongs to a club once its records are read: the matches of its games and the
// addresses of its public dates (for their answers).
export interface ClubExtras {
  matches: readonly string[]
  dates: readonly string[]
}

export function clubFilters(club: string, extras: ClubExtras = { matches: [], dates: [] }): Filter[] {
  const filters: Filter[] = [
    { ids: [club] },
    { kinds: [KIND_RECORD], "#e": [club] },
    { kinds: [CALENDAR_TIME_KIND], "#e": [club] },
  ]
  if (extras.matches.length > 0) filters.push({ ids: [...extras.matches] }, { kinds: [KIND_RECORD], "#e": [...extras.matches] })
  if (extras.dates.length > 0) filters.push({ kinds: [CALENDAR_RSVP_KIND], "#a": [...extras.dates] })
  return filters
}

export interface Fetched {
  events: NostrEvent[]
  // At least one relay answered completely.
  answered: boolean
}

export async function fetchClub(club: string, hints: readonly string[], extras?: ClubExtras): Promise<Fetched> {
  const result = await query(clubFilters(club, extras), clubRelays(hints))
  return { events: result.events, answered: result.answered.length > 0 }
}

// New events of a club while its screen is open (a member joins, someone answers a date).
export function watchClub(club: string, hints: readonly string[], extras: ClubExtras, onEvent: (event: NostrEvent) => void): Closer {
  const since = Math.floor(Date.now() / 1000) - 60
  return subscribe(
    clubFilters(club, extras).map((filter) => ("ids" in filter ? filter : { ...filter, since })),
    clubRelays(hints),
    { onevent: (event) => onEvent(event) },
  )
}

// The invite record of a link and the club's founding: enough for the preview of a closed club,
// and the start of a public club's records.
export async function fetchInvite(club: string, invite: string, hints: readonly string[]): Promise<Fetched> {
  const result = await query([{ ids: [club, invite] }, { kinds: [KIND_RECORD], "#e": [club] }], clubRelays(hints))
  return { events: result.events, answered: result.answered.length > 0 }
}

// The clubs a profile founded or joined, from its own records (a new device, or a club joined
// on another one). Labels are readable in every club; what the clubs hold is not.
export async function fetchOwnClubs(pubkey: string): Promise<{ clubs: string[]; answered: boolean }> {
  const result = await query([{ kinds: [KIND_RECORD], authors: [pubkey], "#l": ["club.found", "club.join"] }], clubRelays())
  const clubs = result.events.map((event) => tagValue(event.tags, "e") ?? event.id)
  return { clubs: [...new Set(clubs)], answered: result.answered.length > 0 }
}

// Public clubs someone founded recently, as far as the relays asked keep them: best effort, no
// index behind it (decision 0001, "Kein kuratiertes Verzeichnis").
export async function fetchPublicClubs(limit = 50): Promise<Fetched> {
  const result = await query([{ kinds: [KIND_RECORD], "#l": ["club.found"], limit }], clubRelays())
  return { events: result.events, answered: result.answered.length > 0 }
}
