import { isAddressableKind, isReplaceableKind, query } from "../nostr/client.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { dbGetAll, dbWrite, type Keyed } from "../storage/db.ts"
import { KIND_PROFILE_BADGES_LEGACY } from "../protocol/badges.ts"
import { KIND_PROFILE_BADGES } from "../protocol/kinds.ts"
import { STATS_CARD_D } from "../protocol/profile.ts"
import { ROUND_D_PREFIX } from "./rounds.ts"
import { BLOCKED_RELAYS_KIND, ownReadRelays, RELAY_LIST_KIND, relaySettings, type RelaySettings } from "./relay-list.ts"
import { onSessionEnd, OWN_OBJECT_PREFIX } from "./session.ts"

// The signed-in profile's own replaceable events, as last seen: its metadata (0), relay list
// (10002), blocked relays (10006), stats card (31180 "stats"), player rounds (30000) and the
// badges it shows (10008, or the former 30008 "profile_badges"; lib/badges/selection.ts). Kept in
// the "objects" store, so the profile shows at once and offline; the local copy comes first
// (decision 0002 §1). An event signed here is kept before it is published, so a change is never
// lost to a missing connection; relays only ever replace it with a newer version.
// Everything here goes with the profile when it signs out (session.ts, "own:*"), and so do other
// areas' records of the profile kept under "own:" (badges: lib/badges/store.ts), which
// ownEvents() leaves out.

interface StoredEvent {
  id: string
  event: NostrEvent
}

// One entry per replaceable kind, or per kind and d tag ("0:", "31180:stats").
function coordinate(event: Pick<NostrEvent, "kind" | "tags">): string {
  const d = event.kind >= 30_000 && event.kind < 40_000 ? (event.tags.find((tag) => tag[0] === "d")?.[1] ?? "") : ""
  return `${event.kind}:${d}`
}

// NIP-01: the newer created_at wins; on a tie, the lower id.
const newer = (a: NostrEvent, b: NostrEvent) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id)

const isKept = (event: NostrEvent) => isReplaceableKind(event.kind) || isAddressableKind(event.kind)

export async function ownEvents(pubkey: string): Promise<Map<string, NostrEvent>> {
  const stored = await dbGetAll<StoredEvent>("objects")
  return new Map(stored.filter((s) => s.id.startsWith(OWN_OBJECT_PREFIX) && s.event.pubkey === pubkey && isKept(s.event)).map((s) => [coordinate(s.event), s.event]))
}

// Keeps the newest version of each of the profile's replaceable events; older ones, other
// people's and regular events are ignored.
export async function rememberOwn(pubkey: string, events: readonly NostrEvent[]) {
  const known = await ownEvents(pubkey)
  const fresh = new Map<string, NostrEvent>()
  for (const event of events) {
    if (event.pubkey !== pubkey || !isKept(event)) continue
    const key = coordinate(event)
    const current = fresh.get(key) ?? known.get(key)
    if (!current || newer(event, current)) fresh.set(key, event)
  }
  await dbWrite([...fresh].map(([key, event]) => ({ store: "objects", put: { id: `${OWN_OBJECT_PREFIX}${key}`, event } as Keyed })))
}

// Where to find each in ownEvents().
export const OWN = {
  metadata: "0:",
  relayList: `${RELAY_LIST_KIND}:`,
  blockedRelays: `${BLOCKED_RELAYS_KIND}:`,
  statsCard: `31180:${STATS_CARD_D}`,
  profileBadges: `${KIND_PROFILE_BADGES}:`,
  legacyProfileBadges: `${KIND_PROFILE_BADGES_LEGACY}:profile_badges`,
} as const

export const ownRelaySettings = (events: Map<string, NostrEvent>): RelaySettings => relaySettings(events.get(OWN.relayList), events.get(OWN.blockedRelays))

export interface FetchResult {
  // Relays that answered completely; none means the result is unknown, not empty.
  answered: string[]
  failed: string[]
}

