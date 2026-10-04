import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import { HEX32, HEX64 } from "./tags.ts"

// Club invites (docs/protocol/families/club.md, "Einladungen"). An invite token is 16 random
// bytes: the secret of the invite link (it travels in the URL fragment, never to a server).
// The admin's club.invite record carries the token sealed to the club key, so every member
// can check a joiner's proof; the joiner proves possession bound to their own key with
//
//   proof = HMAC-SHA256(key = token, message = "blueline-invite-v1:" + joiner pubkey hex)
//
// A proof copied from someone else's join is worthless for any other pubkey.

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
