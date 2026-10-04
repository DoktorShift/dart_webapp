import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, resetStorage } from "./storage-helpers.ts"
import {
  assignImportedName,
  assignPlayers,
  findByName,
  findPlayerByName,
  importedAliases,
  isPlaceholderName,
  linkPubkey,
  listPlayers,
  nameKey,
  newPlayerId,
  newPlayerRecord,
  parsePlayerRecord,
  renamePlayer,
  resolvePlayers,
  savePlayers,
  type PlayerRecord,
} from "../lib/storage/players.ts"

beforeEach(resetStorage)

const T0 = "2026-09-01T10:00:00.000Z"
const anna = (over: Partial<PlayerRecord> = {}): PlayerRecord => ({ ...newPlayerRecord("Anna", T0, ANNA), ...over })

test("player ids are pl_ and 128 random bits, never repeated", () => {
  const ids = new Set(Array.from({ length: 2000 }, newPlayerId))
  assert.equal(ids.size, 2000)
  for (const id of ids) assert.match(id, /^pl_[0-9a-f]{32}$/)
})

test("names are compared trimmed, with single spaces and ignoring case", () => {
  assert.equal(nameKey("  Anna   Maria "), "anna maria")
  assert.equal(nameKey("ÄRGER"), "ärger")
  // The same letter written as one character or as letter plus accent is the same name.
  assert.equal(nameKey("José"), nameKey("José"))
})

test("seat numbers count as no name, in German and English", () => {
  for (const name of ["Spieler 1", "Player 2", "PLAYER 3", " spieler  12 "]) assert.equal(isPlaceholderName(name), true, name)
  for (const name of ["Spieler", "Spieler 1a", "Anna", "Player One", "1"]) assert.equal(isPlaceholderName(name), false, name)
})

test("setup: a known name keeps its id, a new name becomes a player, empty seats belong to nobody", () => {
  const { players, created } = assignPlayers(["  anna ", "Carla", "Spieler 3"], [anna()], new Date(T0))
  assert.equal(players[0].id, ANNA)
  assert.equal(players[0].name, "  anna ")
  assert.equal(created.length, 1)
  assert.equal(created[0].name, "Carla")
  assert.equal(players[1].id, created[0].id)
  assert.match(players[2].id, /^pl_[0-9a-f]{32}$/)
  // The seat never joins anyone: another game's "Spieler 3" is somebody else.
  const again = assignPlayers(["Spieler 3"], [anna(), ...created])
  assert.notEqual(again.players[0].id, players[2].id)
  assert.equal(again.created.length, 0)
})

test("two seats never share an id, even when names differ only in spacing", () => {
  const { players, created } = assignPlayers(["Anna  B", "Anna B"], [newPlayerRecord("Anna B", T0, ANNA)])
  assert.equal(players[0].id, ANNA)
  assert.notEqual(players[1].id, ANNA)
  assert.equal(created.length, 1)
})

test("when several players share a name, the one who played last is meant", () => {
  const older = anna({ lastPlayedAt: "2026-09-02T10:00:00.000Z" })
  const newer = { ...newPlayerRecord("anna", T0, BEN), lastPlayedAt: "2026-09-20T10:00:00.000Z" }
  assert.equal(findByName([older, newer], "ANNA")?.id, BEN)
  assert.equal(findByName([older, newer], "Spieler 1"), null)
})

test("the directory is stored, renamed and linked to a profile", async () => {
  await savePlayers([anna()])
  assert.equal((await findPlayerByName("anna"))?.id, ANNA)

  const renamed = await renamePlayer(ANNA, "Anna Maria")
  assert.equal(renamed?.id, ANNA)
  assert.equal((await findPlayerByName("anna maria"))?.id, ANNA)
  assert.equal(await findPlayerByName("anna"), null)
  assert.equal(await renamePlayer(ANNA, "Player 1"), null)
  assert.equal(await renamePlayer(BEN, "Ben"), null)

  const key = "f".repeat(64)
  assert.equal((await linkPubkey(ANNA, key))?.pubkey, key)
  assert.equal(await linkPubkey(ANNA, "npub1notahexkey"), null)
  assert.equal((await linkPubkey(ANNA, null))?.pubkey, undefined)
  assert.equal((await listPlayers()).length, 1)
})

test("finished games: legacy seat ids are looked up by name, new names added, spelling and last game kept", () => {
  const { resolved, records } = resolvePlayers(
    [
      { id: "pmut3p9eo0", name: "ANNA" },
      { id: "pmut3p9eo1", name: "Carla" },
      { id: "pmut3p9eo2", name: "Spieler 3" },
    ],
    [anna({ lastPlayedAt: "2026-09-05T10:00:00.000Z" })],
    "2026-09-10T20:00:00.000Z",
  )
  assert.equal(resolved[0].playerId, ANNA)
  assert.equal(resolved[0].unnamed, false)
  assert.equal(resolved[2].unnamed, true)
  const annaAfter = records.find((r) => r.id === ANNA)!
  assert.equal(annaAfter.name, "ANNA")
  assert.equal(annaAfter.lastPlayedAt, "2026-09-10T20:00:00.000Z")
  const carla = records.find((r) => r.name === "Carla")!
  assert.equal(resolved[1].playerId, carla.id)
  // The empty seat is never written to the directory.
  assert.equal(records.length, 2)
})

test("finished games: a setup id missing from the directory is added under that id", () => {
  const id = newPlayerId()
  const { resolved, records } = resolvePlayers([{ id, name: "Dora" }], [], T0)
  assert.equal(resolved[0].playerId, id)
  assert.deepEqual(records.map((r) => [r.id, r.name]), [[id, "Dora"]])
})

test("an imported name group counts for exactly one chosen player", async () => {
  await savePlayers([anna(), newPlayerRecord("Anna", T0, BEN)])
  assert.equal(await assignImportedName("Anna", ANNA), true)
  assert.deepEqual([...importedAliases(await listPlayers())], [["anna", ANNA]])
  await assignImportedName("anna", BEN)
  assert.deepEqual([...importedAliases(await listPlayers())], [["anna", BEN]])
  await assignImportedName("Anna", null)
  assert.equal(importedAliases(await listPlayers()).size, 0)
  assert.equal(await assignImportedName("Anna", newPlayerId()), false)
})

test("player records from a file are checked", () => {
  assert.equal(parsePlayerRecord({ id: "p1", name: "Anna" }), null)
  assert.equal(parsePlayerRecord({ id: ANNA, name: "Spieler 1" }), null)
  assert.equal(parsePlayerRecord({ id: ANNA, name: 5 }), null)
  const parsed = parsePlayerRecord({ id: ANNA, name: "Anna ", nameKey: "wrong", pubkey: "xyz", createdAt: T0, extra: true })
  assert.deepEqual(parsed, { id: ANNA, name: "Anna", nameKey: "anna", createdAt: T0, updatedAt: T0 })
})
