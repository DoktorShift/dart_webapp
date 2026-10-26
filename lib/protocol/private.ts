import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import { base64 } from "@scure/base"
import type { EventTemplate } from "../nostr/types.ts"
import type { Chunk } from "./chunks.ts"
import { assembleChunks, chunkData } from "./chunks.ts"
import { KIND_PRIVATE, MAX_EVENT_BYTES } from "./kinds.ts"
import { ProtocolError } from "./reasons.ts"
import type { Infer } from "./schema.ts"
import { anyObject, hex, int, obj, oneOf, opt, refine, SchemaError, str, time } from "./schema.ts"
import type { SignedEvent } from "./tags.ts"
import { HEX64, isSignedEventShape, signedEventBytes } from "./tags.ts"

// Private records of a profile (docs/protocol/families/private-records.md): NIP-78 kind 30078,
// signed by the profile, one record per event, encrypted on the device with XChaCha20-Poly1305
// under the profile's 32-byte data key (docs/decisions/0002 §4). Public relays see the author,
// the time, the size and an opaque "d" — nothing else: no labels, no type, no references.
//
//   d       = hex(HMAC-SHA256(data key, "blueline-record-v1:" + record id))
//   content = base64(0x01 ‖ 24-byte nonce ‖ ciphertext with tag), associated data = d
//
// The data key itself sits in one record found by the profile pubkey alone, encrypted with
// NIP-44 to the profile (one signer decryption per device):
//
//   d = hex(sha256("blueline-data-key-v1:" + pubkey)),  content = NIP-44({ v: 1, key, created })
//
// The cipher itself runs in lib/sync (@noble/ciphers); this module fixes slots, envelope and
// the plaintext schema.

const ENVELOPE_VERSION = 1
const NONCE_BYTES = 24
const TAG_BYTES = 16

// Plaintext one record event carries at most; larger data is split (chunks.ts) into parts.
const MAX_RECORD_PLAINTEXT_BYTES = 20000

const keyBytes = (key: Uint8Array | string) => (typeof key === "string" ? hexToBytes(key) : key)

export function recordSlot(dataKey: Uint8Array | string, recordId: string): string {
  const key = keyBytes(dataKey)
  if (key.length !== 32) throw new Error("the data key is 32 bytes")
  return bytesToHex(hmac(sha256, key, utf8ToBytes(`blueline-record-v1:${recordId}`)))
}

export const dataKeySlot = (pubkey: string) => bytesToHex(sha256(utf8ToBytes(`blueline-data-key-v1:${pubkey}`)))
export const partId = (recordId: string, seq: number) => `${recordId}#${seq}`
// Associated data of the cipher: the record can't be moved to another slot unnoticed.
export const recordAad = (slot: string) => utf8ToBytes(slot)

export function encodeEnvelope(nonce: Uint8Array, ciphertext: Uint8Array): string {
  if (nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) throw new Error("nonce or ciphertext malformed")
  return base64.encode(concatBytes(new Uint8Array([ENVELOPE_VERSION]), nonce, ciphertext))
}

export function decodeEnvelope(content: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  let raw: Uint8Array
  try {
    raw = base64.decode(content)
  } catch {
    throw new ProtocolError("invalid_content", "not base64")
  }
  if (raw[0] !== ENVELOPE_VERSION) throw new ProtocolError("unknown_version", `envelope version ${raw[0]}`)
  if (raw.length < 1 + NONCE_BYTES + TAG_BYTES) throw new ProtocolError("invalid_content", "envelope too short")
  return { nonce: raw.slice(1, 1 + NONCE_BYTES), ciphertext: raw.slice(1 + NONCE_BYTES) }
}

export function privateTemplate(slot: string, content: string, created_at: number): EventTemplate {
  if (!HEX64.test(slot)) throw new ProtocolError("invalid_tags", "slot is not 32 bytes of hex")
  const template = { kind: KIND_PRIVATE, created_at, tags: [["d", slot]], content }
  if (signedEventBytes(template) > MAX_EVENT_BYTES) throw new ProtocolError("too_large", "record exceeds the event budget")
  return template
}

