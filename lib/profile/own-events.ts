import { isAddressableKind, isReplaceableKind, query, supersedes } from "../nostr/client.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { dbGetAll, dbWrite, type Keyed } from "../storage/db.ts"
import { STATS_CARD_D } from "../protocol/profile.ts"
import { ROUND_D_PREFIX } from "./rounds.ts"
import { BLOCKED_RELAYS_KIND, ownReadRelays, RELAY_LIST_KIND, relaySettings, type RelaySettings } from "./relay-list.ts"
import { getSession, onSessionEnd, OWN_OBJECT_PREFIX } from "./session.ts"

// The signed-in profile's own replaceable events, as last seen: its metadata (0), relay list
// (10002), blocked relays (10006), stats card (31180 "stats") and player rounds (30000). Kept in
// the "objects" store, so the profile shows at once and offline; the local copy comes first
// (decision 0002 §1). An event signed here is kept before it is published, so a change is never
// lost to a missing connection; relays only ever replace it with a newer version.
// Everything here goes with the profile when it signs out (session.ts, "own:*").

interface StoredEvent {
  id: string
  event: NostrEvent
}

// One entry per replaceable kind, or per kind and d tag ("0:", "31180:stats").
function coordinate(event: Pick<NostrEvent, "kind" | "tags">): string {
  const d = event.kind >= 30_000 && event.kind < 40_000 ? (event.tags.find((tag) => tag[0] === "d")?.[1] ?? "") : ""
  return `${event.kind}:${d}`
}

export async function ownEvents(pubkey: string): Promise<Map<string, NostrEvent>> {
  const stored = await dbGetAll<StoredEvent>("objects")
  return new Map(stored.filter((s) => s.id.startsWith(OWN_OBJECT_PREFIX) && s.event.pubkey === pubkey).map((s) => [coordinate(s.event), s.event]))
}

// Keeps the newest version of each of the profile's replaceable events; older ones, other
// people's and regular events are ignored.
export async function rememberOwn(pubkey: string, events: readonly NostrEvent[]) {
  const known = await ownEvents(pubkey)
  const fresh = new Map<string, NostrEvent>()
  for (const event of events) {
    if (event.pubkey !== pubkey || !(isReplaceableKind(event.kind) || isAddressableKind(event.kind))) continue
    const key = coordinate(event)
    const current = fresh.get(key) ?? known.get(key)
    if (!current || supersedes(event, current)) fresh.set(key, event)
  }
  await dbWrite([...fresh].map(([key, event]) => ({ store: "objects", put: { id: `${OWN_OBJECT_PREFIX}${key}`, event } as Keyed })))
}

// Where to find each in ownEvents().
export const OWN = {
  metadata: "0:",
  relayList: `${RELAY_LIST_KIND}:`,
  blockedRelays: `${BLOCKED_RELAYS_KIND}:`,
  statsCard: `31180:${STATS_CARD_D}`,
} as const

export const ownRelaySettings = (events: Map<string, NostrEvent>): RelaySettings => relaySettings(events.get(OWN.relayList), events.get(OWN.blockedRelays))

export interface FetchResult {
  // Relays that answered completely; none means the result is unknown, not empty.
  answered: string[]
  failed: string[]
}

const ownFilters = (pubkey: string) => [
  { authors: [pubkey], kinds: [0, RELAY_LIST_KIND, BLOCKED_RELAYS_KIND] },
  { authors: [pubkey], kinds: [31180], "#d": [STATS_CARD_D] },
  { authors: [pubkey], kinds: [30000] },
]

// Looks for the profile's events on every relay they may be on, and keeps what is newer here.
// A relay list found on the way (a new device) names more relays to look at. What arrives after
// the profile signed out meanwhile is dropped: "Abmelden und alles löschen" leaves nothing behind.
export async function fetchOwnEvents(pubkey: string): Promise<FetchResult> {
  const answered: string[] = []
  const failed: string[] = []
  const asked = new Set<string>()
  for (let round = 0; round < 2; round++) {
    const relays = ownReadRelays(ownRelaySettings(await ownEvents(pubkey))).filter((url) => !asked.has(url))
    if (relays.length === 0) break
    for (const url of relays) asked.add(url)
    const result = await query(ownFilters(pubkey), relays)
    if (getSession()?.pubkey !== pubkey) break
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

// Whether relays were asked for the profile's events in this page load, and what came of it. A
// change of the profile builds on what that found (PLAN.md "Profilbearbeitung": the current
// version is loaded before a change), so an edit never writes a profile made elsewhere out of
// existence just because this device hasn't seen it yet. Only a complete lookup says that what
// isn't known here isn't there (decision 0002 §5: without a relay's answer, unknown, never empty).
export type OwnLookup =
  // Relays are being asked.
  | { state: "asking" }
  // Every relay asked answered.
  | { state: "complete" }
  // Some or all of the relays asked gave no answer; what isn't known here may be there.
  | { state: "incomplete"; unanswered: string[] }

interface Lookup {
  running: Promise<FetchResult> | null
  // The last finished lookup.
  result: FetchResult | null
  // What the UI sees; one object per state, so useSyncExternalStore sees no change without one.
  state: OwnLookup
}

const isComplete = (result: FetchResult) => result.answered.length > 0 && result.failed.length === 0

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

function lookupState({ running, result }: Omit<Lookup, "state">): OwnLookup {
  if (running || !result) return { state: "asking" }
  return isComplete(result) ? { state: "complete" } : { state: "incomplete", unanswered: result.failed }
}

function setLookup(pubkey: string, lookup: Omit<Lookup, "state">) {
  lookups.set(pubkey, { ...lookup, state: lookupState(lookup) })
  for (const listener of lookupListeners) listener()
}

// A profile that signs out may sign in again on this page: its lookup starts over.
onSessionEnd(() => lookups.clear())

// Asks relays for the profile's events once per page load, and again while the last lookup was
// incomplete; `again` asks once more even after a complete one (before a change). A lookup
// already running is shared. A lookup that fails on this device counts as nothing answered.
export function lookupOwnEvents(pubkey: string, { again = false } = {}): Promise<FetchResult> {
  const current = lookups.get(pubkey)
  if (current?.running) return current.running
  if (current?.result && isComplete(current.result) && !again) return Promise.resolve(current.result)
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

// How long a change waits for a running lookup when a version is already known here: long
// enough for a quick relay to bring a newer one, short enough that saving still feels immediate
// (decision 0002 §1: every change takes effect at once).
const KNOWN_BASE_WAIT_MS = 1500

// The version a change of one of the profile's events (OWN.*) builds on: the newest known once
// relays were asked. With a version here, a running lookup gets a moment to bring a newer one
// (none while offline); without one, the lookup is awaited, and null means the relays have none.
// Throws "unreachable" when nothing is known here and the lookup was incomplete: then there is
// nothing to build on, and a profile that may well exist elsewhere is not written over.
export async function changeBase(pubkey: string, key: string): Promise<NostrEvent | null> {
  const lookup = lookupOwnEvents(pubkey)
  const known = (await ownEvents(pubkey)).get(key) ?? null
  if (known) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false
    if (!offline) await Promise.race([lookup, new Promise((done) => setTimeout(done, KNOWN_BASE_WAIT_MS))])
    return (await ownEvents(pubkey)).get(key) ?? known
  }
  const result = await lookup
  const base = (await ownEvents(pubkey)).get(key) ?? null
  if (!base && !isComplete(result)) throw new OwnEventsError("the profile could not be loaded from every relay")
  return base
}
