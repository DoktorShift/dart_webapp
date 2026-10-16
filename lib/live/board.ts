import { replay } from "../game/engine.ts"
import { loadMatch, parseSavedMatch, saveMatch } from "../game/storage.ts"
import type { SavedMatch } from "../game/types.ts"
import { normalizeRelayUrl } from "../nostr/relays.ts"
import { createdAt, nowSeconds, syncClock } from "../nostr/time.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { KIND_RECORD } from "../protocol/kinds.ts"
import { encodeLinkPayload } from "../protocol/links.ts"
import { MAX_SESSION_SECONDS, type Agreement } from "../protocol/match.ts"
import type { SeatHolder } from "../protocol/match-state.ts"
import { buildRecord, type ContentOf, type RecordType } from "../protocol/records.ts"
import { isSignedEventShape, tagValue, type SignedEvent } from "../protocol/tags.ts"
import { decodeThrows, encodeThrows } from "../protocol/throws.ts"
import { enqueue, pendingEvents, withdraw, type Delivery } from "../sync/outbox.ts"
import { agreementFor, resultFor, snapshotFor } from "./content.ts"
import { followMatch, type Followed } from "./follow.ts"
import { fromHex, keyOf, liveRelays, newKey, sealToMatch, toHex, type MatchKey } from "./keys.ts"
import { dropBoard, listBoards, loadBoard, openKeys, saveBoard, sealKeys, type BoardRecord, type BoardSecrets, type StoredBoard } from "./store.ts"

// The writing side of a live match: the board (docs/protocol/families/session-authorization.md,
// match-live.md, match-result.md). Going live founds the match under a key made for it; from
// then on the board follows the game it scores and, without ever holding up a dart:
//
// - signs a snapshot of the game after every change, at most one a second, and sends the
//   newest (an offline board keeps only the newest);
// - publishes the result once the game is won and stays won for a moment, a correction when a
//   corrected game ends differently, and withdraws it ("void") while a reopened game runs;
// - connects players' phones to their seats (match.seat), so they can give their verdict;
// - follows its own match, to show the players' verdicts and to notice when another device
//   has taken the match over (two branches): then it stops writing.
//
// Everything leaves through the outbox of lib/sync (decision 0002 §2, amendment of 16 October
// 2026), which keeps a record until relays of two operators have it, across reloads, and tries
// again with its backoff. Readable (one relay has it) and safely stored (that rule) stay apart:
// every record names the ones it rests on (`after`: the founding, the session it cites, a
// result's pieces and the result it replaces), and goes out once those are readable. The
// snapshot (rule "any", newest per coordinate) goes out as soon as the founding and its session
// are, so one relay out of reach never freezes the spectators' score.
//
// The keys never leave the device except in a handoff package, and then only to the device the
// person here confirmed (lib/live/handoff.ts).

export interface BoardView {
  // The watch link's payload (W1…).
  watch: string
  // Per seat: the phone connected to it, and its verdict on the current result.
  seats: { holder: SeatHolder | null; verdict: "confirm" | "dispute" | null }[]
  // Another device writes this match now; the visits each branch has, where known.
  moved: { here: number; there: number | null } | null
}

interface MatchKeys {
  authority: MatchKey
  session: MatchKey
  match: MatchKey
}

interface Board {
  record: BoardRecord
  keys: MatchKeys
  game: SavedMatch
  attached: boolean
  timers: { snapshot?: ReturnType<typeof setTimeout>; result?: ReturnType<typeof setTimeout>; detach?: ReturnType<typeof setTimeout> }
  // Signing and the record change one step at a time (the result chain depends on it).
  queue: Promise<unknown>
  follower: { close: () => void } | null
  followed: Followed | null
  // Handed over, or another device took the match: nothing more is written here.
  ended: boolean
  view: BoardView
}

