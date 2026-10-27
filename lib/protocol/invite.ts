import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { schnorr } from "@noble/curves/secp256k1"
import { hkdf } from "@noble/hashes/hkdf"
import { scryptAsync } from "@noble/hashes/scrypt.js"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import { base64 } from "@scure/base"
import { name, pubkey, shortText } from "./common.ts"
import { ProtocolError } from "./reasons.ts"
import type { Infer } from "./schema.ts"
import { bool, httpsUrl, obj, oneOf, opt, SchemaError, time } from "./schema.ts"
import type { SealedEnvelope } from "./seal.ts"
import { openPreview } from "./seal.ts"
import { HEX32, HEX64 } from "./tags.ts"

// Club invites (docs/protocol/families/club.md, "Einladungen"). An invite token is 16 random
// bytes: the secret of the invite link (it travels in the URL fragment, never to a server).
// Two keys are derived from it:
//
//   invite key  = HKDF-SHA256(ikm = token, salt = "blueline-invite-v1", info = "proof", 32)
//   previewKey  = HKDF-SHA256(ikm = token, salt = "blueline-invite-v1", info = "preview", 32)
//
// The club.invite record carries only the invite key's public key (x-only, like a Nostr
// pubkey), never the token. A joiner proves possession bound to their own key with a BIP-340
// signature of the invite key:
//
//   proof = schnorr.sign(sha256("blueline-invite-v1:" + joiner pubkey hex), invite key)
//
// Everyone who can read the invite record checks a proof, without learning the token: in a
// public club that is everyone (docs/decisions/0002 §6, amended after review round 1 of P0.05:
// the earlier HMAC proof could only be checked by holders of the token). A proof copied from
// someone else's join is worthless for any other pubkey. The preview key opens what people see
// before they join (name, description, host, next date) in a closed club's sealed invite.
//
// Two kinds (docs/decisions/0002 §6): a group link admits everyone with a valid proof until it
// expires or is revoked; a personal invite is used once and, like a request without invite,
// counts only when an owner or admin accepts it.

export const INVITE_KINDS = ["group", "personal"] as const
export type InviteKind = (typeof INVITE_KINDS)[number]

const derive = (token: string, info: string) => {
  if (!HEX32.test(token)) throw new Error("token malformed")
  return hkdf(sha256, hexToBytes(token), utf8ToBytes("blueline-invite-v1"), utf8ToBytes(info), 32)
}

// The invite key's public key: what the club.invite record names in `key`.
export const inviteKey = (token: string): string => bytesToHex(schnorr.getPublicKey(derive(token, "proof")))

// A derived invite key falls outside the curve order with a chance of about 2^-128; inviteKey
// would throw for such a token, so the caller simply draws again.
export function newInviteToken(random: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): string {
  if (random.length !== 16) throw new Error("an invite token is 16 bytes")
  return bytesToHex(random)
}

const proofMessage = (joiner: string) => sha256(utf8ToBytes(`blueline-invite-v1:${joiner}`))

// `aux` is BIP-340's auxiliary randomness: random by default, fixed only for test vectors.
export function inviteProof(token: string, joiner: string, aux: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): string {
  if (!HEX64.test(joiner)) throw new Error("pubkey malformed")
  return bytesToHex(schnorr.sign(proofMessage(joiner), derive(token, "proof"), aux))
}

export function verifyInviteProof(key: string, joiner: string, proof: string): boolean {
  if (!HEX64.test(key) || !HEX64.test(joiner) || !/^[0-9a-f]{128}$/.test(proof)) return false
  try {
    return schnorr.verify(hexToBytes(proof), proofMessage(joiner), hexToBytes(key))
  } catch {
    return false
  }
}

export const previewKey = (token: string): Uint8Array => derive(token, "preview")

// ---- Short codes --------------------------------------------------------------------------------
//
// A group link can also be said aloud: eight characters from an alphabet of 32 without 0, O, 1
// and I, shown as "ABCD-EFGH" (docs/protocol/families/club.md, "Kurzcode"). The code is a bearer
// secret of 40 bits, so nothing fast is derived from it: everything goes through scrypt, and the
// invite record carries only what the code opens, in a tag the relays index:
//
//   k      = scrypt(password = code, salt = "blueline-code-v1", N = 2^15, r = 8, p = 1, 32 bytes)
//   lookup = sha256("blueline-code-lookup-v1" ‖ k)[0..16] as hex           → tag ["c", lookup, wrap]
//   wrap   = base64(nonce ‖ XChaCha20-Poly1305(key = sha256("blueline-code-wrap-v1" ‖ k), nonce, token, aad = "blueline-code-v1"))
//
// Whoever types the code asks the relays for the tag, opens the wrap and has the token: the
// same join as with the link. A relay sees a lookup value it cannot turn back into a code, and
// guessing codes against the tags costs a scrypt per guess (about 0.2 s and 32 MiB each).

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const CODE_LENGTH = 8
const CODE_SALT = utf8ToBytes("blueline-code-v1")
const CODE_AAD = utf8ToBytes("blueline-code-v1")
export const CODE_TAG = "c"

