import { buildRelayListTemplate, parseRelayListSafe, type RelayEntry } from "../nostr/ext/lists.ts"
import { defaultRelays, generalRelays, mergeRelays, normalizeRelayUrl, profileRelays } from "../nostr/relays.ts"
import type { EventTemplate, NostrEvent } from "../nostr/types.ts"

// Where a profile's events go and where they are read (docs/decisions/0002 §5, NIP-65):
// - Its relay list (kind 10002), as the person or another app wrote it. A profile made here
//   lists the four general relays; purplepag.es stays an extra target for profiles and lists
//   only, never claimed as a general relay (PLAN.md "Start Relays und NIP 65").
// - Relays the person blocked (kind 10006, public "relay" tags) are never written to.
// - Profile kinds (0, 10002, 10006, 10008) go to the five profile relays, everything else to the
//   general ones; both plus the person's own write relays.

export const RELAY_LIST_KIND = 10002
export const BLOCKED_RELAYS_KIND = 10006
const PROFILE_KINDS = new Set([0, 3, RELAY_LIST_KIND, BLOCKED_RELAYS_KIND, 10008])

export interface RelaySettings {
  // From the relay list; empty without one.
  write: string[]
  read: string[]
  blocked: string[]
  // The person has a relay list of their own.
  listed: boolean
}

export function relaySettings(relayList?: NostrEvent | null, blockedList?: NostrEvent | null): RelaySettings {
  const entries = relayList ? parseRelayListSafe(relayList).relays : []
  const blocked = blockedList ? mergeRelays(blockedList.tags.filter((tag) => tag[0] === "relay").map((tag) => tag[1] ?? "")) : []
  return {
    write: entries.filter((entry) => entry.write).map((entry) => entry.url),
    read: entries.filter((entry) => entry.read).map((entry) => entry.url),
    blocked,
    listed: entries.length > 0,
  }
}

const without = (urls: string[], blocked: readonly string[]) => urls.filter((url) => !blocked.includes(url))

// The relays an event of this kind is published to.
export function publishTargets(kind: number, settings: RelaySettings): string[] {
  return without(mergeRelays(defaultRelays(PROFILE_KINDS.has(kind) ? "profile" : "general"), settings.write), settings.blocked)
}

// Where the profile's own events are looked for: everywhere they may have gone.
export function ownReadRelays(settings: RelaySettings): string[] {
  return without(mergeRelays(profileRelays(), generalRelays(), settings.write), settings.blocked)
}

// The relay list of a new profile: the general relays, for reading and writing.
export const newRelayList = (): RelayEntry[] => generalRelays().map((url) => ({ url, read: true, write: true }))

// The relays a profile's list shows for editing: its own, or (without one) what the app uses.
export function editableRelays(relayList?: NostrEvent | null): RelayEntry[] {
  const entries = relayList ? parseRelayListSafe(relayList).relays : []
  return entries.length > 0 ? entries : newRelayList()
}

// The kind 10002 template for edited entries. Everything else of the previous version stays
// (lib/nostr/ext/lists.ts): unknown tags and entries this app can't use.
export function relayListTemplate(entries: readonly RelayEntry[], base?: NostrEvent | null): EventTemplate {
  return buildRelayListTemplate(entries, base ? { list: parseRelayListSafe(base), event: base } : undefined)
}

// The entries with one relay more (read and write); null when the input is no relay address.
export function addRelay(entries: readonly RelayEntry[], input: string): RelayEntry[] | null {
  const url = normalizeRelayUrl(input)
  if (!url) return null
  return entries.some((entry) => entry.url === url) ? [...entries] : [...entries, { url, read: true, write: true }]
}

export const removeRelay = (entries: readonly RelayEntry[], url: string): RelayEntry[] => entries.filter((entry) => entry.url !== url)
