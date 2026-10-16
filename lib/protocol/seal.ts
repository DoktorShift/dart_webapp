import { xchacha20poly1305 } from "@noble/ciphers/chacha"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import { base64 } from "@scure/base"
import { ProtocolError } from "./reasons.ts"
import type { SignedEvent } from "./tags.ts"
import { encryptionOf, HEX64, isSignedEventShape, readLabels } from "./tags.ts"

// Sealed records of closed clubs (docs/protocol/families/club.md, "Geschlossene Clubs";
// docs/decisions/0002 §6). There is no shared club secret: every confidential record gets its
// own random 32-byte content key, the content is encrypted with XChaCha20-Poly1305 under it,
// and the key is wrapped with NIP-44 from the author to each current member, all inside the
// same event (tag ["enc","seal"]). A removed member is simply no longer wrapped for.
//
//   content = {"v":1,"n":<nonce>,"c":<ciphertext>,"k":[[<hint>,<wrap>],…],"p":{"n":…,"c":…}}
//
//   n     24 random bytes, base64
//   c     base64(XChaCha20-Poly1305(content key, n, plaintext, aad = "blueline-seal-v1:" + type))
//   wrap  NIP-44 v2 payload from the event's author to one reader; plaintext = content key, hex
//   hint  hex(sha256("blueline-seal-hint-v1" ‖ n ‖ reader pubkey)[0..4]): the reader finds
//         their wrap without trying all of them, an observer cannot list the readers
//   p     only on club.invite: the preview for people who open the invite link, encrypted the
//         same way under previewKey(token) (invite.ts) with aad "blueline-preview-v1"
//
// NIP-44 itself runs where the signer is (lib/nostr); this module fixes the format and does the
// symmetric part, so nothing here needs a secret key of a person.

const SEAL_VERSION = 1
// Readers one event can wrap for: each wrap costs about 190 bytes of the 32 KiB event budget.
export const MAX_SEAL_READERS = 100

const NONCE_BYTES = 24
const KEY_BYTES = 32
const TAG_BYTES = 16
const HINT = /^[0-9a-f]{8}$/
// A NIP-44 v2 payload of a 64-character plaintext is 176 base64 characters.
const WRAP = /^[A-Za-z0-9+/]{100,400}={0,2}$/
const B64 = /^[A-Za-z0-9+/]*={0,2}$/

export interface SealedEnvelope {
  nonce: Uint8Array
  ciphertext: Uint8Array
  wraps: { hint: string; payload: string }[]
  preview?: { nonce: Uint8Array; ciphertext: Uint8Array }
}

export const newContentKey = (random: Uint8Array = crypto.getRandomValues(new Uint8Array(KEY_BYTES))): Uint8Array => {
  if (random.length !== KEY_BYTES) throw new Error("a content key is 32 bytes")
  return random.slice()
}

export const newSealNonce = (random: Uint8Array = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))): Uint8Array => {
  if (random.length !== NONCE_BYTES) throw new Error("a nonce is 24 bytes")
  return random.slice()
}

// What each reader's wrap encrypts with NIP-44: the content key as lowercase hex.
export const contentKeyText = (key: Uint8Array) => {
  if (key.length !== KEY_BYTES) throw new Error("a content key is 32 bytes")
  return bytesToHex(key)
}

export function wrapHint(nonce: Uint8Array, reader: string): string {
  if (!HEX64.test(reader)) throw new Error("reader is not a pubkey")
  return bytesToHex(sha256(concatBytes(utf8ToBytes("blueline-seal-hint-v1"), nonce, hexToBytes(reader))).slice(0, 4))
}

const sealAad = (type: string) => utf8ToBytes(`blueline-seal-v1:${type}`)
const PREVIEW_AAD = utf8ToBytes("blueline-preview-v1")

const encrypt = (key: Uint8Array, nonce: Uint8Array, plaintext: string, aad: Uint8Array) => xchacha20poly1305(key, nonce, aad).encrypt(utf8ToBytes(plaintext))

function decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(xchacha20poly1305(key, nonce, aad).decrypt(ciphertext))
  } catch {
    return null
  }
}

