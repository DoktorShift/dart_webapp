import { query, subscribe, type Closer } from "../nostr/client.ts"
import type { Filter, NostrEvent } from "../nostr/types.ts"
import { KIND_RECORD } from "../protocol/kinds.ts"
import { tagValue } from "../protocol/tags.ts"
import { tournamentRelays } from "./send.ts"
import { loadStoredTournament, storedTournaments, updateTournament, type StoredTournament } from "./store.ts"

// What relays hold about tournaments, and bringing the local copies up to date. "No relay
// answered" is unknown, never empty: callers keep showing what this device has, with the time
// relays last answered. Live matches of a tournament's boards are not tournament records; the
// screens follow them through lib/live (watchFoundings) by the boards' keys.

// Relays answer a request with at most a few hundred events (nak and most public relays: 500),
// and a tournament of 128 players is about 650 records. So each relay is read on its own, newest
// first, in pages of this size, each page asking for what is older than that relay's last one:
// relays that hold different records (one was down for a while) never cut each other's pages.
const PAGE = 400
const MAX_PAGES = 10

export interface Fetched {
  events: NostrEvent[]
  // At least one relay answered.
  answered: boolean
  // Every relay that answered was read to its end.
  complete: boolean
}

// One relay's records of the tournament (and the founding), added to `into`. A page that brings
// nothing new from this relay was its last; the next page includes the oldest second again, as
// records of one second may be split across pages.
async function readRelay(tournament: string, relay: string, into: Map<string, NostrEvent>): Promise<{ answered: boolean; complete: boolean }> {
  const seen = new Set<string>()
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const records: Filter = { kinds: [KIND_RECORD], "#e": [tournament], limit: PAGE, ...(until !== undefined ? { until } : {}) }
    const result = await query(page === 0 ? [{ ids: [tournament] }, records] : [records], [relay])
    if (result.answered.length === 0) return { answered: page > 0, complete: false }
    let added = 0
    let oldest = until ?? Number.MAX_SAFE_INTEGER
    for (const event of result.events) {
      into.set(event.id, event)
      if (seen.has(event.id)) continue
      seen.add(event.id)
      added++
      if (event.id !== tournament) oldest = Math.min(oldest, event.created_at)
    }
    if (added === 0) return { answered: true, complete: true }
    until = oldest
  }
  return { answered: true, complete: false }
}

export async function fetchTournament(tournament: string, hints: readonly string[]): Promise<Fetched> {
  const events = new Map<string, NostrEvent>()
  const relays = await Promise.all(tournamentRelays(hints).map((relay) => readRelay(tournament, relay, events)))
  const answering = relays.filter((r) => r.answered)
  return { events: [...events.values()], answered: answering.length > 0, complete: answering.every((r) => r.complete) }
}

// New records of a tournament while its screen is open (a registration, a result, a call),
// whenever they were signed: a board that was offline delivers its result later, dated when it
// was played. Only what arrives from now on (limit 0); what came while the connection was down
// the screen fetches again (useTournament refreshes when the device is back online).
export function watchTournament(tournament: string, hints: readonly string[], onEvent: (event: NostrEvent) => void): Closer {
  return subscribe([{ kinds: [KIND_RECORD], "#e": [tournament], limit: 0 }], tournamentRelays(hints), { onevent: (event) => onEvent(event) })
}

const inFlight = new Map<string, Promise<StoredTournament>>()

// One refresh per tournament at a time: the home list and an open tournament ask together.
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
  return updateTournament(tournament, { events: found.events, relays: hints, ...(found.answered && found.complete ? { loadedAt: Date.now() } : {}) })
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
