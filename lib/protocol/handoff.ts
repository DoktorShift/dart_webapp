import type { EventTemplate } from "../nostr/types.ts"
import type { HandshakeParse } from "./handshake.ts"
import { handshakeTemplate, parseHandshake } from "./handshake.ts"
import { MAX_SEALED_PLAINTEXT_BYTES } from "./kinds.ts"
import type { LinkPayload } from "./links.ts"
import { decodeLinkPayload, encodeLinkPayload } from "./links.ts"
import type { Infer } from "./schema.ts"
import { anyObject, hex, obj, oneOf } from "./schema.ts"

// Handing a running match to another device (docs/protocol/families/session-authorization.md,
// "Schreiberwechsel"). The writing device shows a QR or link with a one-time pubkey, a session id
// and an expiry (at most MAX_HANDSHAKE_SECONDS); the other device opens it and asks to take
// over ("take"). Both show the check code of the two one-time keys and the session id
// (pairingCheckCode). Only when the person at the writing device confirms does the match travel
// ("game": the match authority's key, the match key and the game itself, lib/live's package),
// and only the new device's acknowledgement with the package hash ("done") makes the old device
// stop writing. The new device then hands the match to a session key of its own (sv + 1).
// Every message is NIP-44 between the one-time keys and names the session id. A board code
// (B1) never starts this flow: its links and messages are "wrong_flow" here.

export type HandoffLink = Extract<LinkPayload, { type: "handoff" }>

export const encodeHandoffLink = (p: Omit<HandoffLink, "type">) => encodeLinkPayload({ type: "handoff", ...p })
// Refuses board, pairing and every other code with "wrong_flow".
export const decodeHandoffLink = (text: string): HandoffLink => decodeLinkPayload("handoff", text)

const sid = () => hex(16, "Session id of the handoff code")

// One NIP-44 layer: the package fits one event with its envelope.
export const MAX_HANDOFF_PACKAGE_BYTES = MAX_SEALED_PLAINTEXT_BYTES - 200

export const HANDOFF_MESSAGES = {
  take: obj({ t: oneOf(["take"]), sid: sid() }, { strict: true }),
  game: obj({ t: oneOf(["game"]), sid: sid(), data: anyObject(MAX_HANDOFF_PACKAGE_BYTES, "The match package (lib/live)") }, { strict: true }),
  done: obj({ t: oneOf(["done"]), sid: sid(), hash: hex(32, "sha256 of the package data as sent (pairing.ts packageHash)") }, { strict: true }),
  abort: obj({ t: oneOf(["abort"]), sid: sid(), reason: oneOf(["declined", "expired", "error"]) }, { strict: true }),
}

export type HandoffMessage = { [K in keyof typeof HANDOFF_MESSAGES]: Infer<(typeof HANDOFF_MESSAGES)[K]> }[keyof typeof HANDOFF_MESSAGES]

// Pairing and board messages: in the handoff flow they are "wrong_flow", whatever their label.
const OTHER_FLOWS = ["announce", "hello", "accept", "package", "ack", "look", "table", "join", "seat", "decline", "leave"] as const

export const handoffPlaintext = (message: HandoffMessage) => JSON.stringify(HANDOFF_MESSAGES[message.t].check(message, ""))

export const handoffTemplate = (opts: { recipient: string; ciphertext: string; created_at: number }): EventTemplate =>
  handshakeTemplate("handoff", { content: opts.ciphertext, created_at: opts.created_at, recipient: opts.recipient })

export function parseHandoffEvent(event: unknown, opts: { plaintext?: string | null; now: number }): HandshakeParse<HandoffMessage> {
  const parsed = parseHandshake<HandoffMessage>("handoff", event, HANDOFF_MESSAGES, OTHER_FLOWS, opts)
  if (parsed.ok && parsed.to === null) return { ok: false, reason: "invalid_tags", detail: "message without recipient" }
  return parsed
}
