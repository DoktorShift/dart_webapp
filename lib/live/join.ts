import { publish } from "../nostr/client.ts"
import { nowSeconds, syncClock } from "../nostr/time.ts"
import type { Signer } from "../nostr/types.ts"
import type { BoardLink, BoardMessage } from "../protocol/board.ts"
import { claimTemplate } from "../protocol/board.ts"
import { assembleChunks } from "../protocol/chunks.ts"
import type { Agreement } from "../protocol/match.ts"
import type { MatchResultEntry, MatchStateP } from "../protocol/match-state.ts"
import { buildRecord } from "../protocol/records.ts"
import { createdAtAfter, type SignedEvent } from "../protocol/tags.ts"
import { archiveFinished, unarchive } from "../storage/archive.ts"
import { listPlayers } from "../storage/players.ts"
import { openChannel, repeat, REPEAT_MS, type Channel } from "./channel.ts"
import { resultGame } from "./content.ts"
import { fromHex, keyOf, newKey, sealToMatch, toHex, type MatchKey } from "./keys.ts"
import { BOARD_FLOW } from "./seating.ts"
import { dropJoined, loadJoined, openKeys, saveJoined, sealKeys, type JoinedRecord, type JoinedSecrets } from "./store.ts"

// The phone side of "Am Board mitspielen" (docs/protocol/families/board-join.md): look at the
// board's match and seats, take a seat as a guest or with the profile, and later give the seat's
// verdict on the result. The phone talks to the board through a one-time key; the profile only
// signs (a claim on that key, later a verdict). A guest's seat belongs to a key this phone made
// for the match and keeps, so the guest can come back to the same seat and confirm too.

export type BoardSeats = Extract<BoardMessage, { t: "table" }>

export type BoardVisit =
  | { step: "looking" }
  | { step: "table"; table: BoardSeats; declined?: "full" | "taken" | "expired" | "declined" }
  | { step: "joining"; table: BoardSeats; seat: number }
  | { step: "seated"; joined: JoinedMatch }
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

// How long an unanswered look or join keeps being repeated.
const ANSWER_WAIT_MS = 20_000

export interface BoardVisitControl {
  // `profile`: the signed-in profile's signer; null joins as a guest.
  join: (seat: number, profile: Signer | null) => Promise<void>
  // Gives the seat back (a wrong seat chosen) and looks at the seats again.
  leave: () => Promise<void>
  close: () => void
}

export function visitBoard(link: BoardLink, onChange: (visit: BoardVisit) => void): BoardVisitControl {
  let channel: Channel<BoardMessage> | null = null
  let stopSending: (() => void) | null = null
  let waiting: ReturnType<typeof setTimeout> | undefined
  let table: BoardSeats | null = null
  let pending: { seat: number; profile: string | null } | null = null
  let seated: JoinedMatch | null = null
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
  const ask = (message: BoardMessage) => {
    stop()
    const current = channel
    if (!current) return
    stopSending = repeat(() => current.send(link.pubkey, message))
    waiting = setTimeout(() => {
      stop()
      set({ step: "silent" })
    }, ANSWER_WAIT_MS)
  }

  function talkWith(key: MatchKey) {
    if (channel?.key.pubkey === key.pubkey) return
    channel?.close()
    channel = openChannel(BOARD_FLOW, key, link.relays, (message) => void answer(message))
  }

  async function answer(message: BoardMessage) {
    if (message.sid !== link.sid || closed) return
    if (message.t === "table" && !pending && !seated) {
      stop()
      table = message
      set({ step: "table", table, ...(declined ? { declined } : {}) })
    } else if (message.t === "seat" && pending && table) {
      stop()
      const key = message.key ? await keyOf(fromHex(message.key)) : null
      const guest = pending.profile ? null : (channel?.key ?? null)
      seated = await rememberJoined({ match: table.match, relays: link.relays, seat: message.seat, profile: pending.profile, key, guest, archived: null })
      pending = null
      set({ step: "seated", joined: seated })
    } else if (message.t === "decline" && pending) {
      // The seats changed meanwhile: look again, and say why this one didn't work.
      pending = null
      declined = message.reason
      ask({ t: "look", sid: link.sid })
    }
  }

  // Verdicts and seats are dated by this device's clock: set it by the app's server first.
  void syncClock()
  if (link.expires <= nowSeconds()) set({ step: "expired" })
  else
    void newKey().then((key) => {
      talkWith(key)
      set({ step: "looking" })
      ask({ t: "look", sid: link.sid })
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
      if (!channel) return
      let claim: SignedEvent | undefined
      try {
        claim = profile ? await profile.signEvent(claimTemplate({ board: link.pubkey, sid: link.sid, key: channel.key.pubkey, created_at: nowSeconds() })) : undefined
      } catch (error) {
        // Refused or not reached in the signer: the seats stay as they were.
        set({ step: "table", table: shown })
        throw error
      }
      pending = { seat, profile: claim?.pubkey ?? null }
      declined = undefined
      ask({ t: "join", sid: link.sid, seat, confirm: true, ...(claim ? { profile: claim } : {}) })
    },
    async leave() {
      const current = channel
      if (!seated || !current) return
      // No answer comes to a leave; a second copy covers one lost on the way.
      await current.send(link.pubkey, { t: "leave", sid: link.sid }).catch(() => {})
      setTimeout(() => void current.send(link.pubkey, { t: "leave", sid: link.sid }).catch(() => {}), REPEAT_MS)
      await dropJoined(seated.match).catch(() => {})
      seated = null
      set({ step: "looking" })
      ask({ t: "look", sid: link.sid })
    },
    close() {
      closed = true
      stop()
      channel?.close()
    },
  }
}

