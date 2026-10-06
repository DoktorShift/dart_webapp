import { loadCore } from "../nostr/core.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { BoardMessage } from "../protocol/board.ts"
import { boardPlaintext, boardTemplate, checkClaim, checkJoin, encodeBoardLink, parseBoardEvent } from "../protocol/board.ts"
import { MAX_BOARD_CODE_SECONDS } from "../protocol/kinds.ts"
import type { SeatHolder } from "../protocol/match-state.ts"
import type { Reason } from "../protocol/reasons.ts"
import { seatInfo, seatPlayer } from "./board.ts"
import { openChannel, type ChannelFlow } from "./channel.ts"
import { newKey, toHex } from "./keys.ts"

// The board side of "Spieler verbinden" (docs/protocol/families/board-join.md): a board code
// with a one-time key, answered for as long as it is valid. A phone looks at the seats, then
// asks for one as a guest or with its profile's claim; the board gives the seat (match.seat)
// and the match key, or says why not. No one here confirms anything: the seat is the player's
// own choice, and the board can free it again.

export const BOARD_FLOW: ChannelFlow<BoardMessage> = { plaintext: boardPlaintext, template: boardTemplate, parse: parseBoardEvent }

export interface Seating {
  // The board code's payload (B1…) and when it runs out (unix seconds).
  code: string
  expires: number
  close: () => void
}

export async function openSeating(local: string): Promise<Seating> {
  const info = seatInfo(local)
  if (!info) throw new Error("the match is not live here")
  const key = await newKey()
  const sid = toHex(crypto.getRandomValues(new Uint8Array(16)))
  const expires = nowSeconds() + MAX_BOARD_CODE_SECONDS
  // The seat each phone (by its one-time key) got from this code, for its "leave".
  const phones = new Map<string, number>()
  // One message at a time: two phones asking for the same seat at once get it in turn.
  let answering: Promise<unknown> = Promise.resolve()
  const channel = openChannel(BOARD_FLOW, key, info.relays, (message, from) => {
    answering = answering.then(() => answer(message, from)).catch(() => {})
  })

  async function answer(message: BoardMessage, from: string) {
    const now = nowSeconds()
    const current = seatInfo(local)
    if (!current || message.sid !== sid) return
    if (now > expires) return channel.send(from, { t: "decline", sid, reason: "expired" })
    if (message.t === "look") {
      const seats = current.aliases.map((alias, i) => ({ alias, taken: current.holders[i] !== null }))
      return channel.send(from, { t: "table", sid, match: current.match, rules: current.rules, seats })
    }
    if (message.t === "leave") {
      const seat = phones.get(from)
      if (seat !== undefined && current.holders[seat]) await seatPlayer(local, seat, null)
      phones.delete(from)
      return
    }
    if (message.t !== "join") return
    const holder = await holderOf(message, from, { board: key.pubkey, sid, now })
    if (!holder) return channel.send(from, { t: "decline", sid, reason: "declined" })
    const verdict = checkJoin(message, { from: holder.pubkey, sid, expires, now, seats: current.holders.map((h) => h?.pubkey ?? null) })
    if (!verdict.ok) return channel.send(from, { t: "decline", sid, reason: DECLINE[verdict.reason] ?? "declined" })
    if (current.holders[verdict.seat]?.pubkey !== holder.pubkey) await seatPlayer(local, verdict.seat, holder)
    phones.set(from, verdict.seat)
    return channel.send(from, { t: "seat", sid, seat: verdict.seat, match: current.match, key: current.key })
  }

  return { code: encodeBoardLink({ pubkey: key.pubkey, sid, expires, relays: info.relays }), expires, close: channel.close }
}

const DECLINE: Partial<Record<Reason, "full" | "taken" | "expired">> = { no_free_seat: "full", session_taken: "taken", expired_message: "expired" }

// Who a join speaks for: the profile whose signed claim it carries, or else the phone's own key
// (a guest). A claim that doesn't hold up gets the join declined.
async function holderOf(join: Extract<BoardMessage, { t: "join" }>, from: string, ctx: { board: string; sid: string; now: number }): Promise<SeatHolder | null> {
  if (!join.profile) return { pubkey: from, profile: false }
  const core = await loadCore()
  if (!core.verifyEventSignature(join.profile)) return null
  const claim = checkClaim(join.profile, { ...ctx, from })
  return claim.ok ? { pubkey: claim.pubkey, profile: true } : null
}
