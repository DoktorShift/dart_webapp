import { legsWonInGame, playsSets, replay, type MatchState } from "../game/engine.ts"
import type { MatchConfig, SavedMatch } from "../game/types.ts"
import { chunkData, type Chunk } from "../protocol/chunks.ts"
import { MAX_SEALED_PLAINTEXT_BYTES } from "../protocol/kinds.ts"
import type { LiveSnapshot } from "../protocol/live.ts"
import { liveContent } from "../protocol/live.ts"
import type { Agreement } from "../protocol/match.ts"
import { agreementToConfig, configToRules, ENGINE_VERSION } from "../protocol/match.ts"
import type { ContentOf } from "../protocol/records.ts"
import { utf8Length } from "../protocol/schema.ts"
import type { SignedEvent } from "../protocol/tags.ts"
import { decodeThrows, encodeThrows } from "../protocol/throws.ts"

// What a live match says about the game, built from the app's own game (lib/game), and the
// game read back from it. No network and no keys here: lib/live/board.ts signs and sends.

// A live match is private: everything is encrypted to the match key in the link. The names are
// the ones on the board, which only people holding the link (or seated at the board) can read
// (docs/protocol/privacy.md, "Privates Spiel").
export function agreementFor(config: MatchConfig): Agreement {
  return {
    engine: ENGINE_VERSION,
    rules: configToRules(config),
    seats: config.players.map((p, i) => ({ alias: aliasOf(p.name, i) })),
    visibility: "private",
  }
}

// A protocol alias is 1 to 40 characters without outer spaces; the board's names (at most 16)
// always fit, an empty one becomes its seat number.
const aliasOf = (name: string, seat: number) => name.trim().slice(0, 40).trim() || `${seat + 1}`

export function snapshotFor(match: SavedMatch, state: MatchState, at: { sv: number; n: number; auth: SignedEvent; abandoned?: boolean }): LiveSnapshot {
  const status = at.abandoned ? "abandoned" : state.winner !== null ? "finished" : match.status === "paused" ? "paused" : "playing"
  return liveContent({ state, throws: match.throws, sv: at.sv, n: at.n, status, auth: at.auth })
}

type ResultContent = ContentOf<"match.result">

// Room the rest of a result takes next to its throws once encrypted (the embedded session
// authorization is most of it); a longer log travels in pieces (match.log).
const RESULT_OVERHEAD_BYTES = 4096
const LOG_PIECE_BYTES = 16000

// The result of a won game: winner, legs (and sets) per seat and the whole throw log, inline or
// in pieces. `key` says what the result states, to tell whether a published one still holds.
export function resultFor(match: SavedMatch, state: MatchState, at: { sv: number; auth: SignedEvent; finishedAt: number }): { content: ResultContent; pieces: Chunk[]; key: string } {
  if (state.winner === null) throw new Error("the game is not won yet")
  const seats = match.config.players.map((_, i) => i)
  const throws = encodeThrows(match.throws)
  const sets = playsSets(match.config) ? { sets: [...state.setsWon] } : {}
  const base = { sv: at.sv, status: "finished" as const, winner: state.winner, legs: seats.map((p) => legsWonInGame(state, p)), ...sets, finishedAt: at.finishedAt, auth: at.auth }
  const key = resultKey(state.winner, base.legs, throws)
  if (utf8Length(throws) + RESULT_OVERHEAD_BYTES <= MAX_SEALED_PLAINTEXT_BYTES) return { content: { ...base, throws }, pieces: [], key }
  const { chunks, head, bytes } = chunkData(throws, LOG_PIECE_BYTES)
  return { content: { ...base, log: { head, total: chunks.length, bytes } }, pieces: chunks, key }
}

export const resultKey = (winner: number, legs: readonly number[], throws: string) => `${winner}|${legs.join(",")}|${throws}`

// The game a board offers before a player has a seat: its rules with the seats' names.
export const offeredGame = (rules: Agreement["rules"], aliases: readonly string[]): MatchConfig =>
  agreementToConfig({ engine: ENGINE_VERSION, rules, seats: aliases.map((alias) => ({ alias })), visibility: "private" })

// The game a spectator or player sees: the agreement's rules with its seat names, replayed by
// the engine from the snapshot's throws. A snapshot that carries only the end of a very long
// log ("from" > 0) can't be replayed; then only its standing is known.
export function watchedGame(agreement: Agreement, snapshot: LiveSnapshot): { config: MatchConfig; state: MatchState | null } {
  const config = agreementToConfig(agreement)
  if (snapshot.from > 0) return { config, state: null }
  return { config, state: replay(config, decodeThrows(snapshot.throws)) }
}

// The game a result describes, as this device's archive keeps it (lib/storage/archive.ts).
// `own` puts this device's player into their seat under their own name and directory id.
export function resultGame(agreement: Agreement, result: { throws: string; finishedAt: number }, opts: { id: string; own?: { seat: number; id: string; name: string } }): SavedMatch {
  const config = agreementToConfig(agreement)
  const own = opts.own
  const players = own ? config.players.map((p, i) => (i === own.seat ? { id: own.id, name: own.name } : p)) : config.players
  return {
    id: opts.id,
    config: { ...config, players },
    throws: decodeThrows(result.throws),
    startedAt: new Date(result.finishedAt * 1000).toISOString(),
    acknowledgedLegs: 0,
    status: "playing",
  }
}
