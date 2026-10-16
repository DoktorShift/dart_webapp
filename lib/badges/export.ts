import { loadCore } from "../nostr/core.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { isAddressableKind, isReplaceableKind } from "../nostr/client.ts"
import { rememberOwn } from "../profile/own-events.ts"
import { getSession } from "../profile/session.ts"
import { OWN_OBJECT_PREFIX } from "../profile/storage-keys.ts"
import { KIND_PROFILE_BADGES_LEGACY } from "../protocol/badges.ts"
import { KIND_BADGE_DEFINITION, KIND_PROFILE_BADGES } from "../protocol/kinds.ts"
import { isSignedEventShape } from "../protocol/tags.ts"
import { dbGetAll, dbWrite, type Keyed } from "../storage/db.ts"

// The badges in the device's data file (lib/storage/export-sections.ts, section "badges"): every
// signed event this device keeps about them, awards given and received, definitions, evidence,
// deletion requests and the profile's list, so a lost relay copy is not a lost badge
// (decision 0001: "Lokale Kopie und Export bleiben das Sicherheitsnetz"). Taking them back in,
// each event's signature is checked first; then they are kept as ./store.ts keeps them: the
// signed-in profile's own replaceable events as its own events, everything else as badge
// records (a guest's import keeps everything as records; they are read as such too).

const PREFIX = `${OWN_OBJECT_PREFIX}badge:`
const OWN_BADGE_KINDS = new Set([KIND_BADGE_DEFINITION, KIND_PROFILE_BADGES, KIND_PROFILE_BADGES_LEGACY])

interface StoredEvent {
  id: string
  event?: NostrEvent
}

export async function buildBadgeSection(): Promise<NostrEvent[]> {
  const stored = await dbGetAll<StoredEvent>("objects")
  return stored.flatMap((s) => {
    const event = s.event
    if (!event || !s.id.startsWith(OWN_OBJECT_PREFIX)) return []
    return s.id.startsWith(PREFIX) || OWN_BADGE_KINDS.has(event.kind) ? [event] : []
  })
}

export async function applyBadgeSection(value: unknown) {
  if (!Array.isArray(value)) return
  // Every data file carries this section, mostly empty: nostr-core is loaded only to check something.
  const shaped = value.filter((e): e is NostrEvent => isSignedEventShape(e))
  if (shaped.length === 0) return
  const core = await loadCore()
  const events = shaped.filter((e) => core.verifyEventSignature(e))
  const own = getSession()?.pubkey
  const isOwn = (e: NostrEvent) => e.pubkey === own && (isReplaceableKind(e.kind) || isAddressableKind(e.kind))
  if (own) await rememberOwn(own, events.filter(isOwn))
  await dbWrite(events.filter((e) => !isOwn(e)).map((event) => ({ store: "objects", put: { id: `${PREFIX}${event.id}`, event } as Keyed })))
}
