// Profil › "Profil löschen": deletes the profile as far as a network without a server allows
// (App Review 5.1.1(v); decision 0001, "Was ohne Backend nicht möglich ist"). In order:
//
//   1. look up every event the profile signed, on its own relays and the app's catalog;
//   2. publish an empty profile (kind 0 "{}"), so apps that ignore deletion requests show no name
//      or picture any more;
//   3. publish deletion requests (NIP-09) for every event found: relays and apps that honour
//      them drop the events; nobody can be made to, and the texts say "Löschung erbeten";
//   4. sign out and delete everything on this device (session.ts signOut).
//
// Nothing is deleted on this device unless at least one relay took the deletion request, so a
// person without a connection keeps the profile and can try again. The pure parts take their
// inputs, so the rules run in the Node unit tests.

import { coordinateOf, isAddressableKind, isReplaceableKind } from "../nostr/client.ts"
import type { EventTemplate, NostrEvent } from "../nostr/types.ts"

export const KIND_DELETION = 5

// Tags per deletion request: an "e" tag is about 70 bytes, so a request stays near 25 KB, well
// below what relays accept (MAX_EVENT_BYTES is 32 KB).
const TAGS_PER_REQUEST = 300

// The empty profile that replaces the name, picture and description.
export function blankMetadataTemplate(created_at: number): EventTemplate {
  return { kind: 0, tags: [], content: "{}", created_at }
}

// Deletion requests for the profile's events: each event by id ("e"), replaceable and addressable
// ones also by coordinate ("a"), which covers versions this device never saw, and the kinds
// ("k"). Other people's events and earlier deletion requests are left out. Split so no request
// grows too large; empty when there is nothing to delete.
export function deletionTemplates(pubkey: string, events: readonly NostrEvent[], created_at: number, reason = ""): EventTemplate[] {
  const own = events.filter((event) => event.pubkey === pubkey && event.kind !== KIND_DELETION)
  const tags: string[][] = []
  const seen = new Set<string>()
  const add = (tag: string[]) => {
    const key = tag.join("\u0000")
    if (seen.has(key)) return
    seen.add(key)
    tags.push(tag)
  }
  for (const event of own) {
    add(["e", event.id])
    if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
      const coordinate = coordinateOf(event)
      if (coordinate) add(["a", coordinate])
    }
  }
  const kinds = [...new Set(own.map((event) => String(event.kind)))].map((kind) => ["k", kind])
  const templates: EventTemplate[] = []
  for (let i = 0; i < tags.length; i += TAGS_PER_REQUEST) {
    templates.push({ kind: KIND_DELETION, created_at, tags: [...tags.slice(i, i + TAGS_PER_REQUEST), ...kinds], content: reason })
  }
  return templates
}

// "deleted": a relay took the deletion request and this device is empty. "partly": the requests
// went out, but not everything on this device could be deleted (Daten › Löschen's message).
// "offline": no relay took the request; nothing changed, the profile is still here.
// "signer": the signer refused or couldn't be reached; nothing changed either.
export type DeleteOutcome = "deleted" | "partly" | "offline" | "signer"

export async function deleteProfile(): Promise<DeleteOutcome> {
  const [{ getSession, getSigner, signOut }, { ownEvents, ownRelaySettings }, { query, publish }, relays, { createdAt }] = await Promise.all([
    import("./session.ts"),
    import("./own-events.ts"),
    import("../nostr/client.ts"),
    import("../nostr/relays.ts"),
    import("../nostr/time.ts"),
  ])
  const session = getSession()
  if (!session) return "deleted"
  const pubkey = session.pubkey

  let signer
  try {
    signer = await getSigner()
  } catch {
    return "signer"
  }

  const known = await ownEvents(pubkey)
  const settings = ownRelaySettings(known)
  const targets = relays.mergeRelays(settings.read, settings.write, relays.generalRelays(), relays.profileRelays())

  const found = await query([{ authors: [pubkey] }], targets, { timeoutMs: 10_000 })
  const events = [...found.events, ...known.values()]

  let signed: NostrEvent[]
  try {
    const now = createdAt(known.get("0:")?.created_at)
    signed = []
    // The empty profile first, then the requests: an app that reads the profile meanwhile finds
    // no name, whatever it makes of the requests.
    signed.push(await signer.signEvent(blankMetadataTemplate(now)))
    for (const template of deletionTemplates(pubkey, events, now)) signed.push(await signer.signEvent(template))
  } catch {
    return "signer"
  }

  const results = await Promise.all(signed.map((event) => publish(event, targets)))
  const requests = results.slice(1)
  // With nothing published there is nothing to ask for; the empty profile is the request then.
  const reached = (requests.length ? requests : results).every((perRelay) => perRelay.some((r) => r.ok))
  if (!reached) return "offline"

  return (await signOut({ keepLocalData: false })) ? "deleted" : "partly"
}
