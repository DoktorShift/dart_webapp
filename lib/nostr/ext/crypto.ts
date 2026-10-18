// Encryption building blocks that work with any Signer (local key, extension, remote signer).
// To be upstreamed to nostr-core (gap NC-08): its NIP-59 and NIP-51/78 helpers only take a raw
// secret key, which external signers never hand out.
//
// - NIP-59 seal and gift wrap through signer.nip44 and signer.signEvent; unwrapping checks both
//   signatures, that the seal's author wrote the rumor, and the rumor's id. nostr-core 1.0.6
//   checks the id too (PR-06, taken from here), but only in its raw-key unwrap.
// - A data-key envelope: private records are encrypted locally with XChaCha20-Poly1305 under a
//   random 32-byte key, so an external signer is asked to decrypt once per device (to unwrap
//   that key), not once per record (docs/decisions/0002, section 4).
// - Opaque d tags: HMAC-SHA256(data key, record id), so relays can't read record ids.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { hmac } from "@noble/hashes/hmac.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js"
import { base64 } from "@scure/base"
import { loadCore } from "../core.ts"
import { nowSeconds } from "../time.ts"
import type { EventTemplate, NostrEvent, Signer } from "../types.ts"

const SEAL_KIND = 13
export const GIFT_WRAP_KIND = 1059
// The ephemeral gift wrap, for live handshakes that must not be stored.
export const EPHEMERAL_GIFT_WRAP_KIND = 21059

export type CryptoErrorCode = "no-nip44" | "malformed" | "forged" | "undecryptable" | "wrong-key"

export class CryptoError extends Error {
  code: CryptoErrorCode
  constructor(code: CryptoErrorCode, message: string) {
    super(message)
    this.name = "CryptoError"
    this.code = code
  }
}

export interface Rumor {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

// Errors that tell something about the signer, not about the data: declined, no answer, out of
// reach, not supported. They pass through unchanged, because a declined prompt or a timeout
// taken for "this data is under another key" could lead a caller to replace the data key and
// lose every record encrypted under the old one. What counts as undecryptable: SignerError
// "failed" (a local key that can't decrypt, ../signers.ts) and plain errors of unwrapped signers.
// A remote signer answers a failed decryption and a refusal alike with an error message, so its
// errors always pass through: the safe side.
export function isSignerFailure(error: unknown): boolean {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown }
  return (name === "SignerError" && code !== "failed") || name === "Nip46RequestError"
}

// Runs a decryption through the signer; failures of the data become CryptoError("undecryptable").
async function decryptOr<T>(message: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof CryptoError || isSignerFailure(error)) throw error
    throw new CryptoError("undecryptable", message)
  }
}

const nip44Of = (signer: Signer) => {
  if (!signer.nip44) throw new CryptoError("no-nip44", "this signer can't encrypt (NIP-44)")
  return signer.nip44
}

// NIP-59 asks for timestamps up to two days in the past on seals and wraps, so relays can't
// tell when a message was really sent.
const blurredTime = () => nowSeconds() - Math.floor(Math.random() * 2 * 24 * 60 * 60)

// Seals an unsigned rumor for one recipient: NIP-44 to the recipient, signed by the sender.
export async function sealWithSigner(template: EventTemplate, signer: Signer, recipientPubkey: string): Promise<{ rumor: Rumor; seal: NostrEvent }> {
  const core = await loadCore()
  const nip44 = nip44Of(signer)
  // Only the four template fields: a signed event passed in must not leak its signature.
  const { kind, content, tags, created_at } = template
  const rumor = core.createRumor({ kind, content, tags, created_at }, await signer.getPublicKey()) as Rumor
  const seal = await signer.signEvent({ kind: SEAL_KIND, tags: [], content: await nip44.encrypt(recipientPubkey, JSON.stringify(rumor)), created_at: blurredTime() })
  return { rumor, seal }
}

// Seal plus gift wrap (a one-time key encrypts the seal to the recipient). Kind 21059 for the
// ephemeral variant: its wrap carries the current time, because relays drop ephemeral events
// that look older than a minute (strfry), and nothing is stored that could be dated anyway.
export async function giftWrapWithSigner(
  template: EventTemplate,
  signer: Signer,
  recipientPubkey: string,
  kind: typeof GIFT_WRAP_KIND | typeof EPHEMERAL_GIFT_WRAP_KIND = GIFT_WRAP_KIND,
): Promise<{ rumor: Rumor; wrap: NostrEvent }> {
  const core = await loadCore()
  const { rumor, seal } = await sealWithSigner(template, signer, recipientPubkey)
  // What nostr-core's createWrap does, plus the ephemeral kind and the skew-corrected clock.
  const oneTimeKey = core.generateSecretKey()
  const content = core.nip44.encrypt(JSON.stringify(seal), core.nip44.getConversationKey(oneTimeKey, recipientPubkey))
  const created_at = kind === GIFT_WRAP_KIND ? blurredTime() : nowSeconds()
  return { rumor, wrap: core.finalizeEvent({ kind, tags: [["p", recipientPubkey]], content, created_at }, oneTimeKey) }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new CryptoError("malformed", "not JSON")
  }
}

const isEventLike = (value: unknown): value is NostrEvent => {
  const e = value as NostrEvent | null
  return (
    !!e &&
    typeof e === "object" &&
    typeof e.id === "string" &&
    typeof e.pubkey === "string" &&
    typeof e.created_at === "number" &&
    typeof e.kind === "number" &&
    typeof e.content === "string" &&
    Array.isArray(e.tags) &&
    e.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === "string"))
  )
}

