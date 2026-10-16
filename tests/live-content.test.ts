import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { applyThrow, correctDart, legsWonInGame, newMatchState, replay, tagThrow, visitBySeq, type MatchState } from "../lib/game/engine.ts"
import type { MatchConfig, SavedMatch, Throw } from "../lib/game/types.ts"
import { agreementFor, resultFor, resultGame, snapshotFor, watchedGame } from "../lib/live/content.ts"
import { assembleChunks } from "../lib/protocol/chunks.ts"
import { MAX_SESSION_SECONDS } from "../lib/protocol/match.ts"
import { reduceMatch } from "../lib/protocol/match-state.ts"
import { buildRecord, parseRecord } from "../lib/protocol/records.ts"
import type { SignedEvent } from "../lib/protocol/tags.ts"
import { decodeThrows } from "../lib/protocol/throws.ts"
import { config, dart, play } from "./helpers.ts"

// The live match carries the board's game exactly: a spectator who replays a snapshot with the
// engine sees what the board shows, corrections included; results state winner, legs and the
// whole log; snapshots never go back in time. Public matches here, so the tests need no keys
// beyond signing (encryption is covered over a relay in tests/relay/live.test.ts).

const T0 = 1_800_000_000
const authority = generateSecretKey()
const session = generateSecretKey()