// At most one snapshot a second; the result waits until the game stays decided this long (an
// Undo right after the winning dart publishes nothing).
const SNAPSHOT_MS = 1000
const RESULT_SETTLE_MS = 3000
// A game left with "Spiel beenden" can come back with Undo for 8 s (components/undo-banner.tsx).
const UNDO_WINDOW_MS = 10_000
// A new session is signed this long before the current one's window ends.
const RENEW_BEFORE_S = 600

const boards = new Map<string, Board>()

// ---- Founding and opening --------------------------------------------------------------------

// Boards being opened or founded, so two calls at once make one.
const opening = new Map<string, Promise<Board>>()

// Makes the game live (or returns it as it is live already) and starts following it.
export async function goLive(match: SavedMatch): Promise<BoardView> {
  let pending = opening.get(match.id)
  if (!pending) {
    pending = (async () => boards.get(match.id) ?? (await openBoard(match)) ?? (await foundBoard(match)))()
    opening.set(match.id, pending)
    void pending.finally(() => opening.delete(match.id)).catch(() => {})
  }
  const board = await pending
  attach(board, match)
  return board.view
}

// The game screen opened a game: if it is live on this device, carry on with it.
export async function attachBoard(match: SavedMatch): Promise<boolean> {
  const board = boards.get(match.id) ?? (await openBoard(match))
  if (!board || board.ended) return false
  attach(board, match)
  return true
}

async function foundBoard(match: SavedMatch): Promise<Board> {
  // Relays refuse events dated too far ahead: the board's clock is set by the app's server first.
  await syncClock()
  const [authority, session, key] = await Promise.all([newKey(), newKey(), newKey()])
  const relays = liveRelays()
  const at = createdAt()
  const content = { sv: 1, session: session.pubkey, from: at, until: at + MAX_SESSION_SECONDS, agreement: agreementFor(match.config) }
  const founding = await authority.signer.signEvent(await sealToMatch(buildRecord("match.session", content, { created_at: at }), authority.pubkey, key))
  const record: BoardRecord = {
    id: "",
    local: match.id,
    match: founding.id,
    relays,
    keys: await sealKeys(secretsOf({ authority, session, match: key })),
    founding,
    session: founding,
    sv: 1,
    until: content.until,
    n: 0,
    snapshotAt: 0,
    seats: match.config.players.map(() => null),
    seatAt: 0,
    result: null,
  }
  await enqueue([{ event: founding, relays }])
  await saveBoard(record)
  return register(record, { authority, session, match: key }, match)
}

async function openBoard(match: SavedMatch): Promise<Board | null> {
  const stored = await loadBoard(match.id).catch(() => null)
  if (!stored) return null
  const secrets = await openKeys<BoardSecrets>(stored.keys)
  // The vault key is gone (signed out, data deleted): the match is no longer live here.
  if (!secrets) return null
  const record = await queueLeftovers(stored)
  const [authority, session, key] = await Promise.all([keyOf(fromHex(secrets.authority)), keyOf(fromHex(secrets.session)), keyOf(fromHex(secrets.match))])
  return boards.get(match.id) ?? register(record, { authority, session, match: key }, match)
}

const secretsOf = (keys: MatchKeys): BoardSecrets => ({ authority: toHex(keys.authority.secret), session: toHex(keys.session.secret), match: toHex(keys.match.secret) })

function register(record: BoardRecord, keys: MatchKeys, game: SavedMatch): Board {
  const board: Board = {
    record,
    keys,
    game,
    attached: false,
    timers: {},
    queue: Promise.resolve(),
    follower: null,
    followed: null,
    ended: false,
    view: { watch: watchLink(record, keys), seats: record.seats.map((holder) => ({ holder, verdict: null })), moved: null },
  }
  boards.set(record.local, board)
  changed()
  return board
}

const watchLink = (record: BoardRecord, keys: MatchKeys) =>
  encodeLinkPayload({ type: "watch", match: record.match, key: toHex(keys.match.secret), relays: record.relays })

function attach(board: Board, match: SavedMatch) {
  clearTimeout(board.timers.detach)
  board.attached = true
  board.follower ??= followMatch({ match: board.record.match, key: toHex(board.keys.match.secret), relays: board.record.relays }, (followed) => {
    board.followed = followed
    noticeTakeover(board)
    refreshView(board)
  })
  updateBoard(match)
}