// 32 letters: a byte's low five bits pick one without bias.
export function newInviteCode(random: Uint8Array = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))): string {
  if (random.length !== CODE_LENGTH) throw new Error(`a code is ${CODE_LENGTH} characters`)
  return Array.from(random, (b) => CODE_ALPHABET[b & 31]).join("")
}

// What someone typed, as a code: upper case, separators dropped; null unless it is one.
export function normalizeInviteCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch)) ? code : null
}

export const formatInviteCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

async function codeKeys(code: string): Promise<{ lookup: string; wrapKey: Uint8Array }> {
  if (normalizeInviteCode(code) !== code) throw new Error("not a code")
  const k = await scryptAsync(utf8ToBytes(code), CODE_SALT, { N: 2 ** 15, r: 8, p: 1, dkLen: 32 })
  return {
    lookup: bytesToHex(sha256(concatBytes(utf8ToBytes("blueline-code-lookup-v1"), k)).subarray(0, 16)),
    wrapKey: sha256(concatBytes(utf8ToBytes("blueline-code-wrap-v1"), k)),
  }
}

// The value relays index for a code: what a join by code asks for.
export const codeLookup = async (code: string): Promise<string> => (await codeKeys(code)).lookup

// The tag an invite record carries for its code. `nonce` is random; fixed only for test vectors.
export async function codeTag(code: string, token: string, nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(24))): Promise<string[]> {
  if (!HEX32.test(token)) throw new Error("token malformed")
  if (nonce.length !== 24) throw new Error("a nonce has 24 bytes")
  const { lookup, wrapKey } = await codeKeys(code)
  const sealed = xchacha20poly1305(wrapKey, nonce, CODE_AAD).encrypt(hexToBytes(token))
  return [CODE_TAG, lookup, base64.encode(concatBytes(nonce, sealed))]
}

// The token of an invite record found by its code; null when the tag is missing or does not
// open with this code (another invite with the same lookup, or a damaged tag).
export async function openCodeTag(tags: readonly string[][], code: string): Promise<string | null> {
  const { lookup, wrapKey } = await codeKeys(code)
  const tag = tags.find((t) => t[0] === CODE_TAG && t[1] === lookup)
  if (!tag || typeof tag[2] !== "string") return null
  try {
    const bytes = base64.decode(tag[2])
    if (bytes.length !== 24 + 16 + 16) return null
    return bytesToHex(xchacha20poly1305(wrapKey, bytes.subarray(0, 24), CODE_AAD).decrypt(bytes.subarray(24)))
  } catch {
    return null
  }
}

// What someone who opens the invite link sees before joining or creating a profile. The host's
// display name is written here because the person may not reach any profile yet.
export const invitePreview = obj({
  name: name(),
  about: opt(shortText(500)),
  picture: opt(httpsUrl()),
  host: pubkey("Owner or admin who made the invite"),
  hostName: opt(name()),
  kind: oneOf(INVITE_KINDS),
  expires: time(),
  limited: opt(bool("A group link only asks, an owner or admin accepts: the club has a member limit or confirms new members, or a member made the invite")),
  next: opt(obj({ title: name(), starts: time(), place: opt(shortText(140)) })),
})
export type InvitePreview = Infer<typeof invitePreview>

export const previewPlaintext = (preview: InvitePreview) => JSON.stringify(invitePreview.check(preview, ""))

// The preview of an invite record's envelope, opened with the link's token.
export function readInvitePreview(envelope: SealedEnvelope, token: string): InvitePreview {
  const text = openPreview(envelope, previewKey(token))
  if (text === null) throw new ProtocolError("invite_proof_invalid", "the link does not open this invite")
  try {
    return invitePreview.check(JSON.parse(text), "")
  } catch (e) {
    throw new ProtocolError("invalid_content", e instanceof SchemaError ? e.message : "preview is not JSON")
  }
}
