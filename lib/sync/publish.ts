import type { PublishResult } from "../nostr/client.ts"
import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import { ownEvents, ownRelaySettings, rememberOwn } from "../profile/own-events.ts"
import { publishTargets } from "../profile/relay-list.ts"
import { getSession, getSigner } from "../profile/session.ts"
import { deliverNow, enqueue } from "./outbox.ts"

// The one way the signed-in profile's events go out. Callers hand over signed events; where
// each goes follows from its kind and the profile's relays (lib/profile/relay-list.ts).
//
// Every event goes into the persistent outbox (./outbox.ts) and is sent once right away; the
// report is that first attempt. Relays that didn't take it get it again later, across reloads,
// until relays of two operators have it, and missing copies again on the next starts.
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
  const deliveries = events.map((event) => ({ event, relays: publishTargets(event.kind, settings) }))
  // A newer version of the same list or profile replaces one still waiting.
  await enqueue(deliveries, { coalesce: true })
  const sent = new Map((await deliverNow(events.map((e) => e.id))).map((s) => [s.id, s]))
  return deliveries.map(({ event, relays }) => {
    const status = sent.get(event.id)
    return { event, relays, results: status?.results ?? [], published: status?.state === "delivered" }
  })
}

export interface Submitted {
  events: NostrEvent[]
  // The relays' answers, once they come; never rejects for a relay.
  published: Promise<PublishReport[]>
}

// Signs changes of the profile (one after another: a signer app asks for each), keeps them as
// the profile's current version on this device, and sends them on without waiting: a change
// counts as made once it is signed and kept (decision 0002 §1), and relays that can't be
// reached don't undo or delay it. Erweitert shows how the relays are doing.
export async function submitOwn(templates: readonly EventTemplate[]): Promise<Submitted> {
  const session = getSession()
  if (!session) throw new Error("nothing is published without a profile")
  const signer = await getSigner()
  const events: NostrEvent[] = []
  for (const template of templates) events.push(await signer.signEvent(template))
  await rememberOwn(session.pubkey, events)
  return { events, published: publish(events).catch((): PublishReport[] => []) }
}

// The same, waiting for the relays' answers.
export const publishOwn = async (templates: readonly EventTemplate[]): Promise<PublishReport[]> => (await submitOwn(templates)).published