// ---- Following the game ----------------------------------------------------------------------

// Every change of the game on this board. Cheap: signing and sending happen later, off the
// path of the dart.
export function updateBoard(match: SavedMatch) {
  const board = boards.get(match.id)
  if (!board || board.ended) return
  board.game = match
  board.timers.snapshot ??= setTimeout(() => {
    board.timers.snapshot = undefined
    void step(board, () => sendSnapshot(board))
  }, board.record.snapshotAt === 0 ? 0 : SNAPSHOT_MS)
  clearTimeout(board.timers.result)
  board.timers.result = setTimeout(() => void step(board, () => settleResult(board)), RESULT_SETTLE_MS)
}

// The game screen closed (paused, finished, ended, or the app moves on). The result goes out
// now; whether the game is gone for good is known once Undo can no longer bring it back.
export function detachBoard(match: SavedMatch) {
  const board = boards.get(match.id)
  if (!board) return
  board.attached = false
  board.game = match
  clearTimeout(board.timers.result)
  if (!board.ended) void step(board, () => settleResult(board))
  board.timers.detach = setTimeout(() => void step(board, () => settleDetached(board)), UNDO_WINDOW_MS)
}

async function settleDetached(board: Board) {
  if (board.attached) return
  board.follower?.close()
  board.follower = null
  const kept = loadMatch()
  if (kept?.id === board.record.local) {
    // Saved and left: spectators see it paused until it goes on.
    board.game = kept
    await sendSnapshot(board)
    return
  }
  if (!board.ended && replay(board.game.config, board.game.throws).winner === null) await sendSnapshot(board, { abandoned: true })
  await forget(board)
}

// The board's keys and record go; what still waits for a relay is the outbox's to send.
async function forget(board: Board) {
  board.ended = true
  boards.delete(board.record.local)
  changed()
  await dropBoard(board.record.local).catch(() => {})
}

function step(board: Board, task: () => Promise<void>) {
  const next = board.queue.then(task).catch(() => {
    // A failed signature or write leaves the record as it was; the next change tries again.
  })
  board.queue = next
  return next
}

async function sendSnapshot(board: Board, opts: { abandoned?: boolean } = {}) {
  if (board.ended && !opts.abandoned) return
  await renewSession(board)
  const { record, keys, game } = board
  const n = record.n + 1
  const at = createdAt(record.snapshotAt)
  const content = snapshotFor(game, replay(game.config, game.throws), { sv: record.sv, n, auth: record.session, abandoned: opts.abandoned })
  const snapshot = await sign(board, keys.session, "match.live", content, at, { d: record.match })
  // Readable as soon as the founding and the session it cites are; a newer one replaces it.
  await enqueue([{ event: snapshot, relays: record.relays, after: [record.match, record.session.id] }], { rule: "any", coalesce: true })
  await persist(board, { n, snapshotAt: at })
}

// The result chain this session published, brought in line with the game as it stands.
async function settleResult(board: Board) {
  if (board.ended) return
  await renewSession(board)
  const { record, keys, game } = board
  const state = replay(game.config, game.throws)
  const head = record.result
  // A result rests on the session it cites and the result it replaces.
  const after = head ? [record.session.id, head.event] : [record.session.id]
  if (state.winner === null) {
    if (!head || head.key === "void") return
    const content = { sv: record.sv, status: "void" as const, winner: null, legs: game.config.players.map(() => 0), finishedAt: nowSeconds(), replaces: head.event, reason: "Reopened on the board", auth: record.session }
    const event = await sign(board, keys.session, "match.result", content, createdAt(), {})
    await queue(board, [{ event, after }])
    await persist(board, { result: { event: event.id, key: "void" } })
    return
  }
  const result = resultFor(game, state, { sv: record.sv, auth: record.session, finishedAt: nowSeconds() })
  if (head?.key === result.key) return
  const pieces: SignedEvent[] = []
  for (const piece of result.pieces) pieces.push(await sign(board, keys.session, "match.log", piece, createdAt(), {}))
  const content = head ? { ...result.content, replaces: head.event, reason: "Corrected on the board" } : result.content
  const event = await sign(board, keys.session, "match.result", content, createdAt(), {})
  await queue(board, [...pieces.map((piece) => ({ event: piece, after: [record.session.id] })), { event, after: [...after, ...pieces.map((piece) => piece.id)] }])
  await persist(board, { result: { event: event.id, key: result.key } })
}

