import { loadCore } from "../nostr/core.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { isAddressableKind, isReplaceableKind } from "../nostr/client.ts"
import { rememberOwn } from "../profile/own-events.ts"
import { OWN_OBJECT_PREFIX } from "../profile/session.ts"
import { KIND_PROFILE_BADGES_LEGACY } from "../protocol/badges.ts"
import { KIND_BADGE_DEFINITION, KIND_PROFILE_BADGES } from "../protocol/kinds.ts"
import { isSignedEventShape } from "../protocol/tags.ts"
import { dbGetAll, dbWrite, type Keyed } from "../storage/db.ts"

// The badges in the device's data file (lib/storage/export-sections.ts, section "badges"): every
// signed event this device keeps about them, awards given and received, definitions, evidence,
// deletion requests and the profile's list, so a lost relay copy is not a lost badge
// (decision 0001: "Lokale Kopie und Export bleiben das Sicherheitsnetz"). Taking them back in,
// each event's signature is checked first; the rest is kept exactly as ./store.ts keeps it.

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
  const core = await loadCore()
  const events = value.filter((e): e is NostrEvent => isSignedEventShape(e) && core.verifyEventSignature(e))
  const replaceable = events.filter((e) => isReplaceableKind(e.kind) || isAddressableKind(e.kind))
  for (const pubkey of new Set(replaceable.map((e) => e.pubkey))) await rememberOwn(pubkey, replaceable.filter((e) => e.pubkey === pubkey))
  await dbWrite(events.filter((e) => !replaceable.includes(e)).map((event) => ({ store: "objects", put: { id: `${PREFIX}${event.id}`, event } as Keyed })))
}
