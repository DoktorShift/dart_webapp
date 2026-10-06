import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import { fetchOwnEvents, ownEvents } from "../profile/own-events.ts"
import { getSession } from "../profile/session.ts"
import { publishOwn, type PublishReport } from "./publish.ts"

// Changes to the profile's small replaceable lists, such as its relay list (NIP-65), go read,
// merge, write (P3b.02): the newest version on the relays is read first, the change is applied to
// that one, and only then signed. What another device or app changed meanwhile stays, instead of
// being replaced by an older copy from this device. When no relay answers, this device's version
// is the base: a change must stay possible offline, e.g. replacing a relay that is gone.
//
// `key` is the list's place in ownEvents() (OWN in lib/profile/own-events.ts); `change` gets the
// base and returns the new version, or null when there is nothing to change.
export async function changeOwnList(key: string, change: (base: NostrEvent | null) => EventTemplate | null): Promise<PublishReport[]> {
  const session = getSession()
  if (!session) throw new Error("nothing is published without a profile")
  await fetchOwnEvents(session.pubkey)
  const template = change((await ownEvents(session.pubkey)).get(key) ?? null)
  return template ? publishOwn([template]) : []
}