const sign = (secret: Uint8Array, template: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(template, secret) as SignedEvent

function found(c: MatchConfig) {
  const agreement = { ...agreementFor(c), visibility: "public" as const }
  const content = { sv: 1, session: getPublicKey(session), from: T0, until: T0 + MAX_SESSION_SECONDS, agreement }
  return sign(authority, buildRecord("match.session", content, { created_at: T0 }))
}

const game = (c: MatchConfig, throws: Throw[]): SavedMatch => ({ id: "m", config: c, throws, startedAt: "2027-01-15T19:00:00.000Z", acknowledgedLegs: 0, status: "playing" })

function snapshotEvent(match: SavedMatch, founding: SignedEvent, n: number, at: number, sv = 1, auth = founding, key = session) {
  const content = snapshotFor(match, replay(match.config, match.throws), { sv, n, auth })
  return sign(key, buildRecord("match.live", content, { created_at: at, root: founding.id, d: founding.id }))
}

// What a spectator's screen depends on, from both sides.
const seen = (s: MatchState) => ({
  scores: s.scores,
  points: s.points,
  progress: s.progress,
  marks: s.marks,
  legsWon: s.legsWon,
  setsWon: s.setsWon,
  legIndex: s.legIndex,
  current: s.current,
  visitDarts: s.visitDarts,
  winner: s.winner,
  legWinners: s.legResults.map((r) => r.winner),
})

// Plays a game to its end the way the app enters it, one tagged throw at a time.
function playOut(c: MatchConfig, next: (s: MatchState) => Throw): Throw[] {
  const s = newMatchState(c)
  const throws: Throw[] = []
  while (s.winner === null) {
    const tagged = tagThrow(s, next(s))
    applyThrow(s, tagged)
    throws.push(tagged)
  }
  return throws
}

// Mia scores 180, 180 and checks out 141 (T20 T19 D12); Jonas misses.
const miaWins = (s: MatchState): Throw =>
  s.current === 1 ? { kind: "noScore" } : s.scores[0] > 141 ? dart(20, 3) : [dart(20, 3), dart(19, 3), dart(12, 2)][s.visitDarts.length]

const games: [string, MatchConfig, Throw[]][] = []
{
  // 501 over two legs; the first dart of the first visit corrected to T19, the first leg's result kept.
  const c = config({ legsToWin: 2 })
  const played = playOut(c, miaWins).slice(0, 12)
  const plan = correctDart(c, played, visitBySeq(replay(c, played), 0)!, 0, { segment: 19, multiplier: 3 })
  games.push(["corrected x01 in the second leg", c, plan.keepResult ? plan.keepResult.throws : plan.rescored])
}
{
  const c = config({ type: "cricket", modeId: "cricket", modeName: "Cricket", cutThroat: true, players: [{ id: "a", name: "Mia" }, { id: "b", name: "Jonas" }, { id: "c", name: "Lea" }] })
  games.push(["cricket, cut throat, three players", c, play(c, [dart(20, 3), dart(19), dart(25, 2), dart(18, 3), dart(0), dart(17, 2), dart(20)])])
}
{
  const c = config({ type: "clock", modeId: "clock", modeName: "Around the Clock" })
  games.push(["around the clock", c, play(c, [dart(1), dart(2), dart(0), dart(1), dart(3)])])
}
{
  const c = config({ legsToWin: 2, setsToWin: 2, players: [{ id: "a", name: "Mia" }, { id: "b", name: "Jonas" }] })
  games.push(["501 in sets, won", c, playOut(c, miaWins)])
}

test("a snapshot replays to exactly what the board shows, corrections included", () => {
  for (const [name, c, throws] of games) {
    const match = game(c, throws)
    const founding = found(c)
    const event = snapshotEvent(match, founding, 1, T0 + 60)
    const parsed = parseRecord(JSON.parse(JSON.stringify(event)), { now: T0 + 60 })
    assert.equal(parsed.status, "ok", name)
    if (parsed.status !== "ok" || parsed.record.type !== "match.live") continue
    const watched = watchedGame(agreementFor(c), parsed.record.content)
    assert.ok(watched.state, name)
    assert.deepEqual(seen(watched.state), seen(replay(c, throws)), name)
    assert.deepEqual(watched.config.players.map((p) => p.name), c.players.map((p) => p.name), `${name}: seat names`)
  }
})

test("an edited dart survives the snapshot", () => {
  const [, c, throws] = games[0]
  assert.ok(throws.some((t) => t.edited))
  const content = snapshotFor(game(c, throws), replay(c, throws), { sv: 1, n: 1, auth: found(c) })
  assert.deepEqual(decodeThrows(content.throws), JSON.parse(JSON.stringify(throws)))
})

test("the snapshot says how the game stands: playing, paused, finished, abandoned", () => {
  const [, c, throws] = games[3]
  const founding = found(c)
  const status = (match: SavedMatch, abandoned?: boolean) => snapshotFor(match, replay(match.config, match.throws), { sv: 1, n: 1, auth: founding, abandoned }).status
  assert.equal(status(game(c, throws.slice(0, 5))), "playing")
  assert.equal(status({ ...game(c, throws.slice(0, 5)), status: "paused" }), "paused")
  assert.equal(status(game(c, throws.slice(0, 5)), true), "abandoned")
  assert.equal(status(game(c, throws)), "finished")
})

test("an older snapshot never replaces a newer one, nor a superseded session a newer one", () => {
  const [, c, throws] = games[3]
  const founding = found(c)
  const match = (n: number) => game(c, throws.slice(0, n * 3))
  const s5 = snapshotEvent(match(5), founding, 5, T0 + 50)
  const s3 = snapshotEvent(match(3), founding, 3, T0 + 70)
  for (const order of [
    [founding, s5, s3],
    [s3, founding, s5],
  ]) {
    const result = reduceMatch(order, founding.id, { now: T0 + 100 })
    assert.equal(result.state?.live?.event, s5.id)
  }
  // After a handover, session 2 counts even with a lower counter and an earlier date.
  const next = generateSecretKey()
  const handover = sign(authority, buildRecord("match.session", { sv: 2, session: getPublicKey(next), from: T0 + 80, until: T0 + 80 + MAX_SESSION_SECONDS, prev: founding.id }, { created_at: T0 + 80, root: founding.id }))
  const s6 = snapshotEvent(match(6), founding, 6, T0 + 81, 2, handover, next)
  const late = snapshotEvent(match(9), founding, 9, T0 + 90)
  const result = reduceMatch([late, s6, handover, founding, s5], founding.id, { now: T0 + 100 })
  assert.equal(result.state?.live?.event, s6.id)
  assert.deepEqual(result.state?.log.rejected.find((r) => r.id === late.id)?.reason, "session_superseded")
})

test("a result states winner, legs and sets per seat and the whole log", () => {
  const [, c, throws] = games[3]
  const state = replay(c, throws)
  const { content, pieces, key } = resultFor(game(c, throws), state, { sv: 1, auth: found(c), finishedAt: T0 + 600 })
  assert.equal(content.winner, 0)
  assert.deepEqual(content.legs, [legsWonInGame(state, 0), legsWonInGame(state, 1)])
  assert.deepEqual(content.sets, [2, 0])
  assert.equal(pieces.length, 0)
  assert.deepEqual(decodeThrows(content.throws!), JSON.parse(JSON.stringify(throws)))
  // The same game gives the same key; a corrected one another.
  assert.equal(resultFor(game(c, throws), state, { sv: 1, auth: found(c), finishedAt: T0 + 700 }).key, key)
  const plan = correctDart(c, throws, visitBySeq(state, 0)!, 0, { segment: 19, multiplier: 3 })
  const corrected = plan.keepResult ? plan.keepResult.throws : plan.rescored
  assert.notEqual(resultFor(game(c, corrected), replay(c, corrected), { sv: 1, auth: found(c), finishedAt: T0 }).key, key)
})

test("a long game's result carries its log in hash-chained pieces", () => {
  // 22 legs of a player chipping away with single 1s against a player who misses: about 22 000
  // characters of log, more than one result can carry.
  const c = config({ legsToWin: 11, setsToWin: 2 })
  const throws = playOut(c, (s) => (s.current === 1 ? { kind: "noScore" } : s.scores[0] === 2 ? dart(1, 2) : dart(1)))
  const state = replay(c, throws)
  const { content, pieces } = resultFor(game(c, throws), state, { sv: 1, auth: found(c), finishedAt: T0 })
  assert.ok(pieces.length >= 2)
  assert.equal(content.throws, undefined)
  const text = assembleChunks(pieces, { head: content.log!.head, total: content.log!.total, bytes: content.log!.bytes })
  assert.deepEqual(decodeThrows(text), JSON.parse(JSON.stringify(throws)))
  // Each piece and the result fit an event.
  for (const piece of pieces) buildRecord("match.log", piece, { created_at: T0, root: "0".repeat(64) })
  buildRecord("match.result", content, { created_at: T0, root: "0".repeat(64) })
})

test("a confirmed result becomes the player's own game, in their own seat", () => {
  const [, c, throws] = games[3]
  const saved = resultGame(agreementFor(c), { throws: (resultFor(game(c, throws), replay(c, throws), { sv: 1, auth: found(c), finishedAt: T0 }).content.throws as string), finishedAt: T0 }, { id: "f".repeat(64), own: { seat: 1, id: "pl_x", name: "Jo" } })
  assert.deepEqual(saved.config.players, [{ id: "seat0", name: "Mia" }, { id: "pl_x", name: "Jo" }])
  assert.equal(replay(saved.config, saved.throws).winner, 0)
  assert.equal(saved.startedAt, new Date(T0 * 1000).toISOString())
})