// A received private record event: one opaque d tag and nothing else.
export function parsePrivateEvent(event: unknown, author: string): { ok: true; slot: string; event: SignedEvent } | { ok: false; reason: ProtocolError["reason"]; detail: string } {
  if (!isSignedEventShape(event)) return { ok: false, reason: "invalid_event", detail: "not a signed event" }
  if (event.kind !== KIND_PRIVATE) return { ok: false, reason: "wrong_kind", detail: `kind ${event.kind}` }
  if (event.pubkey !== author) return { ok: false, reason: "not_authorized", detail: "not this profile's record" }
  if (event.tags.length !== 1 || event.tags[0][0] !== "d" || event.tags[0].length !== 2 || !HEX64.test(event.tags[0][1]))
    return { ok: false, reason: "invalid_tags", detail: "a private record has exactly one opaque d tag" }
  if (signedEventBytes(event) > MAX_EVENT_BYTES) return { ok: false, reason: "too_large", detail: "over the event budget" }
  return { ok: true, slot: event.tags[0][1], event }
}

const recordType = () => str({ min: 1, max: 32, pattern: /^[a-z][a-z0-9.-]*$/, description: "match, players, settings, clubs, devices, friends, badges, payments, …" })
const recordId = () => str({ min: 1, max: 80, pattern: /^[A-Za-z0-9_.:-]+$/ })

// A whole record, or the head of one split into parts (then `parts` instead of `data`).
export const privateRecord = refine(
  obj({
    v: oneOf([1]),
    type: recordType(),
    id: recordId(),
    // Lamport counter of this record across the profile's devices, and the writing device:
    // two devices that change the same record offline are told apart instead of overwritten.
    rev: int(0, 2_147_483_647),
    device: hex(8, "Device id"),
    at: time(),
    deleted: opt(oneOf([1])),
    data: opt(anyObject(MAX_RECORD_PLAINTEXT_BYTES)),
    parts: opt(obj({ head: hex(32), total: int(1, 10000), bytes: int(1, 200_000_000) })),
  }),
  (v) => {
    const has = [v.data !== undefined, v.parts !== undefined, v.deleted !== undefined].filter(Boolean).length
    return has === 1 ? null : "exactly one of data, parts or deleted"
  },
)
export type PrivateRecord = Infer<typeof privateRecord>

export const recordPart = obj({ v: oneOf([1]), of: recordId(), set: hex(32), seq: int(0, 9999), total: int(1, 10000), prev: hex(32), data: str({ min: 1, max: MAX_RECORD_PLAINTEXT_BYTES }) })
export type RecordPart = Infer<typeof recordPart>

export const dataKeyRecord = obj({ v: oneOf([1]), key: hex(32, "The profile's data key"), created: time() })

export function checkPrivateRecord(plaintext: string, expectedId?: string): PrivateRecord {
  let record: PrivateRecord
  try {
    record = privateRecord.check(JSON.parse(plaintext), "")
  } catch (e) {
    throw new ProtocolError("invalid_content", e instanceof SchemaError ? e.message : "not JSON")
  }
  if (expectedId !== undefined && record.id !== expectedId) throw new ProtocolError("invalid_content", "record sits in another record's slot")
  return record
}

// The plaintexts to encrypt for one record: the record itself, or a head plus parts when the
// data is too large for one event. Each goes into its own slot: recordSlot(key, id) for the
// head, recordSlot(key, partId(id, seq)) for the parts.
export function splitRecord(head: Omit<PrivateRecord, "data" | "parts" | "deleted">, data: Record<string, unknown>): { head: PrivateRecord; parts: RecordPart[] } {
  const whole = { ...head, data }
  const json = JSON.stringify(whole)
  if (json.length <= MAX_RECORD_PLAINTEXT_BYTES && new TextEncoder().encode(json).length <= MAX_RECORD_PLAINTEXT_BYTES) {
    return { head: privateRecord.check(whole, ""), parts: [] }
  }
  const { chunks, head: chain, bytes } = chunkData(JSON.stringify(data), MAX_RECORD_PLAINTEXT_BYTES - 400)
  return {
    head: privateRecord.check({ ...head, parts: { head: chain, total: chunks.length, bytes } }, ""),
    parts: chunks.map((c) => ({ v: 1, of: head.id, set: c.set, seq: c.seq, total: c.total, prev: c.prev, data: c.data })),
  }
}

export function joinRecord(head: PrivateRecord, parts: readonly RecordPart[]): Record<string, unknown> {
  if (head.data) return head.data
  if (!head.parts) throw new ProtocolError("invalid_content", "a deleted record has no data")
  const chunks: Chunk[] = parts.filter((p) => p.of === head.id).map((p) => ({ set: p.set, seq: p.seq, total: p.total, prev: p.prev, data: p.data }))
  const text = assembleChunks(chunks, { head: head.parts.head, total: head.parts.total, bytes: head.parts.bytes })
  const data = JSON.parse(text)
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new ProtocolError("invalid_content", "parts do not form an object")
  return data
}