// Keeps the seat for coming back to it (and, as a guest, its key); what this device put into its
// own games of the match stays known.
async function rememberJoined(joined: JoinedMatch): Promise<JoinedMatch> {
  const secrets: JoinedSecrets = { ...(joined.key ? { match: toHex(joined.key.secret) } : {}), ...(joined.guest ? { guest: toHex(joined.guest.secret) } : {}) }
  const archived = (await loadJoined(joined.match).catch(() => null))?.archived ?? null
  await saveJoined({ match: joined.match, relays: joined.relays, seat: joined.seat, profile: joined.profile, keys: await sealKeys(secrets), archived }).catch(() => {})
  return { ...joined, archived }
}

// A seat this phone joined before, with its keys, or null.
export async function joinedMatch(match: string): Promise<JoinedMatch | null> {
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

// ---- The verdict ---------------------------------------------------------------------------

// The seat's verdict on the current result, signed by the profile (`profile`) or the guest's key.
// Dated after the result and the seat it rests on, whatever this device's clock says, so every
// reader replays it after them. True once a relay has it.
export async function giveVerdict(joined: JoinedMatch, state: MatchStateP, verdict: "confirm" | "dispute", profile: Signer | null): Promise<boolean> {
  const signer = profile ?? joined.guest?.signer
  const result = state.result
  if (!signer || !result) throw new Error("no result to give a verdict on")
  const author = await signer.getPublicKey()
  const at = createdAtAfter(nowSeconds(), result.at, state.seats[joined.seat]?.since ?? 0)
  const template = buildRecord("match.confirm", { result: result.event, verdict, seat: joined.seat }, { created_at: at, root: joined.match })
  const event = await signer.signEvent(joined.key ? await sealToMatch(template, author, joined.key) : template)
  return (await publish(event, joined.relays)).some((r) => r.ok)
}

// The player's own games follow the result they confirmed: in it once confirmed, out again
// when that result is corrected or withdrawn, until they confirm the new one.
export async function keepConfirmed(joined: JoinedMatch, state: MatchStateP): Promise<JoinedMatch> {
  const result = state.result
  const mine = result && state.confirmations[joined.seat]?.verdict === "confirm" && state.seats[joined.seat]?.pubkey === seatKey(joined)
  const wanted = mine && result ? result.event : null
  if (wanted === joined.archived) return joined
  if (joined.archived) await unarchive(joined.match)
  if (wanted && result) {
    const throws = resultThrows(state, result)
    if (throws !== null) await archiveFinished(resultGame(state.agreement, { throws, finishedAt: result.finishedAt }, { id: joined.match, own: await ownSeat(joined, state.agreement) }), undefined, new Date(result.finishedAt * 1000))
  }
  const next = { ...joined, archived: wanted }
  const record = await loadJoined(joined.match).catch(() => null)
  if (record) await saveJoined({ ...record, archived: wanted } satisfies Omit<JoinedRecord, "id">).catch(() => {})
  return next
}

export const seatKey = (joined: JoinedMatch) => joined.profile ?? joined.guest?.pubkey ?? null

// The result's throws, from the result itself or its pieces; null while pieces are missing.
export function resultThrows(state: MatchStateP, result: MatchResultEntry): string | null {
  if (result.throws !== undefined) return result.throws
  if (!result.log) return null
  try {
    return assembleChunks(state.logs[result.log.head] ?? [], { head: result.log.head, total: result.log.total, bytes: result.log.bytes })
  } catch {
    return null
  }
}

// This phone's player in their seat: the directory's player linked to the profile, else the
// seat's name.
async function ownSeat(joined: JoinedMatch, agreement: Agreement) {
  const alias = agreement.seats[joined.seat]?.alias ?? `${joined.seat + 1}`
  const linked = joined.profile ? (await listPlayers().catch(() => [])).find((p) => p.pubkey === joined.profile) : undefined
  return { seat: joined.seat, id: linked?.id ?? `seat${joined.seat}`, name: linked?.name ?? alias }
}
