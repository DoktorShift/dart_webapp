import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { config, dart, play } from "./helpers.ts"
import { confirmedCopies, type ClubGame } from "../lib/clubs/games.ts"
import { agreementFor } from "../lib/live/content.ts"
import { keepCopies, keepCopy, type Played, type Wanted } from "../lib/live/copy.ts"
import { deletedMatches, loadArchive } from "../lib/storage/archive.ts"
import { listPlayers, newPlayerRecord, savePlayers } from "../lib/storage/players.ts"
import { encodeThrows } from "../lib/protocol/throws.ts"
import { profileRecords } from "../lib/sync/history.ts"

// The player's own copy of a game scored elsewhere (lib/live/copy.ts): one game per match however
// often it is kept, under the profile's player, carried by the private history, and following the
// record it rests on (a correction replaces it, a withdrawal takes it out).

const BEN = "b".repeat(64)
const MATCH = "f".repeat(64)
const T = 1_800_000_000
const c = config({ startScore: 40, players: [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }] })
const won = play(c, [dart(20, 2)])
const played = (throws = won): Played => ({ agreement: agreementFor(c), throws: encodeThrows(throws), finishedAt: T, seat: 1, profile: BEN })
const wanted = (record: string | null, game: Played | null = played()): Wanted => ({ match: MATCH, record, played: () => game })

beforeEach(async () => {
  await resetStorage()
  await savePlayers([{ ...newPlayerRecord("Benny", "2026-10-01T00:00:00.000Z", `pl_${"1".repeat(32)}`), pubkey: BEN }])
})

test("a confirmed game is kept once, as the profile's player's game, and the private history carries it", async () => {
  await keepCopies(BEN, [wanted("r1")])
  await keepCopies(BEN, [wanted("r1")])
  // A second device of the profile, or a copy taken over from it: still the same one game.
  assert.equal(await keepCopy(null, wanted("r1"), BEN), "r1")
  const games = await loadArchive()
  assert.equal(games.length, 1)
  assert.equal(games[0].id, MATCH)
  assert.equal(games[0].finishedAt, new Date(T * 1000).toISOString())
  assert.equal(games[0].players[1].name, "Benny")
  assert.equal(games[0].players[1].pubkey, BEN)
  assert.equal(games[0].players[1].won, false)
  assert.ok(profileRecords(BEN, games, await listPlayers()).has(`match:${MATCH}`))
})

test("a correction replaces the copy, a withdrawal takes it out, and an unreadable game waits", async () => {
  await keepCopies(BEN, [wanted("r1")])
  const corrected = play(c, [dart(20, 1), dart(10, 1), dart(5, 2)])
  await keepCopies(BEN, [wanted("r2", played(corrected))])
  assert.deepEqual((await loadArchive()).map((m) => m.throws), [JSON.parse(JSON.stringify(corrected))])

  // A newer record whose game can't be read yet leaves the copy as it is.
  await keepCopies(BEN, [wanted("r3", null)])
  assert.deepEqual((await loadArchive()).map((m) => m.throws), [JSON.parse(JSON.stringify(corrected))])

  await keepCopies(BEN, [wanted(null)])
  assert.deepEqual(await loadArchive(), [])
  assert.deepEqual(await deletedMatches(), [{ id: MATCH, by: BEN }], "a deletion the profile's other devices follow")

  // Matches not named keep their copies.
  await keepCopies(BEN, [wanted("r1")])
  await keepCopies(BEN, [])
  assert.equal((await loadArchive()).length, 1)
})

test("a club game is the player's own once they confirmed its current result", () => {
  const anna = "a".repeat(64)
  const game: ClubGame = {
    match: MATCH,
    by: anna,
    named: T,
    agreement: { ...agreementFor(c), seats: [{ alias: "Anna", pubkey: anna }, { alias: "Ben", pubkey: BEN }] },
    authority: anna,
    result: { event: "r1", by: anna, at: T, winner: 0, legs: [1, 0], throws: encodeThrows(won), finishedAt: T - 5 },
    revisedAt: null,
    confirmations: {},
  }
  const recordOf = (g: ClubGame, pubkey: string) => confirmedCopies([g], pubkey).map((w) => w.record)
  assert.deepEqual(recordOf(game, BEN), [null], "not confirmed yet")
  const confirmed = { ...game, confirmations: { 1: { verdict: "confirm" as const, event: "v1", at: T + 1, pubkey: BEN } } }
  assert.deepEqual(recordOf(confirmed, BEN), ["r1"])
  assert.deepEqual(confirmedCopies([confirmed], BEN)[0].played(), { agreement: confirmed.agreement, throws: encodeThrows(won), finishedAt: T - 5, seat: 1, profile: BEN })
  assert.deepEqual(recordOf({ ...confirmed, confirmations: { 1: { ...confirmed.confirmations[1], verdict: "dispute" } } }, BEN), [null])
  assert.deepEqual(recordOf({ ...confirmed, result: null }, BEN), [null], "voided")
  assert.deepEqual(recordOf(confirmed, anna), [null], "the one who recorded it has it already")
  assert.deepEqual(recordOf(confirmed, "c".repeat(64)), [], "not a player of it")
})
