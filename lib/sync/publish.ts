import { publish as send, type PublishResult } from "../nostr/client.ts"
import { isPublished } from "../nostr/relays.ts"
import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import { ownEvents, ownRelaySettings, rememberOwn } from "../profile/own-events.ts"
import { publishTargets } from "../profile/relay-list.ts"
import { getSession, getSigner } from "../profile/session.ts"

// The one way the signed-in profile's events go out. Callers hand over signed events; where
// each goes follows from its kind and the profile's relays (lib/profile/relay-list.ts).
//
// Today this sends once, straight through lib/nostr's client, and reports every relay's answer.
// The persistent outbox (retries, self-healing on start, confirmed copies) takes this place
// later without changing callers: whatever was handed over here is then queued instead.
//
// Only the signed-in profile's own events are accepted. Nothing is published without a
// session: a guest's games, names and results never leave the device.

export interface PublishReport {
  event: NostrEvent
  relays: string[]
  results: PublishResult[]
  // Confirmed by relays of at least two operators (decision 0002 §5).
  published: boolean
}

export async function publish(events: readonly NostrEvent[]): Promise<PublishReport[]> {
  const session = getSession()
  if (!session) throw new Error("nothing is published without a profile")
  if (events.some((event) => event.pubkey !== session.pubkey)) throw new Error("only the signed-in profile's events are published")
  const settings = ownRelaySettings(await ownEvents(session.pubkey))
  return Promise.all(
    events.map(async (event) => {
      const relays = publishTargets(event.kind, settings)
      const results = await send(event, relays)
      return { event, relays, results, published: isPublished(results.filter((r) => r.ok).map((r) => r.url)) }
    }),
  )
}

// Signs changes of the profile (one after another: a signer app asks for each), keeps them as
// the profile's current version on this device, then publishes them. A change counts as made
// once it is signed and kept; relays that can't be reached don't undo it.
export async function publishOwn(templates: readonly EventTemplate[]): Promise<PublishReport[]> {
  const session = getSession()
  if (!session) throw new Error("nothing is published without a profile")
  const signer = await getSigner()
  const events: NostrEvent[] = []
  for (const template of templates) events.push(await signer.signEvent(template))
  await rememberOwn(session.pubkey, events)
  return publish(events)
}
