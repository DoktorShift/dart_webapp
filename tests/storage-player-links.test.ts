import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, at, resetStorage } from "./storage-helpers.ts"
import { matchA } from "./storage-fixtures.ts"
import { archiveFinished } from "../lib/storage/archive.ts"
import { newPlayerRecord, savePlayers } from "../lib/storage/players.ts"
import { linkLocalPlayer, loadPlayerLinks, playerLinkAliases, unlinkLocalPlayer } from "../lib/storage/player-links.ts"
import { parseLinkOp, resolveLinkOps } from "../lib/storage/player-link-ops.ts"

const PUBKEY = "a".repeat(64)
beforeEach(resetStorage)

test("explicit local links can be reversed without changing player records", async () => {
  await savePlayers([newPlayerRecord("Ben", "2026-01-01", ANNA), { ...newPlayerRecord("Ben", "2026-01-01", BEN), pubkey: PUBKEY }])
  assert.equal(await linkLocalPlayer(ANNA, BEN), "linked")
  assert.equal(playerLinkAliases(await loadPlayerLinks()).get(ANNA), BEN)
  await unlinkLocalPlayer(ANNA)
  assert.deepEqual(await loadPlayerLinks(), {})
})

test("players who appear in the same game cannot be linked", async () => {
  await savePlayers([newPlayerRecord("Anna", "2026-01-01", ANNA), { ...newPlayerRecord("Ben", "2026-01-01", BEN), pubkey: PUBKEY }])
  await archiveFinished(matchA(), undefined, at("2026-10-01T20:00:00Z"))
  assert.equal(await linkLocalPlayer(ANNA, BEN), "conflict")
  assert.deepEqual(await loadPlayerLinks(), {})
})

test("linked games count together and become separate again when unlinked", async () => {
  const { archivedAt } = await import("./storage-fixtures.ts")
  const { dbPut } = await import("../lib/storage/db.ts")
  const { computeStandings } = await import("../lib/storage/stats.ts")
  const opponent = `pl_${"c".repeat(32)}`
  await savePlayers([newPlayerRecord("Ben", "2026-01-01", ANNA), { ...newPlayerRecord("Ben", "2026-01-01", BEN), pubkey: PUBKEY }, newPlayerRecord("Carla", "2026-01-01", opponent)])
  const game = archivedAt(matchA(), "2026-10-01T20:00:00Z")
  const guestGame = { ...game, id: "guest-game", players: game.players.map((p, i) => ({ ...p, playerId: i === 0 ? ANNA : opponent })) }
  const profileGame = { ...game, id: "profile-game", players: game.players.map((p, i) => ({ ...p, playerId: i === 0 ? BEN : opponent, ...(i === 0 ? { pubkey: PUBKEY } : {}) })) }
  await dbPut("matches", [guestGame, profileGame])
  assert.equal(await linkLocalPlayer(ANNA, BEN), "linked")
  const merged = computeStandings([guestGame, profileGame], { minGames: 1, sameAs: playerLinkAliases(await loadPlayerLinks()) })
  assert.equal(merged.ranked.find((row) => row.key === `id:${BEN}`)?.games, 2)
  await unlinkLocalPlayer(ANNA)
  const separate = computeStandings([guestGame, profileGame], { minGames: 1, sameAs: playerLinkAliases(await loadPlayerLinks()) })
  assert.equal(separate.ranked.find((row) => row.key === `id:${ANNA}`)?.games, 1)
  assert.equal(separate.ranked.find((row) => row.key === `id:${BEN}`)?.games, 1)
})

test("a later game containing both identities suspends their association", async () => {
  const { archivedAt } = await import("./storage-fixtures.ts")
  const game = archivedAt(matchA(), "2026-10-01T20:00:00Z")
  const both = { ...game, players: game.players.map((p, i) => ({ ...p, playerId: i === 0 ? ANNA : BEN })) }
  const aliases = playerLinkAliases({ [ANNA]: BEN }, undefined, [both])
  assert.equal(aliases.has(ANNA), false)
})

test("a link is suspended when its guest later belongs to a profile", () => {
  const guest = { ...newPlayerRecord("Ben", "2026-01-01", ANNA), pubkey: "b".repeat(64) }
  const target = { ...newPlayerRecord("Ben", "2026-01-01", BEN), pubkey: PUBKEY }
  assert.equal(playerLinkAliases({ [ANNA]: BEN }, undefined, [], undefined, [guest, target]).has(ANNA), false)
})

test("concurrent removal wins; only a later explicit association restores it", () => {
  const guest = newPlayerRecord("Ben", "2026-01-01", ANNA)
  const profile = { ...newPlayerRecord("Ben", "2026-01-01", BEN), pubkey: PUBKEY }
  const op = (id: string, target: string | null, seen: string[]) => parseLinkOp({ id: id.repeat(32), source: ANNA, target, seen, ...(target ? { sourcePlayer: guest, targetPlayer: profile } : {}) })!
  const add = op("1", BEN, [])
  const remove = op("2", null, [add.id])
  const concurrent = op("3", BEN, [add.id])
  assert.deepEqual(resolveLinkOps([add, remove, concurrent]), {})
  const explicitAgain = op("4", BEN, [add.id, remove.id, concurrent.id])
  assert.deepEqual(resolveLinkOps([add, remove, concurrent, explicitAgain]), { [ANNA]: BEN })
  assert.deepEqual(resolveLinkOps([explicitAgain, concurrent, remove, add]), { [ANNA]: BEN })
})

test("a device export restores guest associations and remains compatible with older files", async () => {
  const { buildExport, importData, wipeAllData } = await import("../lib/storage/data.ts")
  await savePlayers([newPlayerRecord("Ben", "2026-01-01", ANNA), { ...newPlayerRecord("Ben", "2026-01-01", BEN), pubkey: PUBKEY }])
  assert.equal(await linkLocalPlayer(ANNA, BEN), "linked")
  const backup = await buildExport()
  assert.equal(backup.playerLinks?.guest[ANNA], BEN)
  await wipeAllData()
  assert.equal((await importData(JSON.stringify(backup))).ok, true)
  assert.deepEqual(await loadPlayerLinks(), { [ANNA]: BEN })
  const old = { ...backup, playerLinks: undefined }
  assert.equal((await importData(JSON.stringify(old))).ok, true)
})
