import type { EventTemplate } from "../nostr/types.ts"
import type { HandshakeParse } from "./handshake.ts"
import { handshakeTemplate, parseHandshake } from "./handshake.ts"
import { MAX_BOARD_CODE_SECONDS } from "./kinds.ts"
import type { LinkPayload } from "./links.ts"
import { decodeLinkPayload, encodeLinkPayload } from "./links.ts"
import type { Reason } from "./reasons.ts"
import type { Infer } from "./schema.ts"
import { alias } from "./common.ts"
import { bool, hex, int, nullable, obj, oneOf, opt } from "./schema.ts"

// Joining a shared board (docs/protocol/families/board-join.md). The board shows a QR with a
// one-time pubkey for this match setup; a player scans it with their own phone and asks for a
// seat with a message signed by their profile and encrypted to the board. The board answers
// with the seat. Nothing in this flow can carry a key: the messages are strict, and pairing
// messages are refused as "wrong_flow". The player's profile key and wallet stay on the phone.

export type BoardLink = Extract<LinkPayload, { type: "board" }>

export const encodeBoardLink = (p: Omit<BoardLink, "type">) => encodeLinkPayload({ type: "board", ...p })
// Refuses pairing and every other code with "wrong_flow".
export const decodeBoardLink = (text: string): BoardLink => decodeLinkPayload("board", text)

const sid = () => hex(16, "Session id of the board QR")

export const BOARD_MESSAGES = {
  join: obj(
    {
      t: oneOf(["join"]),
      sid: sid(),
      seat: nullable(int(0, 5, "Requested seat; null = any free seat")),
      alias: opt(alias()),
      confirm: bool("The player wants to confirm the result from the phone"),
    },
    { strict: true },
  ),
  seat: obj({ t: oneOf(["seat"]), sid: sid(), seat: int(0, 5), match: opt(hex(32, "Match id once the match has started")) }, { strict: true }),
  decline: obj({ t: oneOf(["decline"]), sid: sid(), reason: oneOf(["full", "taken", "expired", "declined"]) }, { strict: true }),
  leave: obj({ t: oneOf(["leave"]), sid: sid() }, { strict: true }),
}

export type BoardMessage = { [K in keyof typeof BOARD_MESSAGES]: Infer<(typeof BOARD_MESSAGES)[K]> }[keyof typeof BOARD_MESSAGES]

const PAIRING_MESSAGE_TYPES = ["announce", "hello", "accept", "package", "ack", "abort"] as const

export const boardPlaintext = (message: BoardMessage) => JSON.stringify(BOARD_MESSAGES[message.t].check(message, ""))

export const boardTemplate = (opts: { recipient: string; ciphertext: string; created_at: number }): EventTemplate =>
  handshakeTemplate("board", { content: opts.ciphertext, created_at: opts.created_at, recipient: opts.recipient })

export function parseBoardEvent(event: unknown, opts: { plaintext?: string | null; now: number }): HandshakeParse<BoardMessage> {
  const parsed = parseHandshake<BoardMessage>("board", event, BOARD_MESSAGES, PAIRING_MESSAGE_TYPES, opts)
  if (parsed.ok && parsed.to === null) return { ok: false, reason: "invalid_tags", detail: "message without recipient" }
  return parsed
}

// Board side: whether a parsed join may take a seat. `seats` maps seat → pubkey already there.
export function checkJoin(
  join: Extract<BoardMessage, { t: "join" }>,
  ctx: { from: string; sid: string; expires: number; now: number; seats: (string | null)[] },
): { ok: true; seat: number } | { ok: false; reason: Reason; detail: string } {
  if (join.sid !== ctx.sid) return { ok: false, reason: "session_mismatch", detail: "another board session" }
  if (ctx.now > ctx.expires || ctx.expires - ctx.now > MAX_BOARD_CODE_SECONDS) return { ok: false, reason: "expired_message", detail: "the board code has expired" }
  if (ctx.seats.includes(ctx.from)) return { ok: true, seat: ctx.seats.indexOf(ctx.from) }
  const seat = join.seat ?? ctx.seats.findIndex((s) => s === null)
  if (seat < 0 || seat >= ctx.seats.length) return { ok: false, reason: "no_free_seat", detail: "no free seat" }
  if (ctx.seats[seat] !== null) return { ok: false, reason: "session_taken", detail: "seat taken" }
  return { ok: true, seat }
}