// The envelope text for a record of `type`. `wraps` are the NIP-44 payloads of
// contentKeyText(key), one per reader, made by the author's signer.
export function buildEnvelope(input: {
  type: string
  plaintext: string
  key: Uint8Array
  nonce: Uint8Array
  wraps: readonly { reader: string; payload: string }[]
  preview?: { key: Uint8Array; nonce: Uint8Array; plaintext: string }
}): string {
  if (input.key.length !== KEY_BYTES || input.nonce.length !== NONCE_BYTES) throw new ProtocolError("invalid_content", "content key or nonce malformed")
  if (input.wraps.length === 0) throw new ProtocolError("invalid_content", "a sealed record has at least one reader")
  if (input.wraps.length > MAX_SEAL_READERS) throw new ProtocolError("too_large", `more than ${MAX_SEAL_READERS} readers`)
  if (new Set(input.wraps.map((w) => w.reader)).size !== input.wraps.length) throw new ProtocolError("invalid_content", "a reader is wrapped for twice")
  for (const w of input.wraps) if (!WRAP.test(w.payload)) throw new ProtocolError("invalid_content", "a wrap is not a NIP-44 payload")
  const out: Record<string, unknown> = {
    v: SEAL_VERSION,
    n: base64.encode(input.nonce),
    c: base64.encode(encrypt(input.key, input.nonce, input.plaintext, sealAad(input.type))),
    // Sorted by hint: the order of the readers says nothing about who joined when.
    k: input.wraps.map((w) => [wrapHint(input.nonce, w.reader), w.payload]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)),
  }
  if (input.preview) {
    const p = input.preview
    if (p.key.length !== KEY_BYTES || p.nonce.length !== NONCE_BYTES) throw new ProtocolError("invalid_content", "preview key or nonce malformed")
    out.p = { n: base64.encode(p.nonce), c: base64.encode(encrypt(p.key, p.nonce, p.plaintext, PREVIEW_AAD)) }
  }
  return JSON.stringify(out)
}

const bytes = (text: unknown, what: string, length?: number): Uint8Array => {
  if (typeof text !== "string" || !B64.test(text)) throw new ProtocolError("invalid_content", `${what} is not base64`)
  let raw: Uint8Array
  try {
    raw = base64.decode(text)
  } catch {
    throw new ProtocolError("invalid_content", `${what} is not base64`)
  }
  if (length !== undefined && raw.length !== length) throw new ProtocolError("invalid_content", `${what} has ${raw.length} bytes`)
  return raw
}

// Reads the envelope's structure (without any key). An unknown envelope version throws
// "unknown_version": the record is kept, not executed.
export function parseEnvelope(content: string): SealedEnvelope {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new ProtocolError("invalid_content", "sealed content is not JSON")
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ProtocolError("invalid_content", "sealed content is not an object")
  const e = raw as Record<string, unknown>
  if (!Number.isSafeInteger(e.v)) throw new ProtocolError("invalid_content", "seal version missing")
  if (e.v !== SEAL_VERSION) throw new ProtocolError("unknown_version", `seal version ${String(e.v)}`)
  const nonce = bytes(e.n, "nonce", NONCE_BYTES)
  const ciphertext = bytes(e.c, "ciphertext")
  if (ciphertext.length < TAG_BYTES) throw new ProtocolError("invalid_content", "ciphertext too short")
  if (!Array.isArray(e.k) || e.k.length === 0 || e.k.length > MAX_SEAL_READERS) throw new ProtocolError("invalid_content", "wraps missing or too many")
  const wraps = e.k.map((w) => {
    if (!Array.isArray(w) || w.length !== 2 || typeof w[0] !== "string" || !HINT.test(w[0]) || typeof w[1] !== "string" || !WRAP.test(w[1]))
      throw new ProtocolError("invalid_content", "malformed wrap")
    return { hint: w[0], payload: w[1] }
  })
  let preview: SealedEnvelope["preview"]
  if (e.p !== undefined) {
    const p = e.p as Record<string, unknown>
    if (typeof p !== "object" || p === null) throw new ProtocolError("invalid_content", "malformed preview")
    preview = { nonce: bytes(p.n, "preview nonce", NONCE_BYTES), ciphertext: bytes(p.c, "preview ciphertext") }
    if (preview.ciphertext.length < TAG_BYTES) throw new ProtocolError("invalid_content", "preview too short")
  }
  return { nonce, ciphertext, wraps, ...(preview ? { preview } : {}) }
}

// The wraps that may be for `reader` (hint collisions are possible, so callers try each).
export const wrapsFor = (envelope: SealedEnvelope, reader: string) => {
  const hint = wrapHint(envelope.nonce, reader)
  return envelope.wraps.filter((w) => w.hint === hint).map((w) => w.payload)
}

// The plaintext, or null when the key does not open it (wrong key, damaged or moved content).
export const openEnvelope = (envelope: SealedEnvelope, type: string, key: Uint8Array): string | null =>
  key.length === KEY_BYTES ? decrypt(key, envelope.nonce, envelope.ciphertext, sealAad(type)) : null

