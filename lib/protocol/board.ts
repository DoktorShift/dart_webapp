import type { EventTemplate } from "../nostr/types.ts"
import type { HandshakeParse } from "./handshake.ts"
import { handshakeTemplate, parseHandshake } from "./handshake.ts"
import { FORMAT_VERSION, KIND_EPHEMERAL, LABEL_NAMESPACE, MAX_BOARD_CODE_SECONDS, MAX_FUTURE_SKEW_SECONDS } from "./kinds.ts"
import type { LinkPayload } from "./links.ts"
import { decodeLinkPayload, encodeLinkPayload } from "./links.ts"
import type { Reason } from "./reasons.ts"
import type { Infer } from "./schema.ts"
import { alias, embeddedEvent, matchRules } from "./common.ts"
import { arr, bool, hex, int, nullable, obj, oneOf, opt } from "./schema.ts"
import type { SignedEvent } from "./tags.ts"
import { readLabels } from "./tags.ts"

// Joining a shared board (docs/protocol/families/board-join.md). The board shows a QR with a
// one-time pubkey for this match; a player scans it with their own phone, looks at the match and
// its seats, and asks for one. The phone talks to the board with a one-time key of its own,
// NIP-44 both ways; a player with a profile adds the profile's signed claim on that key, so the
// profile only ever signs, never encrypts (an Android signer can't). The board answers with the
// seat and, for a private match, the match key to follow and confirm it. Nothing in this flow
// can carry a profile key: the messages are strict, and pairing messages are refused as
// "wrong_flow". The player's profile key and wallet stay on the phone.

export type BoardLink = Extract<LinkPayload, { type: "board" }>

export const encodeBoardLink = (p: Omit<BoardLink, "type">) => encodeLinkPayload({ type: "board", ...p })
// Refuses pairing and every other code with "wrong_flow".
export const decodeBoardLink = (text: string): BoardLink => decodeLinkPayload("board", text)

const sid = () => hex(16, "Session id of the board QR")

export const BOARD_MESSAGES = {
  look: obj({ t: oneOf(["look"]), sid: sid() }, { strict: true }),
  table: obj(
    {
      t: oneOf(["table"]),
      sid: sid(),
      match: hex(32, "Match id"),
      rules: matchRules,
      seats: arr(obj({ alias: alias(), taken: bool("A player's phone is connected to this seat") }, { strict: true }), { min: 1, max: 6 }),
    },
    { strict: true },
  ),
  join: obj(
    {
      t: oneOf(["join"]),
      sid: sid(),
      seat: nullable(int(0, 5, "Requested seat; null = any free seat")),
      alias: opt(alias()),
      confirm: bool("The player wants to confirm the result from the phone"),
      profile: opt(embeddedEvent),
    },
    { strict: true },
  ),
  seat: obj(
    {
      t: oneOf(["seat"]),
      sid: sid(),
      seat: int(0, 5),
      match: opt(hex(32, "Match id once the match has started")),
      key: opt(hex(32, "Match key of a private match: to follow the match and confirm its result")),
    },
    { strict: true },
  ),
  decline: obj({ t: oneOf(["decline"]), sid: sid(), reason: oneOf(["full", "taken", "expired", "declined"]) }, { strict: true }),
  leave: obj({ t: oneOf(["leave"]), sid: sid() }, { strict: true }),
}

export type BoardMessage = { [K in keyof typeof BOARD_MESSAGES]: Infer<(typeof BOARD_MESSAGES)[K]> }[keyof typeof BOARD_MESSAGES]

// Pairing and handoff messages: in the board flow they are "wrong_flow", whatever their label.
const OTHER_FLOWS = ["announce", "hello", "accept", "package", "ack", "abort", "take", "game", "done"] as const

export const boardPlaintext = (message: BoardMessage) => JSON.stringify(BOARD_MESSAGES[message.t].check(message, ""))

export const boardTemplate = (opts: { recipient: string; ciphertext: string; created_at: number }): EventTemplate =>
  handshakeTemplate("board", { content: opts.ciphertext, created_at: opts.created_at, recipient: opts.recipient })

export function parseBoardEvent(event: unknown, opts: { plaintext?: string | null; now: number }): HandshakeParse<BoardMessage> {
  const parsed = parseHandshake<BoardMessage>("board", event, BOARD_MESSAGES, OTHER_FLOWS, opts)
  if (parsed.ok && parsed.to === null) return { ok: false, reason: "invalid_tags", detail: "message without recipient" }
  return parsed
}

// ---- Profile claim ----------------------------------------------------------------------------

// A player with a profile proves it without the profile ever encrypting: the profile signs this
// claim on the phone's one-time key, and the join carries it ("profile"). Never published; it
// names the board's key and code, so it is worthless at another board or for another phone key.
const claimContent = obj({ t: oneOf(["claim"]), sid: sid(), board: hex(32, "The board's one-time key"), key: hex(32, "The phone's one-time key") }, { strict: true })

export function claimTemplate(opts: { board: string; sid: string; key: string; created_at: number }): EventTemplate {
  const content = JSON.stringify(claimContent.check({ t: "claim", sid: opts.sid, board: opts.board, key: opts.key }, ""))
  return handshakeTemplate("board", { content, created_at: opts.created_at })
}

// Board side: the profile a join speaks for, from its claim. The signature is lib/nostr's to
// check before this runs, like every event's.
export function checkClaim(
  claim: SignedEvent,
  ctx: { board: string; sid: string; from: string; now: number },
): { ok: true; pubkey: string } | { ok: false; reason: Reason; detail: string } {
  const no = (reason: Reason, detail: string) => ({ ok: false as const, reason, detail })
  if (claim.kind !== KIND_EPHEMERAL) return no("wrong_kind", `kind ${claim.kind}`)
  const labels = readLabels(claim.tags)
  if (!labels || labels.type !== "board" || labels.version !== FORMAT_VERSION) return no("invalid_tags", `not a ${LABEL_NAMESPACE} board claim`)
  if (claim.created_at > ctx.now + MAX_FUTURE_SKEW_SECONDS) return no("future_timestamp", "dated in the future")
  if (claim.created_at < ctx.now - MAX_BOARD_CODE_SECONDS) return no("expired_message", "older than any board code")
  let content: Infer<typeof claimContent>
  try {
    content = claimContent.check(JSON.parse(claim.content), "")
  } catch {
    return no("invalid_content", "not a claim")
  }
  if (content.sid !== ctx.sid || content.board !== ctx.board) return no("session_mismatch", "a claim for another board code")
  if (content.key !== ctx.from) return no("not_authorized", "a claim for another phone")
  return { ok: true, pubkey: claim.pubkey }
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
