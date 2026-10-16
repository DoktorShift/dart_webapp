import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { legsWonInGame, playsSets, replay } from "../game/engine.ts"
import type { MatchConfig, SavedMatch } from "../game/types.ts"
import { publish, type PublishResult } from "../nostr/client.ts"
import { isPublished } from "../nostr/relays.ts"
import { createLocalSigner } from "../nostr/signers.ts"
import type { NostrEvent, Signer } from "../nostr/types.ts"
import { openSecret, sealSecret } from "../profile/vault.ts"
import { agreementToConfig, ENGINE_VERSION } from "../protocol/match.ts"
import type { TournamentState } from "../protocol/tournament-state.ts"
import { randomHex } from "../storage/ids.ts"
import type { MatchView } from "./engine.ts"
import { resultTemplate, type SubmittedResult } from "./records.ts"
import { tournamentRelays } from "./send.ts"
import { loadBoardDevice, saveBoardDevice, updateTournament, type BoardDeviceRecord, type BoardGame } from "./store.ts"

// This device as one board of a tournament (PLAN.md "Boards haben Namen und eigene
// eingeschränkte Zugänge"): it holds the board key the organizer authorized (never the
// organizer's key), starts the game called to it with the tournament's rules on the normal
// game screen, and signs the result for the tournament with that key. A board that is offline
// finishes its match and keeps the result until a relay takes it (its own outbox, in order).
// Going live for spectators and the organizer is lib/live's (the screen calls goLive with the
// board key as the match's authority); this module knows nothing of relays beyond sending.

export interface BoardKey {
  pubkey: string
  secret: Uint8Array
  signer: Signer
}

// What a tournament game carries in its config (MatchConfig.extras.tournament), so the game
// screen's pieces know the slot it decides and the board scoring it.
export interface TournamentExtra {
  id: string
  slot: string
  board: string
}

export const EXTRA_ID = "tournament"

export function tournamentExtra(config: MatchConfig): TournamentExtra | null {
  const extra = config.extras?.[EXTRA_ID] as Partial<TournamentExtra> | undefined
  return extra && typeof extra.id === "string" && typeof extra.slot === "string" && typeof extra.board === "string" ? { id: extra.id, slot: extra.slot, board: extra.board } : null
}

// Makes this device the board named in a board code (lib/protocol/links.ts "tournamentBoard").
// A device that is this board already keeps what it has.
export async function becomeBoard(payload: { tournament: string; board: string; key: string; relays: readonly string[] }): Promise<BoardDeviceRecord> {
  const existing = await loadBoardDevice(payload.tournament)
  if (existing && existing.board === payload.board) return existing
  const record: Omit<BoardDeviceRecord, "id"> = {
    tournament: payload.tournament,
    board: payload.board,
    relays: [...payload.relays],
    key: await sealSecret(hexToBytes(payload.key), "board-key"),
    outbox: [],
    games: {},
  }
  await saveBoardDevice(record)
  await updateTournament(payload.tournament, { relays: payload.relays, openedAt: Date.now() })
  return (await loadBoardDevice(payload.tournament)) as BoardDeviceRecord
}

// The board's key, or null once the vault key is gone (signed out, data deleted): the device is
// then no longer this board.
export async function openBoardKey(record: BoardDeviceRecord): Promise<BoardKey | null> {
  try {
    const secret = await openSecret(record.key, "board-key")
    const signer = await createLocalSigner(secret)
    return { pubkey: await signer.getPublicKey(), secret, signer }
  } catch {
    return null
  }
}

// The game for a match called to this board: the tournament's rules (the final's where it is
// one), the two players by name, and the slot it decides in its extras.
export function boardGame(state: TournamentState, m: MatchView, names: Record<string, string>, board: string, modeName: string): SavedMatch {
  const rules = m.final && state.settings.final ? state.settings.final : state.settings.rules
  const seats = m.slots.map((s) => ({ alias: (s.participant && names[s.participant]) || "?" }))
  const config = agreementToConfig({ engine: ENGINE_VERSION, rules, seats, visibility: "public" }, modeName)
  return {
    id: randomHex(16),
    config: { ...config, extras: { [EXTRA_ID]: { id: state.id, slot: m.id, board } satisfies TournamentExtra } },
    throws: [],
    startedAt: new Date().toISOString(),
    acknowledgedLegs: 0,
    status: "playing",
  }
}

export async function rememberGame(record: BoardDeviceRecord, slot: string, game: BoardGame): Promise<BoardDeviceRecord> {
  const next = { ...record, games: { ...record.games, [slot]: game } }
  await saveBoardDevice(next)
  return next
}

// What the result of the game states, as the tournament takes it (winner by participant,
// legs or sets of the two sides); null while the game is not won.
export function resultOf(game: SavedMatch, players: readonly [string, string]): (SubmittedResult & { key: string }) | null {
  const state = replay(game.config, game.throws)
  if (state.winner === null) return null
  const sides = playsSets(game.config) ? [state.setsWon[0] ?? 0, state.setsWon[1] ?? 0] : [legsWonInGame(state, 0), legsWonInGame(state, 1)]
  const score: [number, number] = [sides[0], sides[1]]
  return { winner: players[state.winner], score, key: `${state.winner}|${score.join(",")}` }
}

// Signs a result for the slot with the board key and sends it; what no relay takes stays in
// the board's outbox. The same result is never reported twice (BoardGame.reported).
export async function reportResult(record: BoardDeviceRecord, key: BoardKey, state: TournamentState, slot: string, result: SubmittedResult & { key: string }): Promise<BoardDeviceRecord> {
  const game = record.games[slot]
  if (!game || game.reported?.key === result.key) return record
  const event = await key.signer.signEvent(resultTemplate(state, slot, { winner: result.winner, score: result.score, ...(game.match ? { match: game.match } : {}) }))
  const next: BoardDeviceRecord = { ...record, outbox: [...record.outbox, event], games: { ...record.games, [slot]: { ...game, reported: { event: event.id, key: result.key } } } }
  await saveBoardDevice(next)
  await updateTournament(record.tournament, { events: [event] })
  return flushBoard(next)
}

const TRANSIENT = new Set(["timeout", "unreachable", "rate-limited", "auth-required", "error", ""])
const delivered = (results: readonly PublishResult[]) =>
  results.length > 0 && (isPublished(results.filter((r) => r.ok).map((r) => r.url)) || results.every((r) => r.ok || !TRANSIENT.has(r.code)))

// Sends the board's results in order, stopping at the first one no relay took.
export async function flushBoard(record: BoardDeviceRecord): Promise<BoardDeviceRecord> {
  const relays = tournamentRelays(record.relays)
  let outbox = record.outbox
  for (const event of record.outbox) {
    const results = await publish(event, relays).catch((): PublishResult[] => [])
    if (!delivered(results)) break
    outbox = outbox.filter((e) => e.id !== event.id)
  }
  if (outbox === record.outbox) return record
  const next = { ...record, outbox }
  await saveBoardDevice(next)
  return next
}

export const boardKeyHex = (key: BoardKey) => bytesToHex(key.secret)

// The board's reported results that relays have not taken yet.
export const unsentResults = (record: BoardDeviceRecord): NostrEvent[] => record.outbox