export const openPreview = (envelope: SealedEnvelope, previewKey: Uint8Array): string | null =>
  envelope.preview && previewKey.length === KEY_BYTES ? decrypt(previewKey, envelope.preview.nonce, envelope.preview.ciphertext, PREVIEW_AAD) : null

// ---- Opening a set of events ----------------------------------------------------------------

// Wraps with the reader's hint tried per event. Two real hints collide with a chance of about
// one in a million per event; more matches mean someone is trying to make the signer work.
export const MAX_WRAP_TRIES = 3

export interface OpenOptions {
  // Pubkey of the person reading.
  reader: string
  // NIP-44 decryption by the reader's signer (author pubkey, payload) → plaintext; null or a
  // rejected promise when it does not decrypt.
  unwrap: (author: string, payload: string) => Promise<string | null>
  // Content keys known from earlier (local cache), by event id.
  known?: ReadonlyMap<string, string>
  // Authors whose wraps are worth a signer call (e.g. people who ever acted in the club). A
  // stranger can address sealed events to anyone; with a remote signer every try costs a round
  // trip. Shared keys are tried regardless: that costs nothing.
  trust?: (author: string) => boolean
}

export interface Opened {
  // Decrypted content by event id, for ReplayOptions.open.
  plaintexts: Map<string, string>
  // Content keys that opened them, by event id (worth caching: no signer call next time).
  keys: Map<string, string>
}

interface SealedItem {
  event: SignedEvent
  type: string
  envelope: SealedEnvelope
}

// Opens every sealed event the reader can: first through their own wraps, then with content
// keys that club.keys records (opened along the way) share — that is how a new member reads
// what was written before they joined. Wrong keys never open anything (the cipher
// authenticates), so keys are tried whoever shared them; authority is the reducers' business.
export async function openSealedEvents(events: readonly unknown[], opts: OpenOptions): Promise<Opened> {
  const items: SealedItem[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (!isSignedEventShape(event) || seen.has(event.id)) continue
    seen.add(event.id)
    const labels = readLabels(event.tags)
    if (!labels || encryptionOf(event.tags).form !== "seal") continue
    try {
      items.push({ event, type: labels.type, envelope: parseEnvelope(event.content) })
    } catch {
      // Malformed or newer envelopes stay closed; parseRecord says why.
    }
  }

  const keys = new Map<string, string>()
  const plaintexts = new Map<string, string>()
  const tryKey = (item: SealedItem, keyHex: string) => {
    if (!HEX64.test(keyHex)) return false
    const text = openEnvelope(item.envelope, item.type, hexToBytes(keyHex))
    if (text === null) return false
    plaintexts.set(item.event.id, text)
    keys.set(item.event.id, keyHex)
    return true
  }

  for (const item of items) {
    const cached = opts.known?.get(item.event.id)
    if (cached && tryKey(item, cached)) continue
    if (opts.trust && !opts.trust(item.event.pubkey)) continue
    for (const payload of wrapsFor(item.envelope, opts.reader).slice(0, MAX_WRAP_TRIES)) {
      let keyHex: string | null = null
      try {
        keyHex = await opts.unwrap(item.event.pubkey, payload)
      } catch {
        keyHex = null
      }
      if (keyHex !== null && tryKey(item, keyHex.trim().toLowerCase())) break
    }
  }

  // Shared keys may open further club.keys records, which may share more: repeat until
  // nothing new opens.
  const shared = new Map<string, string>()
  for (let changed = true; changed; ) {
    changed = false
    for (const item of items) {
      if (item.type !== "club.keys" || !plaintexts.has(item.event.id)) continue
      for (const [id, key] of sharedKeyList(plaintexts.get(item.event.id) as string)) if (!shared.has(id)) shared.set(id, key)
    }
    for (const item of items) {
      if (plaintexts.has(item.event.id)) continue
      const key = shared.get(item.event.id)
      if (key && tryKey(item, key)) changed = true
    }
  }
  return { plaintexts, keys }
}

// The [event id, key] pairs of a club.keys plaintext; malformed entries are skipped here
// (the reducer rejects the record itself).
function sharedKeyList(plaintext: string): [string, string][] {
  try {
    const keys = (JSON.parse(plaintext) as { keys?: unknown }).keys
    if (!Array.isArray(keys)) return []
    return keys.filter((k): k is [string, string] => Array.isArray(k) && k.length === 2 && HEX64.test(String(k[0])) && HEX64.test(String(k[1])))
  } catch {
    return []
  }
}
