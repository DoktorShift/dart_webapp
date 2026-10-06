import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { randomBytes } from "@noble/hashes/utils.js"
import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import {
  decodeEnvelope,
  encodeEnvelope,
  joinRecord,
  parsePrivateEvent,
  partId,
  privateRecord,
  privateTemplate,
  recordAad,
  recordPart,
  recordSlot,
  splitRecord,
  type PrivateRecord,
  type RecordPart,
} from "../protocol/private.ts"

// The profile's private records on relays (docs/protocol/families/private-records.md): each one
// encrypted with XChaCha20-Poly1305 under the data key, bound to its opaque slot, split into
// chained parts when its data is too large for one event. lib/protocol fixes the format; this is
// the cipher and the bookkeeping around it. No network, no signer: pure functions.

export type RecordHead = Pick<PrivateRecord, "type" | "id" | "rev" | "device" | "at">

// One version of a record as found on relays: its head, the data (null for a deletion), and the
// events it came in (head first).
export interface RecordVersion {
  record: PrivateRecord
  data: Record<string, unknown> | null
  events: NostrEvent[]
}

// Versions in the order the profile's devices agree on: the higher Lamport counter, then the
// higher device id for two devices that wrote the same counter offline.
export const compareVersions = (a: Pick<PrivateRecord, "rev" | "device">, b: Pick<PrivateRecord, "rev" | "device">) =>
  a.rev - b.rev || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0)

function seal(dataKey: Uint8Array, slot: string, plaintext: unknown, created_at: number): EventTemplate {
  const nonce = randomBytes(24)
  const ciphertext = xchacha20poly1305(dataKey, nonce, recordAad(slot)).encrypt(new TextEncoder().encode(JSON.stringify(plaintext)))
  return privateTemplate(slot, encodeEnvelope(nonce, ciphertext), created_at)
}

// The events of one record version, head first: the data, a deletion (data null), or a head and
// its parts when the data needs more than one event.
export function sealRecord(head: RecordHead, data: Record<string, unknown> | null, dataKey: Uint8Array, created_at: number): EventTemplate[] {
  const base = { v: 1 as const, ...head }
  if (data === null) return [seal(dataKey, recordSlot(dataKey, head.id), privateRecord.check({ ...base, deleted: 1 }, ""), created_at)]
  const { head: record, parts } = splitRecord(base, data)
  return [
    seal(dataKey, recordSlot(dataKey, head.id), record, created_at),
    ...parts.map((part) => seal(dataKey, recordSlot(dataKey, partId(part.of, part.seq)), part, created_at)),
  ]
}

// The plaintext, or null when the content doesn't open with this key in this slot.
function open(dataKey: Uint8Array, slot: string, content: string): string | null {
  try {
    const { nonce, ciphertext } = decodeEnvelope(content)
    return new TextDecoder("utf-8", { fatal: true }).decode(xchacha20poly1305(dataKey, nonce, recordAad(slot)).decrypt(ciphertext))
  } catch {
    return null
  }
}

export interface OpenedRecords {
  // The newest version of each record, by record id.
  versions: Map<string, RecordVersion>
  // How many of the profile's records (they open with its key) can't be read: damaged, or parts
  // missing on the relays asked.
  unreadable: number
}

// Reads the profile's private records among any of its kind-30078 events (other apps keep theirs
// there too: whatever doesn't open with the data key isn't BlueLine's and is passed over).
export function openRecords(events: readonly NostrEvent[], dataKey: Uint8Array, pubkey: string): OpenedRecords {
  const heads = new Map<string, { record: PrivateRecord; event: NostrEvent }>()
  const parts = new Map<string, { part: RecordPart; event: NostrEvent }[]>()
  let unreadable = 0
  for (const event of events) {
    const parsed = parsePrivateEvent(event, pubkey)
    if (!parsed.ok) continue
    const plaintext = open(dataKey, parsed.slot, event.content)
    if (plaintext === null) continue
    try {
      const value: unknown = JSON.parse(plaintext)
      if (typeof value === "object" && value !== null && "of" in value) {
        const part = recordPart.check(value, "")
        if (recordSlot(dataKey, partId(part.of, part.seq)) !== parsed.slot) throw new Error("a part in another slot")
        parts.set(part.of, [...(parts.get(part.of) ?? []), { part, event }])
      } else {
        const record = privateRecord.check(value, "")
        if (recordSlot(dataKey, record.id) !== parsed.slot) throw new Error("a record in another slot")
        const known = heads.get(record.id)
        if (!known || compareVersions(record, known.record) > 0) heads.set(record.id, { record, event })
      }
    } catch {
      unreadable++
    }
  }

  const versions = new Map<string, RecordVersion>()
  for (const [id, { record, event }] of heads) {
    if (record.deleted) {
      versions.set(id, { record, data: null, events: [event] })
      continue
    }
    const own = (parts.get(id) ?? []).filter((p) => p.part.set === record.parts?.head)
    try {
      versions.set(id, { record, data: joinRecord(record, own.map((p) => p.part)), events: [event, ...own.sort((a, b) => a.part.seq - b.part.seq).map((p) => p.event)] })
    } catch {
      unreadable++
    }
  }
  return { versions, unreadable }
}