const ownFilters = (pubkey: string) => [
  { authors: [pubkey], kinds: [0, RELAY_LIST_KIND, BLOCKED_RELAYS_KIND, KIND_PROFILE_BADGES] },
  { authors: [pubkey], kinds: [31180], "#d": [STATS_CARD_D] },
  { authors: [pubkey], kinds: [30000] },
  { authors: [pubkey], kinds: [KIND_PROFILE_BADGES_LEGACY], "#d": ["profile_badges"] },
]

// Looks for the profile's events on every relay they may be on, and keeps what is newer here.
// A relay list found on the way (a new device) names more relays to look at.
export async function fetchOwnEvents(pubkey: string): Promise<FetchResult> {
  const answered: string[] = []
  const failed: string[] = []
  const asked = new Set<string>()
  for (let round = 0; round < 2; round++) {
    const relays = ownReadRelays(ownRelaySettings(await ownEvents(pubkey))).filter((url) => !asked.has(url))
    if (relays.length === 0) break
    for (const url of relays) asked.add(url)
    const result = await query(ownFilters(pubkey), relays)
    answered.push(...result.answered)
    failed.push(...result.failed.map((f) => f.url))
    await rememberOwn(
      pubkey,
      result.events.filter((event) => event.kind !== 30000 || coordinate(event).startsWith(`30000:${ROUND_D_PREFIX}`)),
    )
  }
  return { answered, failed }
}

// ---- Looking the profile up ------------------------------------------------------------------

// Whether relays were asked for the profile's events in this page load, and whether any
// answered. A change of the profile builds on what that found (PLAN.md "Profilbearbeitung": the
// current version is loaded before a change), so an edit never writes a profile made elsewhere
// out of existence just because this device hasn't seen it yet.
export interface OwnLookup {
  // null while relays are being asked.
  answered: boolean | null
}

interface Lookup {
  running: Promise<FetchResult> | null
  // The last finished lookup.
  result: FetchResult | null
  // What the UI sees; one object per state, so useSyncExternalStore sees no change without one.
  state: OwnLookup
}

const lookups = new Map<string, Lookup>()
const lookupListeners = new Set<() => void>()

// The lookup's state; null before the first one.
export const ownLookup = (pubkey: string): OwnLookup | null => lookups.get(pubkey)?.state ?? null

export function subscribeOwnLookups(listener: () => void) {
  lookupListeners.add(listener)
  return () => {
    lookupListeners.delete(listener)
  }
}

function setLookup(pubkey: string, lookup: Omit<Lookup, "state">) {
  lookups.set(pubkey, { ...lookup, state: { answered: lookup.running ? null : (lookup.result?.answered.length ?? 0) > 0 } })
  for (const listener of lookupListeners) listener()
}

// A profile that signs out may sign in again on this page: its lookup starts over.
onSessionEnd(() => lookups.clear())

// Asks relays for the profile's events once per page load, and again when nothing answered the
// last time; `again` asks once more even after an answer (before a change). A lookup already
// running is shared. A lookup that fails on this device counts as nothing answered.
export function lookupOwnEvents(pubkey: string, { again = false } = {}): Promise<FetchResult> {
  const current = lookups.get(pubkey)
  if (current?.running) return current.running
  if (current?.result && current.result.answered.length > 0 && !again) return Promise.resolve(current.result)
  const running = fetchOwnEvents(pubkey)
    .catch((): FetchResult => ({ answered: [], failed: [] }))
    .then((result) => {
      setLookup(pubkey, { running: null, result })
      return result
    })
  setLookup(pubkey, { running, result: null })
  return running
}

export class OwnEventsError extends Error {
  code: "unreachable"
  constructor(message: string) {
    super(message)
    this.name = "OwnEventsError"
    this.code = "unreachable"
  }
}

// The version a change of one of the profile's events (OWN.*) builds on: the newest known once
// relays were asked. Null when relays answered and have none. Throws "unreachable" when nothing
// is known here and no relay answered: then there is nothing to build on, and a profile that may
// well exist elsewhere is not written over.
export async function changeBase(pubkey: string, key: string): Promise<NostrEvent | null> {
  const { answered } = await lookupOwnEvents(pubkey)
  const base = (await ownEvents(pubkey)).get(key) ?? null
  if (!base && answered.length === 0) throw new OwnEventsError("the profile could not be loaded from any relay")
  return base
}
