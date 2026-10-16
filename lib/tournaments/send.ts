import { generalRelays, mergeRelays } from "../nostr/relays.ts"
import type { EventTemplate, NostrEvent, Signer } from "../nostr/types.ts"
import { KIND_RECORD } from "../protocol/kinds.ts"
import { tagValue } from "../protocol/tags.ts"
import { enqueue, pendingEvents } from "../sync/outbox.ts"
import { updateTournament, type TournamentChange } from "./store.ts"

// The one way a tournament's records leave this device, the organizer's, a player's and a
// board's alike: signed one after another (a signer app asks for each), kept in the tournament's
// local copy, then handed to the persistent outbox of lib/sync (decision 0002 §2) for the
// tournament's relays, as the clubs do (lib/clubs/send.ts). A change counts as made once it is
// signed and kept; the outbox sends it until relays of two operators have it (rule
// "published"), across reloads and without anyone waiting.
//
// Order: a change's records go out one after another, the first after the tournament's newest
// record still waiting here. Every record is written on top of the tournament as this device
// saw it, so no relay gets a decision before the records it builds on.

export interface Author {
  pubkey: string
  signer: Signer
}

// Where a tournament travels: the general relays (decision 0002 §5) and the relays its link named.
export const tournamentRelays = (hints: readonly string[] = []) => mergeRelays(generalRelays(), hints)

const ofTournament = (tournament: string) => (event: NostrEvent) => event.kind === KIND_RECORD && (event.id === tournament || tagValue(event.tags, "e") === tournament)

// `tournament` null: the first record founds the tournament, and its id is the tournament's.
// `keep` is stored together with the records, before anything goes out (the seed behind the
// founding's commitment, say), so a record never reaches a relay without it.
export async function send(tournament: string | null, templates: readonly EventTemplate[], author: Author, keep: Omit<TournamentChange, "events"> = {}): Promise<NostrEvent[]> {
  const events: NostrEvent[] = []
  for (const template of templates) events.push(await author.signer.signEvent(template))
  const id = tournament ?? events[0].id
  const stored = await updateTournament(id, { ...keep, events })
  const last = (await pendingEvents(ofTournament(id))).at(-1)
  const relays = tournamentRelays(stored.relays)
  await enqueue(events.map((event, i) => ({ event, relays, after: i > 0 ? [events[i - 1].id] : last ? [last.id] : [] })), { rule: "published" })
  return events
}

// How many records this device signed that relays don't have safely yet, by the tournament
// (or other object) they belong to: what the screens say still waits.
export async function waitingRecords(): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const event of await pendingEvents((e) => e.kind === KIND_RECORD)) {
    const root = tagValue(event.tags, "e") ?? event.id
    counts.set(root, (counts.get(root) ?? 0) + 1)
  }
  return counts
}
