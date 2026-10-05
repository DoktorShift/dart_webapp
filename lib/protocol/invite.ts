import { schnorr } from "@noble/curves/secp256k1"
import { hkdf } from "@noble/hashes/hkdf"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import { name, pubkey, shortText } from "./common.ts"
import { ProtocolError } from "./reasons.ts"
import type { Infer } from "./schema.ts"
import { httpsUrl, obj, oneOf, opt, SchemaError, time } from "./schema.ts"
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