// A session lasts a day at most (MAX_SESSION_SECONDS); a game that runs longer, or is picked up
// the next day, goes on under a fresh session key. Results of the old session no longer count,
// so the result is published again.
async function renewSession(board: Board) {
  if (nowSeconds() < board.record.until - RENEW_BEFORE_S) return
  await handover(board, await newKey())
}

async function handover(board: Board, session: MatchKey) {
  const { record, keys } = board
  const at = createdAt(record.session.created_at)
  const content = { sv: record.sv + 1, session: session.pubkey, from: at, until: at + MAX_SESSION_SECONDS, prev: record.session.id }
  const event = await sign(board, keys.authority, "match.session", content, at, {})
  await queue(board, [{ event, after: [record.session.id] }])
  board.keys = { ...keys, session }
  await persist(board, { session: event, sv: content.sv, until: content.until, result: null, keys: await sealKeys(secretsOf(board.keys)) })
}

async function sign<T extends RecordType>(board: Board, key: MatchKey, type: T, content: ContentOf<T>, at: number, opts: { d?: string }): Promise<SignedEvent> {
  const template = buildRecord(type, content, { created_at: at, root: board.record.match, ...opts })
  return key.signer.signEvent(await sealToMatch(template, key.pubkey, board.keys.match))
}

async function persist(board: Board, change: Partial<BoardRecord>) {
  board.record = { ...board.record, ...change }
  // A board dropped meanwhile (handed over while a send was under way) is not written back.
  if (boards.get(board.record.local) !== board) return
  await saveBoard(board.record).catch(() => {
    // Storage failing: the board goes on from memory for as long as the page is open.
  })
}

// ---- Sending ---------------------------------------------------------------------------------

// Hands records to the outbox (rule "published"), each after the records it rests on. Always
// before the record changes: should the app die in between, the relays still get what was
// signed, and the board goes on from the older record.
const queue = (board: Board, records: { event: SignedEvent; after: string[] }[]) => enqueue(records.map((r) => ({ ...r, relays: board.record.relays })))

// Records in their order, each after the one before it.
const chained = (events: readonly SignedEvent[], relays: readonly string[]): Delivery[] => events.map((event, i) => ({ event, relays, after: i === 0 ? [] : [events[i - 1].id] }))

// Everything of the match in the outbox: the founding (its id is the match id) and every event
// naming it as root, the snapshot included.
const ofMatch = (match: string) => (event: NostrEvent) => event.id === match || tagValue(event.tags, "e") === match

// A record written before the board's records moved to the outbox (October 2026) still carries
// the ones no relay had yet: they are queued once, in their order, and the field goes.
async function queueLeftovers({ outbox, ...record }: StoredBoard): Promise<BoardRecord> {
  if (!outbox) return record
  await enqueue(chained(outbox, record.relays))
  await saveBoard(record)
  return record
}

// Records of boards whose game is no longer on the screen (the app was closed after a game,
// before the board let go of it): dropped once a game is on the screen again. What they still
// owe the relays waits in the outbox, not here. The game kept here (`current`) stays live for
// when it goes on.
export async function settleBoards(current: string | null) {
  for (const record of await listBoards()) {
    if (record.local === current || boards.has(record.local)) continue
    await queueLeftovers(record)
    await dropBoard(record.local)
  }
}

// ---- Seats -----------------------------------------------------------------------------------

export interface SeatInfo {
  match: string
  relays: string[]
  rules: Agreement["rules"]
  // The seats' names as the match states them.
  aliases: string[]
  holders: (SeatHolder | null)[]
  // The match key, for seated players.
  key: string
}

