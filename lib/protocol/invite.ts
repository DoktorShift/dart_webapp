import { hkdf } from "@noble/hashes/hkdf"
import { hmac } from "@noble/hashes/hmac"
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
// The club.invite record carries the token sealed for the club's members, so every member can
// check a joiner's proof; the joiner proves possession bound to their own key with
//
//   proof = HMAC-SHA256(key = token, message = "blueline-invite-v1:" + joiner pubkey hex)
//
// A proof copied from someone else's join is worthless for any other pubkey. The token also
// opens the preview people see before they join (name, description, host, next date):
//
//   previewKey = HKDF-SHA256(ikm = token, salt = "blueline-invite-v1", info = "preview", 32)
//
// Two kinds (docs/decisions/0002 §6): a group link admits everyone with a valid proof until it
// expires or is revoked; a personal invite is used once and, like a request without invite,
// counts only when an owner or admin accepts it.

export const INVITE_KINDS = ["group", "personal"] as const
export type InviteKind = (typeof INVITE_KINDS)[number]

export function newInviteToken(random: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): string {
  if (random.length !== 16) throw new Error("an invite token is 16 bytes")
  return bytesToHex(random)
}

export function inviteProof(token: string, pubkey: string): string {
  if (!HEX32.test(token) || !HEX64.test(pubkey)) throw new Error("token or pubkey malformed")
  return bytesToHex(hmac(sha256, hexToBytes(token), utf8ToBytes(`blueline-invite-v1:${pubkey}`)))
}

// Constant-time comparison, so the check leaks nothing about how close a guess was.
export function verifyInviteProof(token: string, pubkey: string, proof: string): boolean {
  if (!HEX32.test(token) || !HEX64.test(pubkey) || !HEX64.test(proof)) return false
  const expected = inviteProof(token, pubkey)
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i)
  return diff === 0
}

export function previewKey(token: string): Uint8Array {
  if (!HEX32.test(token)) throw new Error("token malformed")
  return hkdf(sha256, hexToBytes(token), utf8ToBytes("blueline-invite-v1"), utf8ToBytes("preview"), 32)
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
