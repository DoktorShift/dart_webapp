import { bytesToHex } from "@noble/hashes/utils"
import type { EventTemplate, NostrEvent, Signer } from "../nostr/types.ts"
import type { ClubState } from "../protocol/club-state.ts"
import { nowSeconds } from "../nostr/time.ts"
import { encryptForLinkKey, sealRecord } from "../protocol/records.ts"
import { contentKeyText, newContentKey, newSealNonce } from "../protocol/seal.ts"
import type { InvitePreview } from "../protocol/invite.ts"
import { createdAtAfter } from "../protocol/tags.ts"
import { enqueue, pendingEvents, refusedEvents } from "../sync/outbox.ts"
import { clubRelays } from "./relays.ts"
import { loadStoredClub, updateClub, type ClubChange, type StoredClub } from "./store.ts"

// The one way a club's events leave this device: encrypted as the club requires, signed by the
// profile's signer (one after another: a signer app asks for each), kept in the club's local
// copy first, then handed to the persistent outbox of lib/sync (decision 0002 §2) for the club's
// relays. A change counts as made once it is signed and kept; the outbox sends it until relays
// of two operators have it (rule "published"), across reloads and without anyone waiting, and
// the club says how many of its events still wait or were refused (unsentEvents).
//
// Order: every record is written on top of the club as this device saw it (afterState), so a
// change's events go out one after another, the first after the club's newest event still
// waiting. A reader never finds a record on a relay before the ones it builds on.

export interface Author {
  pubkey: string
  signer: Signer
}

// How one event travels:
// - seal: a closed club's record, sealed for these readers (each wrap is one NIP-44 encryption
//   by the signer); `preview` only for an invite.
// - link: a private game's record, NIP-44 to the game's match key.
// - neither: in the clear.
export interface Outgoing {
  template: EventTemplate
  seal?: { readers: readonly string[]; preview?: { key: Uint8Array; content: InvitePreview } }
  link?: string
}

export interface Signed {
  events: NostrEvent[]
  // Content keys of the sealed ones, by event id.
  keys: Record<string, string>
}

export interface Sent {
  events: NostrEvent[]
}

export class ClubSignerError extends Error {
  constructor() {
    super("the signer can't encrypt (NIP-44), which a closed club needs")
    this.name = "ClubSignerError"
  }
}

const nip44Of = (signer: Signer) => {
  if (!signer.nip44) throw new ClubSignerError()
  return signer.nip44
}

// created_at for a record that builds on others: never before them (lib/protocol/tags.ts).
export const recordTime = (...basedOn: number[]) => createdAtAfter(nowSeconds(), ...basedOn)

// created_at for a record written on top of a club's state: after everything in it, so that
// replaying sorts it after what its author saw, even within the same second.
export const afterState = (state: ClubState, ...basedOn: number[]) => recordTime(state.log.applied.at(-1)?.at ?? 0, ...basedOn)

async function prepare({ template, seal, link }: Outgoing, signer: Signer): Promise<{ template: EventTemplate; key?: string }> {
  if (link) return { template: encryptForLinkKey(template, link, await nip44Of(signer).encrypt(link, template.content)) }
  if (!seal) return { template }
  const nip44 = nip44Of(signer)
  const key = newContentKey()
  const wraps = await Promise.all([...new Set(seal.readers)].map(async (reader) => ({ reader, payload: await nip44.encrypt(reader, contentKeyText(key)) })))
  const preview = seal.preview ? { key: seal.preview.key, nonce: newSealNonce(), content: seal.preview.content } : undefined
  return { template: sealRecord(template, { key, nonce: newSealNonce(), wraps, ...(preview ? { preview } : {}) }), key: bytesToHex(key) }
}

// Encrypts and signs, in order.
export async function sign(outgoing: readonly Outgoing[], signer: Signer): Promise<Signed> {
  const events: NostrEvent[] = []
  const keys: Record<string, string> = {}
  for (const item of outgoing) {
    const { template, key } = await prepare(item, signer)
    const event = await signer.signEvent(template)
    events.push(event)
    if (key) keys[event.id] = key
  }
  return { events, keys }
}

const ofClub = (stored: StoredClub) => {
  const ids = new Set(stored.events.map((e) => e.id))
  return (event: NostrEvent) => ids.has(event.id)
}

// Keeps the events `author` signed in the club's copy, together with whatever else belongs to the
// same change, and queues them for the club's relays in their order. A newer version of a date or
// an answer replaces one still waiting (coalesce). Nothing is kept or sent once another profile
// signed in while the signer was asked (ClubReaderError, lib/clubs/store.ts).
export async function keep(club: string, author: string, signed: Signed, change: Omit<ClubChange, "events" | "keys"> = {}): Promise<Sent> {
  const stored = await updateClub(club, { ...change, events: signed.events, keys: signed.keys }, author)
  const last = (await pendingEvents(ofClub(stored))).at(-1)
  const relays = clubRelays(stored.relays)
  const deliveries = signed.events.map((event, i) => ({ event, relays, after: i > 0 ? [signed.events[i - 1].id] : last ? [last.id] : [] }))
  await enqueue(deliveries, { rule: "published", coalesce: true })
  return { events: signed.events }
}

// `club` null: the first event founds the club, and its id is the club's.
export async function send(club: string | null, outgoing: readonly Outgoing[], { pubkey, signer }: Author): Promise<Sent> {
  const signed = await sign(outgoing, signer)
  return keep(club ?? signed.events[0].id, pubkey, signed)
}

export interface Unsent {
  // Events relays of two operators don't have yet, still sent.
  waiting: number
  // Events every relay refused for good, kept in the outbox for their week.
  refused: number
}

export async function unsentEvents(club: string): Promise<Unsent> {
  const stored = await loadStoredClub(club)
  if (!stored) return { waiting: 0, refused: 0 }
  const [waiting, refused] = await Promise.all([pendingEvents(ofClub(stored)), refusedEvents(ofClub(stored))])
  return { waiting: waiting.length, refused: refused.length }
}
