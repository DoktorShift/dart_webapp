import { hkdf } from "@noble/hashes/hkdf"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import type { EventTemplate } from "../nostr/types.ts"
import type { HandshakeParse } from "./handshake.ts"
import { handshakeTemplate, parseHandshake } from "./handshake.ts"
import { MAX_HANDSHAKE_SECONDS, MAX_WRAPPED_PLAINTEXT_BYTES } from "./kinds.ts"
import type { LinkPayload } from "./links.ts"
import { decodeLinkPayload, encodeLinkPayload } from "./links.ts"
import type { Reason } from "./reasons.ts"
import type { Infer } from "./schema.ts"
import { anyObject, hex, obj, oneOf, opt, str, time } from "./schema.ts"
import { HEX32, HEX64 } from "./tags.ts"

// Adding one's own device (docs/protocol/families/pairing.md). The new device shows a QR or
// link with a one-time pubkey, a session id and an expiry, or a 12-character code. The existing
// device, opened explicitly on "Eigenes Gerät hinzufügen", answers with its own one-time key;
// both show the same check code computed from both keys and the session id; only after both
// people confirm does the profile package travel, and only the new device's acknowledgement
// with the package hash makes it "done". Every message is NIP-44 encrypted between the two
// one-time keys and names the session id.

// ---- QR and link -------------------------------------------------------------------------

export type PairingLink = Extract<LinkPayload, { type: "pair" }>

export const encodePairingLink = (p: Omit<PairingLink, "type">) => encodeLinkPayload({ type: "pair", ...p })
// Refuses board, watch, club and every other code with "wrong_flow".
export const decodePairingLink = (text: string): PairingLink => decodeLinkPayload("pair", text)

// ---- Code for devices without a camera ---------------------------------------------------

// 60 random bits as 12 Crockford base32 characters, shown as "XXXX-XXXX-XXXX". The code is the
// secret itself (docs/decisions/0001, F9): it derives the lookup tag under which the new device
// announces itself and the key that authenticates both sides. It is never the check code.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function newPairingSecret(random: Uint8Array = crypto.getRandomValues(new Uint8Array(8))): Uint8Array {
  if (random.length !== 8) throw new Error("a pairing secret is 8 bytes")
  const secret = random.slice()
  secret[0] &= 0x0f
  return secret
}

