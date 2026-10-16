import { openChannel, repeat, type Channel } from "../nostr/channel.ts"
import { nowSeconds, syncClock } from "../nostr/time.ts"
import type { Signer } from "../nostr/types.ts"
import type { BoardLink, BoardMessage } from "../protocol/board.ts"
import { claimTemplate } from "../protocol/board.ts"
import type { MatchStateP } from "../protocol/match-state.ts"
import { buildRecord } from "../protocol/records.ts"
import { createdAtAfter, type SignedEvent } from "../protocol/tags.ts"
import { deliverNow, enqueue } from "../sync/outbox.ts"
import { keepCopy, resultPlayed } from "./copy.ts"
import type { MatchSource } from "./follow.ts"
import { fromHex, keyOf, newKey, sealToMatch, toHex, type MatchKey } from "./keys.ts"
import { BOARD_FLOW } from "./seating.ts"
import { dropJoined, loadJoined, openKeys, saveJoined, sealKeys, type JoinedRecord, type JoinedSecrets } from "./store.ts"

// The phone side of "Am Board mitspielen" (docs/protocol/families/board-join.md): look at the
// board's match and seats, take a seat as a guest or with the profile, and later give the seat's
// verdict on the result. The phone talks to the board through a one-time key; the profile only
// signs (a claim on that key, later a verdict). A guest's seat belongs to a key this phone made
// for the match and keeps, so the guest can come back to the same seat and confirm too. Whether
// a remembered seat is still this phone's only the match says (holdsSeat): the board's `taken`
// tells that someone holds it, not who.

export type BoardSeats = Extract<BoardMessage, { t: "table" }>

export type BoardVisit =
  | { step: "looking" }
  // `declined`: why the last join didn't work. `freed`: the remembered seat is no longer this
  // phone's, so it is up for choosing again.
  | { step: "table"; table: BoardSeats; declined?: "full" | "taken" | "expired" | "declined"; freed?: true }
  | { step: "joining"; table: BoardSeats; seat: number }
  // `restored`: the seat comes from this phone's memory, not from an answer of the board just
  // now; whether it still holds, the match has to show.
  | { step: "seated"; joined: JoinedMatch; restored: boolean }
  // The board didn't answer (switched off, another network, the code ran out meanwhile).
  | { step: "silent" }
  | { step: "expired" }

// A seat this phone holds in a match.
export interface JoinedMatch {
  match: string
  relays: string[]
  seat: number
  profile: string | null
  // The match key of a private match.
  key: MatchKey | null
  // A guest's key for this match; null with a profile.
  guest: MatchKey | null
  archived: string | null
}

// How long an unanswered look or join keeps being repeated. A board that is online answers
// within a second or two; what is left is a board that is off, elsewhere, or past the code.
const ANSWER_WAIT_MS = 10_000

export interface BoardVisitControl {
  // `profile`: the signed-in profile's signer; null joins as a guest.
  join: (seat: number, profile: Signer | null) => Promise<void>
  // Gives the seat back (a wrong seat chosen) and looks at the seats again. A profile signs a
  // claim for it, as it did to join; a guest's own key for the match sends it.
  leave: (profile: Signer | null) => Promise<void>
  // The seat is no longer this phone's (forgetSeat), and the seats are looked at again.
  forget: () => Promise<void>
  close: () => void
}

// Seats lost while the app runs (the board freed them, someone else took them), by match: the
// seats say so once, when the board's code is opened next.
const lostSeats = new Set<string>()

// The seat is no longer this phone's: forgets it, and keeps the reason for the next visit.
export async function forgetSeat(match: string) {
  lostSeats.add(match)
  await dropJoined(match).catch(() => {})
}

