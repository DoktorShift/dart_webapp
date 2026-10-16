import { query, subscribe, type Closer } from "../nostr/client.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { Filter, NostrEvent } from "../nostr/types.ts"
import { KIND_RECORD } from "../protocol/kinds.ts"
import { tagValue } from "../protocol/tags.ts"
import { resendUnsent, tournamentRelays } from "./send.ts"
import { loadStoredTournament, storedTournaments, updateTournament, type StoredTournament } from "./store.ts"

// What relays hold about tournaments, and bringing the local copies up to date. "No relay
// answered" is unknown, never empty: callers keep showing what this device has, with the time
// relays last answered. Live matches of a tournament's boards are not tournament records; the
// screens follow them through lib/live (watchFoundings) by the boards' keys.

const filtersOf = (tournament: string): Filter[] => [{ ids: [tournament] }, { kinds: [KIND_RECORD], "#e": [tournament] }]

// Relays answer a request with at most a few hundred events (nak and most public relays: 500),
// and a tournament of 128 players is about 650 records. So the records are fetched newest
// first in pages of this size, each page asking for what is older than the last.
const PAGE = 400
const MAX_PAGES = 10

export interface Fetched {
  events: NostrEvent[]
  // At least one relay answered completely.
  answered: boolean
}

export async function fetchTournament(tournament: string, hints: readonly string[]): Promise<Fetched> {
  const relays = tournamentRelays(hints)
  const events = new Map<string, NostrEvent>()
  let answered = false
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const records: Filter = { kinds: [KIND_RECORD], "#e": [tournament], limit: PAGE, ...(until !== undefined ? { until } : {}) }
    const result = await query(page === 0 ? [{ ids: [tournament] }, records] : [records], relays)
    answered ||= result.answered.length > 0
    let added = 0
    let oldest = until ?? Number.MAX_SAFE_INTEGER
    for (const event of result.events) {
      if (!events.has(event.id)) added++
      events.set(event.id, event)
      if (event.id !== tournament) oldest = Math.min(oldest, event.created_at)
    }
    // A page that brought nothing new, or fewer than asked, was the last one. The next page
    // includes the oldest second again: records of one second may be split across pages.
    if (added === 0 || result.events.length < PAGE) break
    until = oldest
  }
  return { events: [...events.values()], answered }
}

// New records of a tournament while its screen is open (a registration, a result, a call).
export function watchTournament(tournament: string, hints: readonly string[], onEvent: (event: NostrEvent) => void): Closer {
  const since = nowSeconds() - 60
  return subscribe(
    filtersOf(tournament).map((filter) => ("ids" in filter ? filter : { ...filter, since })),
    tournamentRelays(hints),
    { onevent: (event) => onEvent(event) },
  )
}

const inFlight = new Map<string, Promise<StoredTournament>>()

// One refresh per tournament at a time: the home list and an open tournament ask together.
// What this device signed and no relay confirmed goes out again on the way.
export function refreshTournament(tournament: string, hints: readonly string[] = []): Promise<StoredTournament> {
  const running = inFlight.get(tournament)
  if (running) return running
  const run = refresh(tournament, hints).finally(() => inFlight.delete(tournament))
  inFlight.set(tournament, run)
  return run
}

async function refresh(tournament: string, hints: readonly string[]): Promise<StoredTournament> {
  const known = (await loadStoredTournament(tournament)) ?? (await updateTournament(tournament, { relays: hints }))
  const found = await fetchTournament(tournament, [...known.relays, ...hints])
  const stored = await updateTournament(tournament, { events: found.events, relays: hints, ...(found.answered ? { loadedAt: Date.now() } : {}) })
  if (found.answered && stored.unsent.length > 0) {
    await resendUnsent(tournament).catch(() => false)
    return (await loadStoredTournament(tournament)) ?? stored
  }
  return stored
}

// The tournaments a profile founded, registered for or claimed a place in, from its own records
// (a new device, or a tournament joined on another one). Returns whether relays answered.
export async function discoverTournaments(pubkey: string): Promise<boolean> {
  const result = await query([{ kinds: [KIND_RECORD], authors: [pubkey], "#l": ["tournament.found", "tournament.register", "tournament.claim"] }], tournamentRelays())
  const found = new Set(result.events.map((event) => tagValue(event.tags, "e") ?? event.id))
  const known = new Set((await storedTournaments()).map((t) => t.tournament))
  for (const tournament of found) if (!known.has(tournament)) await updateTournament(tournament, {})
  return result.answered.length > 0
}