export function seatInfo(local: string): SeatInfo | null {
  const board = boards.get(local)
  if (!board || board.ended) return null
  const agreement = agreementFor(board.game.config)
  return {
    match: board.record.match,
    relays: board.record.relays,
    rules: agreement.rules,
    aliases: agreement.seats.map((s) => s.alias),
    holders: board.record.seats,
    key: toHex(board.keys.match.secret),
  }
}

// Connects a phone to a seat, or frees the seat (null).
export function seatPlayer(local: string, seat: number, holder: SeatHolder | null): Promise<void> {
  const board = boards.get(local)
  if (!board || board.ended) return Promise.reject(new Error("the match is not live here"))
  return step(board, async () => {
    const at = createdAt(board.record.seatAt)
    const event = await sign(board, board.keys.authority, "match.seat", { seat, player: holder }, at, {})
    await queue(board, [{ event, after: [board.record.match] }])
    const seats = board.record.seats.map((h, i) => (i === seat ? holder : h))
    await persist(board, { seats, seatAt: at })
    refreshView(board)
  })
}

// ---- What the screen shows -------------------------------------------------------------------

// The board of a game as the screen shows it, or null when the game is not live here.
// A board that stopped shows only while it says why (another device took the match over).
export const boardView = (local: string): BoardView | null => {
  const board = boards.get(local)
  return board && (!board.ended || board.view.moved) ? board.view : null
}

const listeners = new Set<() => void>()
const changed = () => {
  for (const listener of listeners) listener()
}

