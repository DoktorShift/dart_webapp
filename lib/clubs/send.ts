import { bytesToHex } from "@noble/hashes/utils"
import type { EventTemplate, NostrEvent, Signer } from "../nostr/types.ts"
import type { ClubState } from "../protocol/club-state.ts"
import { nowSeconds } from "../nostr/time.ts"
import { encryptForLinkKey, sealRecord } from "../protocol/records.ts"
import { contentKeyText, newContentKey, newSealNonce } from "../protocol/seal.ts"
import type { InvitePreview } from "../protocol/invite.ts"
import { createdAtAfter } from "../protocol/tags.ts"
import { publish } from "../sync/publish.ts"
import { updateClub, type ClubChange } from "./store.ts"

// The one way a club's events leave this device: encrypted as the club requires, signed by the
// profile's signer (one after another: a signer app asks for each), kept in the club's local
// copy first, then handed to lib/sync/publish.ts. A change counts as made once it is signed and
// kept; relays that can't be reached don't undo it, the club shows it as not sent yet.
//
// Not sent yet (StoredClub.unsent) is bookkeeping for the time being: events are marked when
// they are kept, before any relay is asked, and cleared only once relays of two operators
// confirmed them; "Erneut senden" (resend) is the one way to send them again. At integration the
// coordinator moves club publishing onto lib/sync's persistent outbox: one list of what has to
// go out, no second mechanism here.

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
  // Relays of at least two operators confirmed every event (decision 0002 §5).
  published: boolean
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

// Keeps signed events in the club's copy, marked as not sent, together with whatever else
// belongs to the same change.
export const keep = (club: string, signed: Signed, change: Omit<ClubChange, "events" | "keys" | "unsent" | "sent"> = {}) =>
  updateClub(club, { ...change, events: signed.events, keys: signed.keys, unsent: signed.events.map((e) => e.id) })

// `club` null: the first event founds the club, and its id is the club's.
export async function send(club: string | null, outgoing: readonly Outgoing[], { signer }: Author): Promise<Sent> {
  const signed = await sign(outgoing, signer)
  const id = club ?? signed.events[0].id
  await keep(id, signed)
  return { events: signed.events, published: await resend(id, signed.events) }
}

// Hands signed events to relays: right after signing, and again from "Erneut senden". What two
// operators confirmed is no longer unsent; a relay answering at all counts as loaded.
export async function resend(club: string, events: readonly NostrEvent[]): Promise<boolean> {
  const reports = await publish(events).catch(() => [])
  const confirmed = reports.filter((r) => r.published).map((r) => r.event.id)
  const answered = reports.some((r) => r.results.some((x) => x.ok))
  await updateClub(club, { sent: confirmed, ...(answered ? { loadedAt: Date.now() } : {}) })
  return events.every((e) => confirmed.includes(e.id))
}