// Opens a gift wrap addressed to the signer. Returns the rumor and its real author. Throws
// CryptoError: "forged" when a signature, the author link or the rumor id doesn't hold,
// "undecryptable" when it isn't for this key; signer failures pass through (isSignerFailure).
export async function unwrapWithSigner(wrap: NostrEvent, signer: Signer): Promise<{ rumor: Rumor; sender: string }> {
  const core = await loadCore()
  const nip44 = nip44Of(signer)
  if (wrap.kind !== GIFT_WRAP_KIND && wrap.kind !== EPHEMERAL_GIFT_WRAP_KIND) throw new CryptoError("malformed", `kind ${wrap.kind} is no gift wrap`)
  if (!core.verifyEventSignature(wrap)) throw new CryptoError("forged", "the wrap's signature is not valid")
  const sealText = await decryptOr("not addressed to this key", () => nip44.decrypt(wrap.pubkey, wrap.content))
  const seal = parseJson(sealText)
  if (!isEventLike(seal) || typeof seal.sig !== "string" || seal.kind !== SEAL_KIND) throw new CryptoError("malformed", "no seal inside")
  if (seal.tags.length > 0) throw new CryptoError("malformed", "a seal has no tags")
  if (!core.verifyEventSignature(seal)) throw new CryptoError("forged", "the seal's signature is not valid")
  const rumorText = await decryptOr("the seal can't be opened", () => nip44.decrypt(seal.pubkey, seal.content))
  const rumor = parseJson(rumorText)
  if (!isEventLike(rumor)) throw new CryptoError("malformed", "no rumor inside")
  if (rumor.pubkey !== seal.pubkey) throw new CryptoError("forged", "the rumor claims another author than the seal")
  const { id, pubkey, created_at, kind, tags, content } = rumor
  if (core.getEventHash({ pubkey, created_at, kind, tags, content }) !== id) throw new CryptoError("forged", "the rumor's id doesn't match its content")
  return { rumor: { id, pubkey, created_at, kind, tags, content }, sender: seal.pubkey }
}

// --- data key --------------------------------------------------------------------------------

const DATA_KEY_ENVELOPE_VERSION = 1

export function generateDataKey(): Uint8Array {
  return randomBytes(32)
}

function checkKey(dataKey: Uint8Array) {
  if (!(dataKey instanceof Uint8Array) || dataKey.length !== 32) throw new CryptoError("wrong-key", "a data key has 32 bytes")
}

// Additional data binds the version (and optionally the record) to the ciphertext, so an
// envelope can't be moved to another record unnoticed.
const associatedData = (version: number, context: string) => {
  const extra = new TextEncoder().encode(context)
  const data = new Uint8Array(1 + extra.length)
  data[0] = version
  data.set(extra, 1)
  return data
}

// Encrypts text under the data key: base64(version || nonce(24) || ciphertext+tag).
// `context` (for example the record id) must be given again to decrypt.
export function encryptWithDataKey(dataKey: Uint8Array, plaintext: string, context = ""): string {
  checkKey(dataKey)
  const nonce = randomBytes(24)
  const ciphertext = xchacha20poly1305(dataKey, nonce, associatedData(DATA_KEY_ENVELOPE_VERSION, context)).encrypt(new TextEncoder().encode(plaintext))
  const envelope = new Uint8Array(1 + nonce.length + ciphertext.length)
  envelope[0] = DATA_KEY_ENVELOPE_VERSION
  envelope.set(nonce, 1)
  envelope.set(ciphertext, 25)
  return base64.encode(envelope)
}

export function decryptWithDataKey(dataKey: Uint8Array, envelope: string, context = ""): string {
  checkKey(dataKey)
  let bytes: Uint8Array
  try {
    bytes = base64.decode(envelope)
  } catch {
    throw new CryptoError("malformed", "not an envelope")
  }
  if (bytes.length < 1 + 24 + 16) throw new CryptoError("malformed", "envelope too short")
  if (bytes[0] !== DATA_KEY_ENVELOPE_VERSION) throw new CryptoError("malformed", `unknown envelope version ${bytes[0]}`)
  try {
    const plaintext = xchacha20poly1305(dataKey, bytes.subarray(1, 25), associatedData(bytes[0], context)).decrypt(bytes.subarray(25))
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext)
  } catch {
    throw new CryptoError("undecryptable", "wrong key, wrong record or damaged data")
  }
}

// The data key wrapped for storage on relays: NIP-44 to the profile itself. Only the profile's
// signer can unwrap it.
export async function wrapDataKey(dataKey: Uint8Array, signer: Signer): Promise<string> {
  checkKey(dataKey)
  return nip44Of(signer).encrypt(await signer.getPublicKey(), bytesToHex(dataKey))
}

// Throws CryptoError "undecryptable" only when the wrapped key really doesn't open with this
// signer's key; a declined or unanswered request throws the signer's error instead (see
// isSignerFailure), and must never be taken as a reason to create a new data key.
export async function unwrapDataKey(wrapped: string, signer: Signer): Promise<Uint8Array> {
  const nip44 = nip44Of(signer)
  const pubkey = await signer.getPublicKey()
  const hex = await decryptOr("the data key can't be unwrapped with this signer", () => nip44.decrypt(pubkey, wrapped))
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new CryptoError("malformed", "no data key inside")
  return hexToBytes(hex)
}

// The d tag for a private record: HMAC-SHA256(data key, record id) as hex. The same record gets
// the same tag on every device; relays learn nothing about the id.
export function opaqueDTag(dataKey: Uint8Array, recordId: string): string {
  checkKey(dataKey)
  return bytesToHex(hmac(sha256, dataKey, new TextEncoder().encode(recordId)))
}
