import { publish as publishDirect, type PublishResult } from "../nostr/client.ts"
import { generalRelays, isPublished, mergeRelays } from "../nostr/relays.ts"
import type { EventTemplate, NostrEvent, Signer } from "../nostr/types.ts"
import { getSession } from "../profile/session.ts"
import { publish } from "../sync/publish.ts"
import { loadStoredTournament, updateTournament } from "./store.ts"

// The one way a tournament's events leave this device: signed (one after another: a signer app
// asks for each), kept in the tournament's local copy first, then handed to relays. A change
// counts as made once it is signed and kept (decision 0002 §1); relays that can't be reached
// don't undo it, the tournament shows it as not sent yet and sends it again (resendUnsent).
//
// The profile's own events go through lib/sync/publish.ts, as every profile event does. A
// board's events are signed by the board key the organizer authorized, which that module
// refuses (it publishes only the signed-in profile's events), so they go straight to the
// relays. The persistent outbox replaces both paths at integration (store.ts `unsent`).

export interface Author {
  pubkey: string
  signer: Signer
}

export interface Sent {
  events: NostrEvent[]
  // Every event reached relays of two operators, or every relay gave a final answer.
  published: boolean
}

// Where a tournament travels: the general relays (decision 0002 §5) and the relays its link named.
export const tournamentRelays = (hints: readonly string[] = []) => mergeRelays(generalRelays(), hints)

// An answer that will not change by trying again later.
const TRANSIENT = new Set(["timeout", "unreachable", "rate-limited", "auth-required", "error", ""])
const delivered = (results: readonly PublishResult[]) =>
  results.length > 0 && (isPublished(results.filter((r) => r.ok).map((r) => r.url)) || results.every((r) => r.ok || !TRANSIENT.has(r.code)))

// `tournament` null: the first event founds the tournament, and its id is the tournament's.
export async function send(tournament: string | null, templates: readonly EventTemplate[], author: Author, hints: readonly string[] = []): Promise<Sent> {
  const events: NostrEvent[] = []
  for (const template of templates) events.push(await author.signer.signEvent(template))
  const id = tournament ?? events[0].id
  await updateTournament(id, { events, relays: hints, sent: { confirmed: [], missing: events.map((e) => e.id) } })
  return { events, published: await resend(id, events) }
}

// Hands signed events to relays, in order: right after signing, and again from "Erneut senden".
export async function resend(tournament: string, events: readonly NostrEvent[]): Promise<boolean> {
  const stored = await loadStoredTournament(tournament)
  const relays = tournamentRelays(stored?.relays)
  const session = getSession()
  const confirmed = new Set<string>()
  const own = events.filter((e) => e.pubkey === session?.pubkey)
  if (own.length > 0) {
    const reports = await publish(own).catch(() => [])
    for (const report of reports) if (delivered(report.results)) confirmed.add(report.event.id)
  }
  for (const event of events) {
    if (own.includes(event)) continue
    const results = await publishDirect(event, relays).catch((): PublishResult[] => [])
    if (delivered(results)) confirmed.add(event.id)
  }
  await updateTournament(tournament, { sent: { confirmed: [...confirmed], missing: events.map((e) => e.id).filter((id) => !confirmed.has(id)) } })
  return events.every((e) => confirmed.has(e.id))
}

// Everything of the tournament no relay confirmed yet, oldest first.
export async function resendUnsent(tournament: string): Promise<boolean> {
  const stored = await loadStoredTournament(tournament)
  if (!stored || stored.unsent.length === 0) return true
  const byId = new Map(stored.events.map((e) => [e.id, e]))
  return resend(tournament, stored.unsent.map((id) => byId.get(id)).filter((e): e is NostrEvent => e !== undefined))
}