export function visitBoard(link: BoardLink, onChange: (visit: BoardVisit) => void): BoardVisitControl {
  let channel: Channel<BoardMessage> | null = null
  let stopSending: (() => void) | null = null
  let waiting: ReturnType<typeof setTimeout> | undefined
  let table: BoardSeats | null = null
  let pending: { seat: number; profile: string | null } | null = null
  let seated: JoinedMatch | null = null
  // A seat just given back: not taken up again from memory; forgotten once the board shows it free.
  let left: JoinedMatch | null = null
  let declined: Extract<BoardMessage, { t: "decline" }>["reason"] | undefined
  let closed = false

  const set = (visit: BoardVisit) => {
    if (!closed) onChange(visit)
  }
  const stop = () => {
    stopSending?.()
    stopSending = null
    clearTimeout(waiting)
  }
  // Sends until the board answers, or says it stayed silent.
  const ask = (send: (to: Channel<BoardMessage>) => Promise<unknown>) => {
    stop()
    const current = channel
    if (!current) return
    stopSending = repeat(() => send(current))
    waiting = setTimeout(() => {
      stop()
      set({ step: "silent" })
    }, ANSWER_WAIT_MS)
  }
  const look = (to: Channel<BoardMessage>) => to.send(link.pubkey, { t: "look", sid: link.sid })

  function talkWith(key: MatchKey) {
    if (channel?.key.pubkey === key.pubkey) return
    channel?.close()
    channel = openChannel(BOARD_FLOW, key, link.relays, (message) => void answer(message))
  }

  // The profile's claim on the phone's current key, for a join or a leave.
  const claimWith = (profile: Signer, to: Channel<BoardMessage>) =>
    profile.signEvent(claimTemplate({ board: link.pubkey, sid: link.sid, key: to.key.pubkey, created_at: nowSeconds() }))

  async function answer(message: BoardMessage) {
    if (message.sid !== link.sid || closed) return
    if (message.t === "table" && !pending && !seated) {
      stop()
      table = message
      // This phone sat here before (a fresh code, a reload) and someone still holds the seat:
      // back to it for now; the match shows whether it is really this phone's.
      const known = left ? null : await loadSeat(message.match)
      if (known && message.seats[known.seat]?.taken) {
        seated = known
        return set({ step: "seated", joined: known, restored: true })
      }
      if (known) await dropJoined(known.match).catch(() => {})
      if (left) {
        // The leave reached the board: the key that held the seat is no longer needed.
        if (!message.seats[left.seat]?.taken) await dropJoined(left.match).catch(() => {})
        left = null
      }
      const freed = lostSeats.delete(message.match)
      set({ step: "table", table, ...(declined ? { declined } : {}), ...(freed ? { freed } : {}) })
    } else if (message.t === "seat" && pending && table) {
      stop()
      const key = message.key ? await keyOf(fromHex(message.key)) : null
      const guest = pending.profile ? null : (channel?.key ?? null)
      seated = await rememberJoined({ match: table.match, relays: link.relays, seat: message.seat, profile: pending.profile, key, guest, archived: null }, table)
      pending = null
      left = null
      set({ step: "seated", joined: seated, restored: false })
    } else if (message.t === "decline" && pending) {
      // The seats changed meanwhile: look again, and say why this one didn't work.
      pending = null
      declined = message.reason
      ask(look)
    }
  }

  // Verdicts and seats are dated by this device's clock: set it by the app's server first.
  void syncClock()
  if (link.expires <= nowSeconds()) set({ step: "expired" })
  else
    void newKey().then((key) => {
      talkWith(key)
      set({ step: "looking" })
      ask(look)
    })

  return {
    async join(seat, profile) {
      const shown = table
      if (!shown) return
      set({ step: "joining", table: shown, seat })
      // A guest comes back to the seat with the key that holds it; a profile with a fresh claim.
      const known = profile ? null : await loadJoined(shown.match).catch(() => null)
      const guestKey = known && !known.profile ? (await openKeys<JoinedSecrets>(known.keys))?.guest : undefined
      if (guestKey) talkWith(await keyOf(fromHex(guestKey)))
      const current = channel
      if (!current) return
      let claim: SignedEvent | undefined
      try {
        claim = profile ? await claimWith(profile, current) : undefined
      } catch (error) {
        // Refused or not reached in the signer: the seats stay as they were.
        set({ step: "table", table: shown })
        throw error
      }
      pending = { seat, profile: claim?.pubkey ?? null }
      declined = undefined
      const message: BoardMessage = { t: "join", sid: link.sid, seat, confirm: true, ...(claim ? { profile: claim } : {}) }
      ask((to) => to.send(link.pubkey, message))
    },
    async leave(profile) {
      const seat = seated
      if (!seat) return
      // The seat goes back from the key that holds it. No answer comes to a leave: the look
      // right after it shows whether it arrived, and both go again until the board answers.
      if (seat.guest) talkWith(seat.guest)
      const current = channel
      if (!current) return
      const claim = seat.profile && profile ? await claimWith(profile, current) : undefined
      const message: BoardMessage = { t: "leave", sid: link.sid, ...(claim ? { profile: claim } : {}) }
      left = seat
      seated = null
      set({ step: "looking" })
      ask((to) => to.send(link.pubkey, message).then(() => look(to)))
    },
    async forget() {
      const seat = seated
      if (!seat) return
      await forgetSeat(seat.match)
      seated = null
      set({ step: "looking" })
      ask(look)
    },
    close() {
      closed = true
      stop()
      channel?.close()
    },
  }
}

