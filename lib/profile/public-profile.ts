import { latestEvents, query } from "../nostr/client.ts"
import { generalRelays, mergeRelays, profileRelays } from "../nostr/relays.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { STATS_CARD_D } from "../protocol/profile.ts"
import { dbGet, dbWrite, type Keyed } from "../storage/db.ts"
import { MAX_OWN_RELAYS, RELAY_LIST_KIND, relaySettings } from "./relay-list.ts"

// Someone's public profile as other people see it: metadata (kind 0), relay list (10002) and
// stats card (31180 "stats"), nothing else. Read at the profile and general relays and the hints
// of the link that opened it, then at the first few of the person's own write relays. The last loaded version is
// kept on the device ("objects", profile:<pubkey>), so the view stays readable without relays,
// with the time it was loaded (PLAN.md "Profilansicht": fehlende Relays).

export interface PublicProfile {
  pubkey: string
  metadata: NostrEvent | null
  relayList: NostrEvent | null
  card: NostrEvent | null
  // When relays last answered for it (ms); null if they never did.
  loadedAt: number | null
}

// "complete": every relay answered. "partial": some didn't. "offline": none did, so what shows
// is the last loaded version, or nothing known.
export type LoadStatus = "complete" | "partial" | "offline"

const cacheId = (pubkey: string) => `profile:${pubkey}`

export async function cachedProfile(pubkey: string): Promise<PublicProfile | null> {
  return (await dbGet<PublicProfile & Keyed>("objects", cacheId(pubkey))) ?? null
}

const filters = (pubkey: string) => [
  { authors: [pubkey], kinds: [0, RELAY_LIST_KIND] },
  { authors: [pubkey], kinds: [31180], "#d": [STATS_CARD_D] },
]

function merge(profile: PublicProfile, events: readonly NostrEvent[]): PublicProfile {
  const pick = (kind: number, current: NostrEvent | null) => latestEvents([...(current ? [current] : []), ...events.filter((e) => e.kind === kind && e.pubkey === profile.pubkey)])[0] ?? null
  return { ...profile, metadata: pick(0, profile.metadata), relayList: pick(RELAY_LIST_KIND, profile.relayList), card: pick(31180, profile.card) }
}

export async function loadPublicProfile(pubkey: string, hints: readonly string[] = []): Promise<{ profile: PublicProfile; status: LoadStatus }> {
  let profile: PublicProfile = (await cachedProfile(pubkey).catch(() => null)) ?? { pubkey, metadata: null, relayList: null, card: null, loadedAt: null }
  const asked = mergeRelays(profileRelays(), generalRelays(), hints)
  const first = await query(filters(pubkey), asked)
  profile = merge(profile, first.events)
  const more = relaySettings(profile.relayList).write.filter((url) => !asked.includes(url)).slice(0, MAX_OWN_RELAYS)
  const second = more.length > 0 ? await query(filters(pubkey), more) : null
  if (second) profile = merge(profile, second.events)
  const answered = first.answered.length + (second?.answered.length ?? 0)
  const failed = first.failed.length + (second?.failed.length ?? 0)
  if (answered === 0) return { profile, status: "offline" }
  profile = { ...profile, loadedAt: Date.now() }
  await dbWrite([{ store: "objects", put: { id: cacheId(pubkey), ...profile } as Keyed }]).catch(() => {})
  return { profile, status: failed > 0 ? "partial" : "complete" }
}
