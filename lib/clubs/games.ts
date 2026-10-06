import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { legsWonInGame, replay } from "../game/engine.ts"
import type { MatchConfig, Throw } from "../game/types.ts"
import { createLocalKey, createLocalSigner } from "../nostr/signers.ts"
import type { NostrEvent } from "../nostr/types.ts"
import type { ClubState } from "../protocol/club-state.ts"
import type { Agreement } from "../protocol/match.ts"
import { configToRules, ENGINE_VERSION } from "../protocol/match.ts"
import type { MatchStateP } from "../protocol/match-state.ts"
import { reduceMatch } from "../protocol/match-state.ts"
import { buildRecord, parseRecord } from "../protocol/records.ts"
import { encodeThrows } from "../protocol/throws.ts"
import { afterState, recordTime, send, type Author, type Sent } from "./send.ts"

// Club games (docs/protocol/families/club.md, "Clubspiele"). A game started from the club is
// played on one device like any game; when it is finished, the host's profile records it as a
// match (match.session with the agreement naming the club, then match.result with every
// throw) and names it for the club with club.game. In a closed club the match is private and
// club.game carries its key, sealed for the members; in a public club it is public. Players
// with a profile confirm or dispute the result from their own device (match.confirm).
//
// The host's profile is the match authority and writes the result itself, so nothing else
// needs a key. Live games (lib/live, another track) found their matches with a key of their
// own: a club game played live will name that match with club.game instead of recording a
// second one. That is the integration point; until then a club game is recorded when it ends.

export interface GameSeat {
  name: string
  // The player's profile, when the seat was filled from one (the club's members).
  pubkey?: string
}

export interface FinishedGame {
  config: MatchConfig
  seats: readonly GameSeat[]
  winner: number | null
  throws: readonly Throw[]
}

// What the game's records say about the players: members by their name and profile; guests
// under a neutral alias in a public club ("Gast 1"), by name where everything is encrypted
// (docs/protocol/privacy.md, "Gäste und Dritte").
export function gameSeats(seats: readonly GameSeat[], visibility: "closed" | "public", guestAlias: (n: number) => string): Agreement["seats"] {
  let guests = 0
  return seats.map((seat) => {
    if (seat.pubkey) return { alias: seat.name.trim().slice(0, 40), pubkey: seat.pubkey }
    guests += 1
    return { alias: visibility === "closed" ? seat.name.trim().slice(0, 40) : guestAlias(guests) }
  })
}

// The result as the engine computed it on this device, with the throws so every reader can
// replay it (docs/protocol/families/match-result.md).
export function resultContent(game: FinishedGame, finishedAt: number) {
  const state = replay(game.config, [...game.throws])
  const seats = game.config.players.map((_, i) => i)
  const sets = state.setsWon.some((n) => n > 0) ? { sets: seats.map((i) => state.setsWon[i]) } : {}
  const stats = game.config.type === "x01" ? { stats: { darts: seats.map((i) => state.stats[i].darts), points: seats.map((i) => state.stats[i].points) } } : {}
  return {
    sv: 1,
    status: "finished" as const,
    winner: game.winner,
    legs: seats.map((i) => legsWonInGame(state, i)),
    ...sets,
    ...stats,
    throws: encodeThrows(game.throws),
    finishedAt,
  }
}

// Records a finished club game: the match, then its result and its name in the club.
export async function recordGame(state: ClubState, game: FinishedGame, seats: Agreement["seats"], author: Author): Promise<Sent & { match: string }> {
  const closed = state.info.visibility === "closed"
  const key = closed ? await createLocalKey() : null
  const link = key ? key.pubkey : undefined
  const now = afterState(state)
  const agreement: Agreement = { engine: ENGINE_VERSION, rules: configToRules(game.config), seats, visibility: closed ? "private" : "public", club: state.id }
  const session = buildRecord("match.session", { sv: 1, session: author.pubkey, from: now, until: now + 3600, agreement }, { created_at: now })
  const founded = await send(state.id, [{ template: session, link }], author)
  const match = founded.events[0].id
  const result = buildRecord("match.result", resultContent(game, now), { created_at: recordTime(now), root: match })
  const named = buildRecord("club.game", { match, ...(key ? { key: bytesToHex(key.secretKey) } : {}) }, { created_at: now, root: state.id })
  const sent = await send(state.id, [{ template: result, link }, { template: named, ...(closed ? { seal: { readers: Object.keys(state.members) } } : {}) }], author)
  return { match, events: [...founded.events, ...sent.events], published: founded.published && sent.published }
}

