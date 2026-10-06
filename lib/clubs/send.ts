import { bytesToHex } from "@noble/hashes/utils"
import type { EventTemplate, NostrEvent, Signer } from "../nostr/types.ts"
import type { ClubState } from "../protocol/club-state.ts"
import { nowSeconds } from "../nostr/time.ts"
import { encryptForLinkKey, sealRecord } from "../protocol/records.ts"
import { contentKeyText, newContentKey, newSealNonce } from "../protocol/seal.ts"
import type { InvitePreview } from "../protocol/invite.ts"
import { createdAtAfter } from "../protocol/tags.ts"
import { publish } from "../sync/publish.ts"
import { updateClub } from "./store.ts"

// The one way a club's events leave this device: encrypted as the club requires, signed by the
// profile's signer (one after another: a signer app asks for each), kept in the club's local
// copy first, then handed to lib/sync/publish.ts. A change counts as made once it is signed and
// kept; relays that can't be reached don't undo it, the club shows it as not sent yet.

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

// `club` null: the first event founds the club, and its id is the club's.
export async function send(club: string | null, outgoing: readonly Outgoing[], { signer }: Author): Promise<Sent> {
  const events: NostrEvent[] = []
  const keys: Record<string, string> = {}
  for (const item of outgoing) {
    const { template, key } = await prepare(item, signer)
    const event = await signer.signEvent(template)
    events.push(event)
    if (key) keys[event.id] = key
  }
  const id = club ?? events[0].id
  await updateClub(id, { events, keys })
  return { events, published: await resend(id, events) }
}

// Hands signed events to relays: right after signing, and again from "Erneut senden".
export async function resend(club: string, events: readonly NostrEvent[]): Promise<boolean> {
  const reports = await publish(events).catch(() => [])
  const confirmed = new Set(reports.filter((r) => r.published).map((r) => r.event.id))
  await updateClub(club, { sent: { confirmed: [...confirmed], missing: events.map((e) => e.id).filter((id) => !confirmed.has(id)) } })
  return events.every((e) => confirmed.has(e.id))
}
