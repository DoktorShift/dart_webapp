import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, at, resetStorage } from "./storage-helpers.ts"
import { matchA } from "./storage-fixtures.ts"
import { addProfilePlayer, claimPlayer, claimSeat, profilePlayers } from "../lib/profile/claim.ts"
import { archiveFinished, loadArchive } from "../lib/storage/archive.ts"
import { assignPlayers, listPlayers, newPlayerRecord, savePlayers, seatName } from "../lib/storage/players.ts"

// A profile's player on this device keeps the name they play under: the public name lives in
// the profile, and setup finds the player by that name or, as "Du", by the profile itself.

beforeEach(resetStorage)

const ME = "c".repeat(64)

async function annaAndBen() {
  await savePlayers([newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), newPlayerRecord("Ben", "2026-09-01T10:00:00.000Z", BEN)])
  await archiveFinished(matchA(), undefined, at("2026-10-01T20:00:00.000Z"))
}

test("claiming a seat links the player and their games, and leaves their name alone", async () => {
  await annaAndBen()
  assert.equal(await claimSeat("match-a", 0, ME), true)
  const players = await listPlayers()
  assert.deepEqual(players.map((p) => [p.name, p.pubkey ?? null]).sort(), [
    ["Anna", ME],
    ["Ben", null],
  ])
  const games = await loadArchive()
  assert.deepEqual(games[0].players.map((p) => p.pubkey ?? null), [ME, null])
  // The next game, typed as "Anna" or seated as "Du", is hers.
  assert.equal(assignPlayers(["Anna", "Ben"], players).players[0].id, ANNA)
  assert.equal(assignPlayers(["Anna"], players, undefined, [ME]).players[0].id, ANNA)
  assert.equal(profilePlayers(ME, players, games).key, `id:${ANNA}`)
})

test("a player who belongs to another profile is never taken", async () => {
  await annaAndBen()
  await claimPlayer(ANNA, "d".repeat(64))
  assert.equal(await claimPlayer(ANNA, ME), false)
  assert.equal(await claimSeat("match-a", 0, ME), false)
})

test("a profile without a player here gets exactly one, however often or concurrently it is asked", async () => {
  await Promise.all([addProfilePlayer(ME, "Lena Müller-Lüdenscheidt"), addProfilePlayer(ME, "Lena Müller-Lüdenscheidt")])
  await addProfilePlayer(ME, "Lena")
  const mine = (await listPlayers()).filter((p) => p.pubkey === ME)
  assert.equal(mine.length, 1)
  // Named as a seat holds it; the full name stays in the profile.
  assert.equal(mine[0].name, "Lena Müller-Lüde")
  assert.equal(mine[0].name, seatName("Lena Müller-Lüdenscheidt"))
  // Nothing for a name that is no name.
  await addProfilePlayer("e".repeat(64), "Spieler 2")
  assert.equal((await listPlayers()).length, 1)
})

test("a seat holds 16 characters of a name, without a trailing space", () => {
  assert.equal(seatName("  Anna  "), "Anna")
  assert.equal(seatName("Maximilian Alexander Friedrich"), "Maximilian Alexa")
  assert.equal(seatName("Johanna Schmidt von Testhausen"), "Johanna Schmidt")
})