// ---- Reading ---------------------------------------------------------------------------------

export interface ClubGame {
  match: string
  // Who named it for the club, and when.
  by: string
  named: number
  key?: string
  agreement: Agreement
  // The match authority: the host who recorded the result.
  authority: string
  // The result that counts (the newest of its chain), null while there is none or it was voided.
  result: {
    event: string
    by: string
    at: number
    winner: number | null
    legs: number[]
    stats?: { darts: number[]; points: number[] }
    replaces?: string
  } | null
  confirmations: MatchStateP["confirmations"]
}

// The club's games as far as this device has their records. A game whose agreement names
// another club, or whose match is missing, is left out.
export function readGames(state: ClubState, events: readonly NostrEvent[], plaintexts: ReadonlyMap<string, string>, now: number): ClubGame[] {
  const games: ClubGame[] = []
  for (const named of Object.values(state.games)) {
    const records = events.filter((e) => e.id === named.match || e.tags.some((t) => t[0] === "e" && t[1] === named.match))
    const reduced = reduceMatch(records, named.match, { now, open: (e) => plaintexts.get(e.id) ?? null })
    if (!reduced.state || reduced.state.agreement.club !== state.id) continue
    const s = reduced.state
    games.push({
      match: named.match,
      by: named.by,
      named: named.at,
      ...(named.key ? { key: named.key } : {}),
      agreement: s.agreement,
      authority: s.authority,
      result: s.result ? { event: s.result.event, by: s.result.by, at: s.result.at, winner: s.result.winner, legs: s.result.legs, ...statsOf(records, s.result.event, plaintexts), ...(s.result.replaces ? { replaces: s.result.replaces } : {}) } : null,
      confirmations: s.confirmations,
    })
  }
  return games.sort((a, b) => (b.result?.at ?? b.named) - (a.result?.at ?? a.named))
}

function statsOf(records: readonly NostrEvent[], id: string, plaintexts: ReadonlyMap<string, string>) {
  const parsed = parseRecord(records.find((e) => e.id === id), { plaintext: plaintexts.get(id) ?? null })
  if (parsed.status !== "ok" || parsed.record.type !== "match.result" || !parsed.record.content.stats) return {}
  return { stats: parsed.record.content.stats }
}

export const seatOf = (game: ClubGame, pubkey: string) => game.agreement.seats.findIndex((s) => s.pubkey === pubkey)

// Whether `pubkey` still has to say whether this result is right: a player with a profile who
// did not record it and has not answered.
export function awaitsVerdict(game: ClubGame, pubkey: string): boolean {
  const seat = seatOf(game, pubkey)
  return seat >= 0 && game.result !== null && game.result.by !== pubkey && game.confirmations[seat] === undefined
}

// ---- Answering and correcting ----------------------------------------------------------------

// The public key of a private game's match key: what its records are encrypted to.
const linkOf = async (game: ClubGame) => (game.key ? (await createLocalSigner(hexToBytes(game.key))).getPublicKey() : undefined)

// A player confirms or disputes the result from their own device.
export async function answerGame(state: ClubState, game: ClubGame, verdict: "confirm" | "dispute", author: Author, reason?: string): Promise<Sent> {
  if (!game.result) throw new Error("no result to answer")
  const content = { result: game.result.event, verdict, seat: seatOf(game, author.pubkey), ...(reason ? { reason } : {}) }
  const template = buildRecord("match.confirm", content, { created_at: recordTime(game.result.at), root: game.match })
  return send(state.id, [{ template, link: await linkOf(game) }], author)
}

// The host corrects the result after a mistake: a new result that replaces the old one, with a
// reason. Confirmations of the old one no longer count (match-result.md, rule 3).
export async function correctGame(state: ClubState, game: ClubGame, finished: FinishedGame, reason: string, author: Author): Promise<Sent> {
  if (!game.result) throw new Error("no result to correct")
  const now = recordTime(game.result.at)
  const content = { ...resultContent(finished, now), replaces: game.result.event, reason }
  const template = buildRecord("match.result", content, { created_at: now, root: game.match })
  return send(state.id, [{ template, link: await linkOf(game) }], author)
}