// Keeps the seat for coming back to it (and, as a guest, its key) with the game as the board
// offered it; what this device put into its own games of the match stays known.
async function rememberJoined(joined: JoinedMatch, table: BoardSeats): Promise<JoinedMatch> {
  const secrets: JoinedSecrets = { ...(joined.key ? { match: toHex(joined.key.secret) } : {}), ...(joined.guest ? { guest: toHex(joined.guest.secret) } : {}) }
  const archived = (await loadJoined(joined.match).catch(() => null))?.archived ?? null
  const { match, relays, seat, profile } = joined
  const game = { at: Date.now(), rules: table.rules, aliases: table.seats.map((s) => s.alias) }
  await saveJoined({ match, relays, seat, profile, ...game, keys: await sealKeys(secrets), archived }).catch(() => {})
  return { ...joined, archived }
}

// A seat this phone joined before, with its keys, or null.
export async function loadSeat(match: string): Promise<JoinedMatch | null> {
  const record = await loadJoined(match).catch(() => null)
  if (!record) return null
  const secrets = await openKeys<JoinedSecrets>(record.keys)
  if (!secrets) return null
  return {
    match: record.match,
    relays: record.relays,
    seat: record.seat,
    profile: record.profile,
    key: secrets.match ? await keyOf(fromHex(secrets.match)) : null,
    guest: secrets.guest ? await keyOf(fromHex(secrets.guest)) : null,
    archived: record.archived,
  }
}

// The key the seat belongs to on this phone: the profile's, or the guest key's.
const seatKey = (joined: JoinedMatch) => joined.profile ?? joined.guest?.pubkey ?? null

// Whether the match, as replayed, has this phone's key on the seat.
export const holdsSeat = (joined: JoinedMatch, state: MatchStateP) => state.seats[joined.seat]?.pubkey === seatKey(joined)

// Where to follow the match from this seat (components/live/match-view.tsx useFollowed).
export const seatSource = (joined: JoinedMatch): MatchSource => ({ match: joined.match, relays: joined.relays, key: joined.key ? toHex(joined.key.secret) : null })

// ---- The verdict ---------------------------------------------------------------------------

// This phone's verdict on the current result: the seat's verdict, when it was given from this
// phone's key. It lapses with a correction or a withdrawal (reduceMatch drops the verdicts of a
// replaced result), or once the seat's next holder gives their own; the board freeing the seat
// afterwards changes nothing about the result the player confirmed.
export const ownVerdict = (joined: JoinedMatch, state: MatchStateP) => {
  const given = state.confirmations[joined.seat]
  return given?.pubkey === seatKey(joined) ? given : null
}

// The seat's verdict on the current result, signed by the profile (`profile`) or the guest's key.
// Dated after the result and the seat it rests on, whatever this device's clock says, so every
// reader replays it after them. True once a relay has it; otherwise the outbox (lib/sync) keeps
// trying, and the match shows the verdict once it lands.
export async function giveVerdict(joined: JoinedMatch, state: MatchStateP, verdict: "confirm" | "dispute", profile: Signer | null): Promise<boolean> {
  const signer = profile ?? joined.guest?.signer
  const result = state.result
  if (!signer || !result) throw new Error("no result to give a verdict on")
  const author = await signer.getPublicKey()
  const at = createdAtAfter(nowSeconds(), result.at, state.seats[joined.seat]?.since ?? 0)
  const template = buildRecord("match.confirm", { result: result.event, verdict, seat: joined.seat }, { created_at: at, root: joined.match })
  const event = await signer.signEvent(joined.key ? await sealToMatch(template, author, joined.key) : template)
  await enqueue([{ event, relays: joined.relays }], { rule: "any" })
  const [status] = await deliverNow([event.id])
  return status?.state === "delivered"
}

// The player's own games follow the result they confirmed (copy.ts): in them once confirmed, out
// again when that result is corrected or withdrawn, until they confirm the new one.
export async function keepConfirmed(joined: JoinedMatch, state: MatchStateP): Promise<JoinedMatch> {
  const record = state.result && ownVerdict(joined, state)?.verdict === "confirm" ? state.result.event : null
  const archived = await keepCopy(joined.archived, { match: joined.match, record, played: () => resultPlayed(state, joined.seat, joined.profile) })
  if (archived === joined.archived) return joined
  const stored = await loadJoined(joined.match).catch(() => null)
  if (stored) await saveJoined({ ...stored, archived } satisfies Omit<JoinedRecord, "id">).catch(() => {})
  return { ...joined, archived }
}