// Hears every change of any board here (there is rarely more than one).
export function subscribeBoards(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function refreshView(board: Board) {
  const state = board.followed?.state
  const counted = state?.result && board.record.result?.event === state.result.event ? state.confirmations : {}
  board.view = {
    ...board.view,
    seats: board.record.seats.map((holder, i) => ({ holder, verdict: holder && counted[i]?.pubkey === holder.pubkey ? counted[i].verdict : null })),
  }
  changed()
}

// Another device handed the match over to itself without this one knowing (the handoff's last
// message was lost): its session is newer. This board stops and shows both branches.
function noticeTakeover(board: Board) {
  const state = board.followed?.state
  if (!state || board.ended || state.current.sv <= board.record.sv) return
  board.ended = true
  const { config, throws } = board.game
  const there = state.live && state.live.content.from === 0 ? replay(config, decodeThrows(state.live.content.throws)).visitSeq : null
  board.view = { ...board.view, moved: { here: replay(config, throws).visitSeq, there } }
}

// The person chose: the game stays here, scored on this device only, no longer live.
export async function stopHere(local: string) {
  const board = boards.get(local)
  if (!board) return
  board.ended = true
  board.view = { ...board.view, moved: null }
  changed()
  board.follower?.close()
  board.follower = null
  await forget(board)
}

// ---- Handing over ----------------------------------------------------------------------------

// What travels to the device that takes the match over (docs/protocol/families/
// session-authorization.md, "Schreiberwechsel"): the authority's and the match key, the match
// as published so far, records not yet on a relay, and the game itself with its throws compact.
// (A type, not an interface: it travels as a plain JSON object.)
export type HandoffPackage = {
  v: 1
  match: string
  relays: string[]
  keys: { authority: string; match: string }
  founding: SignedEvent
  session: SignedEvent
  sv: number
  n: number
  snapshotAt: number
  seats: (SeatHolder | null)[]
  seatAt: number
  outbox: SignedEvent[]
  game: { id: string; config: SavedMatch["config"]; throws: string; startedAt: string; acknowledgedLegs: number }
}

export async function packBoard(local: string): Promise<HandoffPackage> {
  const board = boards.get(local)
  if (!board || board.ended) throw new Error("the match is not live here")
  await board.queue
  const { record, keys, game } = board
  return {
    v: 1,
    match: record.match,
    relays: record.relays,
    keys: { authority: toHex(keys.authority.secret), match: toHex(keys.match.secret) },
    founding: record.founding,
    session: record.session,
    sv: record.sv,
    n: record.n,
    snapshotAt: record.snapshotAt,
    seats: record.seats,
    seatAt: record.seatAt,
    // The records relays don't have safely yet, for the other device to send; it signs snapshots
    // of its own.
    outbox: (await pendingEvents(ofMatch(record.match))).filter((event) => event.kind === KIND_RECORD),
    game: { id: game.id, config: game.config, throws: encodeThrows(game.throws), startedAt: game.startedAt, acknowledgedLegs: game.acknowledgedLegs },
  }
}

// The other device has the match: this one writes nothing more, forgets its keys, and no longer
// keeps the game to go on with here (a reload must not offer it again).
export async function handedOver(local: string) {
  const board = boards.get(local)
  if (!board) return
  board.ended = true
  clearTimeout(board.timers.snapshot)
  clearTimeout(board.timers.result)
  board.follower?.close()
  board.follower = null
  boards.delete(local)
  changed()
  if (loadMatch()?.id === local) saveMatch(null)
  await dropBoard(local).catch(() => {})
  // A step under way (a snapshot being signed) ends first, so nothing of the match is queued
  // after it is withdrawn: the other device sends what the relays don't have yet.
  await board.queue
  await withdraw(ofMatch(board.record.match))
}

// On the device that takes over: the match becomes live here under a session key of its own
// (sv + 1, signed with the authority's key that came along). Returns the game to go on with, or
// null for a package that is not a match this version can continue.
export async function adoptBoard(data: unknown): Promise<SavedMatch | null> {
  const pkg = readPackage(data)
  if (!pkg) return null
  const game = parseSavedMatch({ ...pkg.game, throws: decodeThrows(pkg.game.throws), status: "playing" })
  if (!game) return null
  const [authority, match, session] = await Promise.all([keyOf(fromHex(pkg.keys.authority)), keyOf(fromHex(pkg.keys.match)), newKey()])
  if (authority.pubkey !== pkg.founding.pubkey || authority.pubkey !== pkg.session.pubkey) return null
  const keys = { authority, session, match }
  const record: BoardRecord = {
    id: "",
    local: game.id,
    match: pkg.match,
    relays: pkg.relays,
    keys: await sealKeys(secretsOf(keys)),
    founding: pkg.founding,
    // The handover below names the new session and its window.
    session: pkg.session,
    sv: pkg.sv,
    until: 0,
    n: pkg.n,
    snapshotAt: pkg.snapshotAt,
    seats: pkg.seats,
    seatAt: pkg.seatAt,
    result: null,
  }
  // What the relays don't have yet goes out from here, in its order; the handover follows it.
  await enqueue(chained(pkg.outbox, pkg.relays))
  const board = register(record, keys, game)
  await step(board, () => handover(board, session))
  return game
}

const HEX64 = /^[0-9a-f]{64}$/

function readPackage(data: unknown): HandoffPackage | null {
  const p = data as Partial<HandoffPackage> | null
  const events = (list: unknown) => Array.isArray(list) && list.every(isSignedEventShape)
  const ok =
    !!p &&
    p.v === 1 &&
    typeof p.match === "string" &&
    HEX64.test(p.match) &&
    Array.isArray(p.relays) &&
    p.relays.length > 0 &&
    p.relays.every((r) => typeof r === "string" && normalizeRelayUrl(r) !== null) &&
    HEX64.test(p.keys?.authority ?? "") &&
    HEX64.test(p.keys?.match ?? "") &&
    isSignedEventShape(p.founding) &&
    p.founding.id === p.match &&
    isSignedEventShape(p.session) &&
    Number.isInteger(p.sv) &&
    Number.isInteger(p.n) &&
    Number.isInteger(p.snapshotAt) &&
    Array.isArray(p.seats) &&
    Number.isInteger(p.seatAt) &&
    events(p.outbox) &&
    typeof p.game?.throws === "string"
  return ok ? (p as HandoffPackage) : null
}
