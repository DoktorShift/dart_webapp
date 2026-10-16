import { hexToBytes } from "@noble/hashes/utils.js"
import { legsWonInGame, playsSets, replay } from "../game/engine.ts"
import type { SavedMatch } from "../game/types.ts"
import { createLocalSigner } from "../nostr/signers.ts"
import type { Signer } from "../nostr/types.ts"
import { openSecret, sealSecret } from "../profile/vault.ts"
import { agreementToConfig, ENGINE_VERSION } from "../protocol/match.ts"
import type { TournamentState } from "../protocol/tournament-state.ts"
import type { ArchivedMatch } from "../storage/archive.ts"
import { dbGet } from "../storage/db.ts"
import { randomHex } from "../storage/ids.ts"
import { withLock } from "../storage/lock.ts"
import type { MatchView } from "./engine.ts"
import { readTournament } from "./read.ts"
import { resultTemplate, type SubmittedResult } from "./records.ts"
import { EXTRA_ID, type TournamentExtra } from "./extra.ts"
import { send } from "./send.ts"
import { changeBoardDevice, loadBoardDevice, loadStoredTournament, rememberGame, updateTournament, type BoardDeviceRecord } from "./store.ts"

// This device as one board of a tournament (PLAN.md "Boards haben Namen und eigene
// eingeschränkte Zugänge"): it holds the board key the organizer authorized (never the
// organizer's key), starts the game called to it with the tournament's rules on the normal
// game screen, and signs the result for the tournament with that key. A board that is offline
// finishes its match; the result waits in the outbox like every record (send.ts). Going live for
// spectators and the organizer is lib/live's (the screen calls goLive with the board key as the
// match's authority).

export interface BoardKey {
  pubkey: string
  secret: Uint8Array
  signer: Signer
}

// Makes this device the board named in a board code (lib/protocol/links.ts "tournamentBoard").
// A device that is this board already keeps what it has. A device that was another board of the
// tournament reports what it played there first: the games of the old board go with it.
export async function becomeBoard(payload: { tournament: string; board: string; key: string; relays: readonly string[] }): Promise<BoardDeviceRecord> {
  const existing = await loadBoardDevice(payload.tournament)
  if (existing?.board === payload.board) return existing
  if (existing) await reportPlayed(payload.tournament)
  const key = await sealSecret(hexToBytes(payload.key), "board-key")
  const record = await changeBoardDevice(payload.tournament, (stored) =>
    stored?.board === payload.board ? stored : { tournament: payload.tournament, board: payload.board, relays: [...payload.relays], key, games: {} },
  )
  await updateTournament(payload.tournament, { relays: payload.relays, openedAt: Date.now() })
  return record as BoardDeviceRecord
}

// Whether a board code carries the key the organizer authorized for the board it names: a code
// for a board taken out, or a damaged or forged one, makes no board.
export async function codeFits(state: TournamentState, code: { board: string; key: string }): Promise<boolean> {
  const board = state.boards[code.board]
  if (!board?.active) return false
  try {
    return (await (await createLocalSigner(hexToBytes(code.key))).getPublicKey()) === board.key
  } catch {
    return false
  }
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
  const id = randomHex(16)
  return {
    id,
    config: { ...config, extras: { [EXTRA_ID]: { id: state.id, slot: m.id, board, game: id } satisfies TournamentExtra } },
    throws: [],
    startedAt: new Date().toISOString(),
    acknowledgedLegs: 0,
    status: "playing",
  }
}

// A game as far as its result goes: the one on the game screen, or one kept in the archive.
type Played = Pick<SavedMatch, "id" | "config" | "throws">

// What the result of the game states, as the tournament takes it (winner by participant,
// legs or sets of the two sides); null while the game is not won.
export function resultOf(game: Played, players: readonly [string, string]): (SubmittedResult & { key: string }) | null {
  const state = replay(game.config, game.throws)
  if (state.winner === null) return null
  const sides = playsSets(game.config) ? [state.setsWon[0] ?? 0, state.setsWon[1] ?? 0] : [legsWonInGame(state, 0), legsWonInGame(state, 1)]
  const score: [number, number] = [sides[0], sides[1]]
  return { winner: players[state.winner], score, key: `${state.winner}|${score.join(",")}` }
}

// Signs a result for the slot with the board key and hands it to the outbox, for the game this
// board started for the slot only (a rematch or "play again" of it reports nothing). The same
// result is never reported twice (BoardGame.reported).
export async function reportResult(tournament: string, key: BoardKey, state: TournamentState, slot: string, game: Played): Promise<void> {
  const record = await loadBoardDevice(tournament)
  const started = record?.games[slot]
  const result = started?.local === game.id ? resultOf(game, started.players) : null
  if (!started || !result || started.reported?.key === result.key) return
  const [event] = await send(tournament, [resultTemplate(state, slot, { winner: result.winner, score: result.score, ...(started.match ? { match: started.match } : {}) })], key)
  await rememberGame(tournament, slot, (before) => ({ ...(before ?? started), reported: { event: event.id, key: result.key } }))
}

// Reports games of this board, one report at a time in every tab: with the board key and the
// tournament as this device has it now. Nothing without them (the next call tries again).
function report(tournament: string, games: (record: BoardDeviceRecord) => Promise<[string, Played][]>): Promise<string[]> {
  return withLock(`tournament-report:${tournament}`, async () => {
    const record = await loadBoardDevice(tournament)
    if (!record) return []
    const played = await games(record)
    const key = played.length > 0 ? await openBoardKey(record) : null
    const stored = key && (await loadStoredTournament(tournament))
    const state = stored ? readTournament(stored, { pubkey: null }).state : null
    if (key && state) for (const [slot, game] of played) await reportResult(tournament, key, state, slot, game)
    return played.map(([slot]) => slot)
  })
}

// The result of a game on the game screen, as soon as it is won: nothing waits for the result
// screen, so leaving it at once loses nothing. An Undo and another winning dart report again.
export async function reportGame(tournament: string, slot: string, game: SavedMatch): Promise<void> {
  if (replay(game.config, game.throws).winner === null) return
  await report(tournament, async () => [[slot, game]])
}

// Every game this board won here (kept in the archive) whose result has not gone out yet: the
// app was closed before it was signed, signing failed. Resolves with the slots this board has a
// won game for, reported or not.
export const reportPlayed = (tournament: string): Promise<string[]> =>
  report(tournament, async (record) => {
    const played: [string, Played][] = []
    for (const [slot, game] of Object.entries(record.games)) {
      const archived = await dbGet<ArchivedMatch>("matches", game.local)
      if (archived?.config && archived.throws) played.push([slot, { id: archived.id, config: archived.config, throws: archived.throws }])
    }
    return played
  })
