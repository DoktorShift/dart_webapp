import { before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, at, resetStorage } from "./storage-helpers.ts"
import { matchA, matchB } from "./storage-fixtures.ts"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { claimPlayer, profilePlayers } from "../lib/profile/claim.ts"
import { statsCardOf } from "../lib/profile/stats-card.ts"
import { PROFILE_TYPES } from "../lib/protocol/profile.ts"
import { EMPTY_STATS_CARD, sharesNothing, type StatsCard } from "../lib/protocol/profile.ts"
import { readStatsCard, statsCardTemplate } from "../lib/protocol/stats-card.ts"
import { archiveFinished, loadArchive, type ArchivedMatch } from "../lib/storage/archive.ts"
import { dbPut } from "../lib/storage/db.ts"
import { importedAliases, listPlayers, newPlayerRecord, savePlayers } from "../lib/storage/players.ts"

// The stats card a player may share (docs/protocol/families/profile.md): raw counts of the
// profile's games on this device, nothing else, and readers that take only a valid card by its
// own author.

let core: Core
before(async () => {
  core = await loadCore()
})
beforeEach(resetStorage)

const ME = "c".repeat(64)

async function annasGames() {
  await savePlayers([newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), newPlayerRecord("Ben", "2026-09-01T10:00:00.000Z", BEN)])
  await archiveFinished(matchA(), undefined, at("2026-10-01T20:00:00.000Z"))
  await archiveFinished(matchB(), undefined, at("2026-10-02T20:00:00.000Z"))
  await claimPlayer(ANNA, ME)
}

async function cardOf() {
  const [matches, players] = await Promise.all([loadArchive(), listPlayers()])
  const me = profilePlayers(ME, players, matches)
  return statsCardOf(matches, me.key, { aliases: importedAliases(players), sameAs: me.sameAs })
}

test("the card counts the profile's games and nothing else", async () => {
  await annasGames()
  // Worked out by hand in tests/storage-fixtures.ts: Anna won A (6 darts, 301 points, checkout
  // 121, one 180), lost B (9 darts, 201 points).
  assert.deepEqual(await cardOf(), {
    x01: { games: 2, versus: 2, wins: 1, darts: 15, points: 502, highestFinish: 121, bestLeg: 6, visits180: 1, checkouts: 1, dartsAtDouble: 1 },
    cricket: null,
    clock: null,
    refs: [],
  })
})

test("a profile played on two devices counts as one player", async () => {
  await annasGames()
  // A game from the other device: its own player id for the profile, marked with the profile.
  const other = (await loadArchive()).find((m) => m.id === "match-a")!
  const elsewhere = `pl_${"d".repeat(32)}`
  const copy: ArchivedMatch = { ...other, id: "match-a-elsewhere", players: other.players.map((p, i) => (i === 0 ? { ...p, playerId: elsewhere, pubkey: ME } : p)) }
  await dbPut("matches", copy)
  const card = await cardOf()
  assert.equal(card.x01?.games, 3)
  assert.equal(card.x01?.wins, 2)
})

test("without games, or without a player here, the card shares nothing", async () => {
  assert.deepEqual(await cardOf(), EMPTY_STATS_CARD)
  assert.ok(sharesNothing(EMPTY_STATS_CARD))
})

test("a signed card reads back; another d or another author doesn't", async () => {
  const secret = core.generateSecretKey()
  const pubkey = core.getPublicKey(secret)
  const card: StatsCard = { x01: { games: 2, versus: 2, wins: 1, darts: 15, points: 502, highestFinish: 121, bestLeg: 6, visits180: 1 }, cricket: null, clock: null, refs: [] }
  const template = statsCardTemplate(card, 1_790_000_000)
  assert.equal(template.kind, 31180)
  assert.deepEqual(template.tags.slice(0, 4), [["L", "blueline"], ["l", "profile.stats", "blueline"], ["v", "1"], ["d", "stats"]])
  assert.ok(!template.tags.some((t) => t[0] === "e" || t[0] === "p"))
  const event = core.finalizeEvent(template, secret) as NostrEvent
  assert.deepEqual(readStatsCard(event, pubkey, 1_790_000_100), { card, createdAt: 1_790_000_000 })
  assert.equal(readStatsCard(event, "f".repeat(64), 1_790_000_100), null)
  const otherD = core.finalizeEvent({ ...template, tags: template.tags.map((t) => (t[0] === "d" ? ["d", "stats2"] : t)) }, secret)
  assert.equal(readStatsCard(otherD, pubkey, 1_790_000_100), null)
})

// Signatures are checked when events arrive (lib/nostr: every event from a relay is verified);
// the reader checks what a valid signature can still carry.
test("a card with impossible figures is never written or read", () => {
  const impossible: StatsCard = { ...EMPTY_STATS_CARD, cricket: { games: 1, versus: 1, wins: 2, darts: 9, marks: 3 } }
  assert.throws(() => statsCardTemplate(impossible, 1_790_000_000), /wins ≤ versus ≤ games/)
  const secret = core.generateSecretKey()
  const template = statsCardTemplate(EMPTY_STATS_CARD, 1_790_000_000)
  const event = core.finalizeEvent({ ...template, content: JSON.stringify(impossible) }, secret)
  assert.equal(readStatsCard(event, core.getPublicKey(secret), 1_790_000_100), null)
})

test("stats card: optional checkout counts, both or neither, checkouts within darts at double", () => {
  const base = { games: 2, versus: 2, wins: 1, darts: 15, points: 502, highestFinish: 121, bestLeg: 6, visits180: 1 }
  const schema = PROFILE_TYPES["profile.stats"].schema
  assert.doesNotThrow(() => schema.check({ x01: base, cricket: null, clock: null, refs: [] }, "card"))
  assert.doesNotThrow(() => schema.check({ x01: { ...base, checkouts: 3, dartsAtDouble: 7 }, cricket: null, clock: null, refs: [] }, "card"))
  assert.throws(() => schema.check({ x01: { ...base, checkouts: 3 }, cricket: null, clock: null, refs: [] }, "card"))
  assert.throws(() => schema.check({ x01: { ...base, checkouts: 8, dartsAtDouble: 7 }, cricket: null, clock: null, refs: [] }, "card"))
})