export function encodePairingCode(secret: Uint8Array): string {
  if (secret.length !== 8 || secret[0] > 0x0f) throw new Error("a pairing secret is 60 bits")
  const bits = Array.from(secret, (b) => b.toString(2).padStart(8, "0"))
    .join("")
    .slice(4)
  let code = ""
  for (let i = 0; i < 60; i += 5) code += CROCKFORD[parseInt(bits.slice(i, i + 5), 2)]
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`
}

// Accepts what people type: any case, spaces and dashes, O for 0, I and L for 1.
export function decodePairingCode(input: string): Uint8Array | null {
  const clean = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
  if (clean.length !== 12) return null
  let bits = "0000"
  for (const ch of clean) {
    const v = CROCKFORD.indexOf(ch)
    if (v < 0) return null
    bits += v.toString(2).padStart(5, "0")
  }
  const secret = new Uint8Array(8)
  for (let i = 0; i < 8; i++) secret[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  return secret
}

// lookup: 16 bytes, hex, the "x" tag of the announce. auth: key of the announce and hello MACs.
export function pairingCodeKeys(secret: Uint8Array): { lookup: string; auth: string } {
  const salt = utf8ToBytes("blueline-pair-v1")
  return {
    lookup: bytesToHex(hkdf(sha256, secret, salt, utf8ToBytes("lookup"), 16)),
    auth: bytesToHex(hkdf(sha256, secret, salt, utf8ToBytes("auth"), 32)),
  }
}

const mac = (authKey: string, text: string) => bytesToHex(hmac(sha256, hexToBytes(authKey), utf8ToBytes(text)))
export const announceMac = (authKey: string, newDevice: string, sid: string, exp: number) => mac(authKey, `announce:${newDevice}:${sid}:${exp}`)
export const helloMac = (authKey: string, existingDevice: string, newDevice: string, sid: string) => mac(authKey, `hello:${existingDevice}:${newDevice}:${sid}`)

// ---- Check code ----------------------------------------------------------------------------

// 8 digits (about 26 bits) both screens show after the key exchange:
// sha256("blueline-pair-sas-v1" ‖ 0x00 ‖ new device key ‖ existing device key ‖ session id),
// first 5 bytes as a number, modulo 10^8.
export function pairingCheckCode(newDevice: string, existingDevice: string, sid: string): string {
  if (!HEX64.test(newDevice) || !HEX64.test(existingDevice) || !HEX32.test(sid)) throw new Error("keys or session id malformed")
  const digest = sha256(concatBytes(utf8ToBytes("blueline-pair-sas-v1"), new Uint8Array([0]), hexToBytes(newDevice), hexToBytes(existingDevice), hexToBytes(sid)))
  let n = 0
  for (let i = 0; i < 5; i++) n = n * 256 + digest[i]
  const digits = String(n % 100_000_000).padStart(8, "0")
  return `${digits.slice(0, 4)} ${digits.slice(4)}`
}

// ---- Messages --------------------------------------------------------------------------------

const sid = () => hex(16, "Session id")
const device = () => str({ min: 1, max: 40, description: "Device name the other side shows" })

// The profile package's content is lib/devices' business; it stays small (key, relay hints,
// settings) and history follows over the normal sync afterwards.
export const MAX_PACKAGE_BYTES = MAX_WRAPPED_PLAINTEXT_BYTES

export const PAIRING_MESSAGES = {
  announce: obj({ t: oneOf(["announce"]), sid: sid(), exp: time(), mac: hex(32) }, { strict: true }),
  hello: obj({ t: oneOf(["hello"]), sid: sid(), device: device(), mac: opt(hex(32)) }, { strict: true }),
  accept: obj({ t: oneOf(["accept"]), sid: sid(), device: device() }, { strict: true }),
  package: obj({ t: oneOf(["package"]), sid: sid(), data: anyObject(MAX_PACKAGE_BYTES - 200, "Profile package (lib/devices)") }, { strict: true }),
  ack: obj({ t: oneOf(["ack"]), sid: sid(), hash: hex(32, "sha256 of the package data as sent") }, { strict: true }),
  abort: obj({ t: oneOf(["abort"]), sid: sid(), reason: oneOf(["declined", "expired", "mismatch", "error"]) }, { strict: true }),
}

export type PairingMessage = { [K in keyof typeof PAIRING_MESSAGES]: Infer<(typeof PAIRING_MESSAGES)[K]> }[keyof typeof PAIRING_MESSAGES]

export const BOARD_MESSAGE_TYPES = ["look", "table", "join", "seat", "decline", "leave"] as const

export function pairingTemplate(opts: { message: PairingMessage; created_at: number; recipient?: string; lookup?: string; ciphertext?: string }): EventTemplate {
  const checked = PAIRING_MESSAGES[opts.message.t].check(opts.message, "")
  const plain = JSON.stringify(checked)
  if (opts.message.t === "announce") {
    if (!opts.lookup) throw new Error("an announce carries the lookup tag")
    return handshakeTemplate("pair", { content: plain, created_at: opts.created_at, lookup: opts.lookup })
  }
  if (!opts.recipient || opts.ciphertext === undefined) throw new Error("pairing messages are encrypted to the other device")
  return handshakeTemplate("pair", { content: opts.ciphertext, created_at: opts.created_at, recipient: opts.recipient })
}

// The plaintext a message is encrypted from (lib/devices encrypts it with NIP-44).
export const pairingPlaintext = (message: PairingMessage) => JSON.stringify(PAIRING_MESSAGES[message.t].check(message, ""))

export const packageHash = (data: Record<string, unknown>) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(data))))

export function parsePairingEvent(event: unknown, opts: { plaintext?: string | null; now: number }): HandshakeParse<PairingMessage> {
  const parsed = parseHandshake<PairingMessage>("pair", event, PAIRING_MESSAGES, BOARD_MESSAGE_TYPES, opts)
  if (parsed.ok && parsed.message.t === "announce" && (parsed.to !== null || parsed.lookup === null)) return { ok: false, reason: "invalid_tags", detail: "an announce has a lookup tag and no recipient" }
  if (parsed.ok && parsed.message.t !== "announce" && parsed.to === null) return { ok: false, reason: "invalid_tags", detail: "message without recipient" }
  return parsed
}

// ---- Session ---------------------------------------------------------------------------------

// What each device knows about one pairing. lib/devices keeps it in IndexedDB so the flow
// survives a reload, and applies every incoming message through applyPairingMessage.
export interface PairingSession {
  role: "new" | "existing"
  sid: string
  self: string
  peer: string | null
  expires: number
  // Code path only: the key that authenticates announce and hello.
  auth?: string
  step: "waiting" | "confirm" | "transfer" | "done" | "aborted" | "expired"
  confirmedHere: boolean
  confirmedThere: boolean
  // Existing device: hash of the package it sent. New device: hash of the package it took.
  packageHash?: string
}

export function newPairingSession(opts: { role: "new" | "existing"; sid: string; self: string; peer?: string; expires: number; now: number; auth?: string }): PairingSession {
  if (opts.expires <= opts.now || opts.expires - opts.now > MAX_HANDSHAKE_SECONDS) throw new Error("expiry outside the pairing window")
  return {
    role: opts.role,
    sid: opts.sid,
    self: opts.self,
    peer: opts.peer ?? null,
    expires: opts.expires,
    ...(opts.auth ? { auth: opts.auth } : {}),
    step: opts.role === "existing" && opts.peer ? "confirm" : "waiting",
    confirmedHere: false,
    confirmedThere: false,
  }
}

export type PairingStep = { session: PairingSession; error?: { reason: Reason; detail: string } }

const fail = (session: PairingSession, reason: Reason, detail: string): PairingStep => ({ session, error: { reason, detail } })

// The person on this device confirmed the check code.
export function confirmPairingHere(session: PairingSession, now: number): PairingStep {
  if (now > session.expires) return { session: { ...session, step: "expired" } }
  if (session.step !== "confirm") return fail(session, "out_of_order", `nothing to confirm while ${session.step}`)
  const next = { ...session, confirmedHere: true }
  if (next.role === "existing" && next.confirmedThere) next.step = "transfer"
  return { session: next }
}

// Applies a message that parsePairingEvent accepted (from = its author).
export function applyPairingMessage(session: PairingSession, from: string, message: PairingMessage, now: number): PairingStep {
  if (session.step === "done" || session.step === "aborted" || session.step === "expired") return fail(session, "out_of_order", `pairing is ${session.step}`)
  if (now > session.expires) return { session: { ...session, step: "expired" } }
  if (message.sid !== session.sid) return fail(session, "session_mismatch", "another pairing")
  if (session.peer !== null && from !== session.peer) return fail(session, "session_taken", "another device already answered")

  // Only the other device ends a pairing. While the new device still waits for one, an abort
  // comes from anyone who read its announce on the relay: refused, or they could end it.
  if (message.t === "abort") return session.peer === null ? fail(session, "out_of_order", "no device answered yet") : { session: { ...session, step: "aborted" } }

  if (session.role === "new") {
    switch (message.t) {
      case "hello":
        if (session.auth && (!message.mac || message.mac !== helloMac(session.auth, from, session.self, session.sid))) return fail(session, "mac_invalid", "the code does not match")
        if (session.peer === from) return { session }
        return { session: { ...session, peer: from, step: "confirm" } }
      case "package":
        if (session.peer === null || !session.confirmedHere) return fail(session, "out_of_order", "package before confirmation")
        return { session: { ...session, step: "done", packageHash: packageHash(message.data) } }
      default:
        return fail(session, "out_of_order", `a new device does not take "${message.t}"`)
    }
  }

  switch (message.t) {
    case "accept": {
      if (session.peer === null) return fail(session, "out_of_order", "no device found yet")
      const next = { ...session, confirmedThere: true }
      if (next.confirmedHere) next.step = "transfer"
      return { session: next }
    }
    case "ack":
      if (session.step !== "transfer" || !session.packageHash) return fail(session, "out_of_order", "nothing was sent")
      if (message.hash !== session.packageHash) return fail(session, "mac_invalid", "the package arrived damaged")
      return { session: { ...session, step: "done" } }
    default:
      return fail(session, "out_of_order", `an existing device does not take "${message.t}"`)
  }
}

// Existing device: about to send the package (repeated until the ack arrives).
export function packageSent(session: PairingSession, data: Record<string, unknown>): PairingSession {
  if (session.role !== "existing" || session.step !== "transfer") throw new Error("not ready to send")
  return { ...session, packageHash: packageHash(data) }
}

// Code path, existing device: an announce found under the code's lookup tag is genuine only
// when its MAC matches; then it yields the new device's key and session.
export function checkAnnounce(from: string, message: PairingMessage, auth: string, now: number): { ok: true; sid: string; expires: number } | { ok: false; reason: Reason } {
  if (message.t !== "announce") return { ok: false, reason: "out_of_order" }
  if (message.exp <= now || message.exp - now > MAX_HANDSHAKE_SECONDS) return { ok: false, reason: "expired_message" }
  if (message.mac !== announceMac(auth, from, message.sid, message.exp)) return { ok: false, reason: "mac_invalid" }
  return { ok: true, sid: message.sid, expires: message.exp }
}
