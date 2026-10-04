import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, at, localStore, resetStorage, saved } from "./storage-helpers.ts"
import { A_CONFIG, matchA, matchB, matchD, matchE, recordC } from "./storage-fixtures.ts"
import { dart, play } from "./helpers.ts"
import { ENGINE_VERSION, replay } from "../lib/game/engine.ts"
import {
  archiveFinished,
  clearLeaderboard,
  importV1Matches,
  loadArchive,
  unarchive,
  V1_SNAPSHOT_KEY,
  type ArchivedMatch,
  type V1Snapshot,
} from "../lib/storage/archive.ts"
import { dbGet, dbGetAll, kvGet, onStorageChange } from "../lib/storage/db.ts"
import { listPlayers, newPlayerRecord, savePlayers } from "../lib/storage/players.ts"
import { V1_KEYS } from "../lib/storage/v1.ts"

beforeEach(resetStorage)

const v1 = () => JSON.parse(localStore.getItem(V1_KEYS.matches) ?? "[]") as Record<string, unknown>[]
const stored = (id: string) => dbGet<ArchivedMatch>("matches", id)

test("a won game is archived whole: rules, throw log, players by id, engine version", async () => {
  await savePlayers([newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA)])
  const match = matchA()
  assert.equal(await archiveFinished(match, undefined, at("2026-10-01T20:00:00.000Z")), true)
  const entry = (await stored(match.id))!
  assert.equal(entry.source, "local")
  assert.equal(entry.schemaVersion, 1)
  assert.equal(entry.engineVersion, ENGINE_VERSION)
  assert.deepEqual(entry.config, match.config)
  assert.deepEqual(entry.throws, match.throws)
  assert.equal(entry.startedAt, match.startedAt)
  assert.equal(entry.finishedAt, "2026-10-01T20:00:00.000Z")
  assert.deepEqual(
    entry.players.map((p) => [p.playerId, p.name, p.won, p.darts, p.points]),
    [
      [ANNA, "Anna", true, 6, 301],
      [match.config.players[1].id, "Ben", false, 3, 60],
    ],
  )
  // Both players are in the directory now, with the game as their last one.
  assert.deepEqual(
    (await listPlayers()).map((p) => [p.name, p.lastPlayedAt]).sort(),
    [
      ["Anna", "2026-10-01T20:00:00.000Z"],
      ["Ben", "2026-10-01T20:00:00.000Z"],
    ],
  )
})

test("archiving again (every render, every reload) keeps the first finish time and writes nothing", async () => {
  const match = matchA()
  await archiveFinished(match, undefined, at("2026-10-01T20:00:00.000Z"))
  const writes: string[][] = []
  const stop = onStorageChange((m) => m.type === "change" && writes.push(m.stores))
  const before = localStore.getItem(V1_KEYS.matches)
  // A reload on the result screen: a new page, the same game.
  await archiveFinished(structuredClone(match), undefined, at("2026-10-01T20:05:00.000Z"))
  await archiveFinished(match, replay(match.config, match.throws), at("2026-10-02T09:00:00.000Z"))
  stop()
  assert.deepEqual(writes, [])
  assert.equal(localStore.getItem(V1_KEYS.matches), before)
  assert.equal((await stored(match.id))!.finishedAt, "2026-10-01T20:00:00.000Z")
  assert.equal((await dbGetAll("matches")).length, 1)
})

test("games with two or more players are also written in the 1.0.0 format", async () => {
  const match = matchA()
  await archiveFinished(match, undefined, at("2026-10-01T20:00:00.000Z"))
  assert.deepEqual(v1(), [
    {
      id: match.id,
      finishedAt: "2026-10-01T20:00:00.000Z",
      modeId: "301",
      modeName: "301",
      modeType: "x01",
      players: [
        { name: "Anna", won: true, darts: 6, points: 301 },
        { name: "Ben", won: false, darts: 3, points: 60 },
      ],
    },
  ])
})

test("a correction on the result screen updates the game, keeps its finish time and its place", async () => {
  const match = matchA()
  await archiveFinished(matchB(), undefined, at("2026-10-01T19:00:00.000Z"))
  await archiveFinished(match, undefined, at("2026-10-01T20:00:00.000Z"))
  // Ben's first visit was 20 20 19, not 20 20 20; Anna still wins.
  const corrected = { ...match, throws: match.throws.map((t, i) => (i === 5 ? { ...t, kind: "dart" as const, dart: { segment: 19, multiplier: 1 as const }, edited: true } : t)) }
  await archiveFinished(corrected, undefined, at("2026-10-01T20:03:00.000Z"))
  const entry = (await stored(match.id))!
  assert.equal(entry.finishedAt, "2026-10-01T20:00:00.000Z")
  assert.equal(entry.players[1].points, 59)
  assert.deepEqual(
    v1().map((r) => [r.id, (r.players as { points: number }[])[1].points]),
    [
      [match.id, 59],
      ["match-b", 301],
    ],
  )
})

test("undoing the winning dart takes the game off again, everywhere", async () => {
  const match = matchA()
  await archiveFinished(match)
  assert.equal(await unarchive(match.id), true)
  assert.equal(await stored(match.id), undefined)
  assert.deepEqual(v1(), [])
  // Winning it again later is a new finish.
  await archiveFinished(match, undefined, at("2026-10-01T21:00:00.000Z"))
  assert.equal((await stored(match.id))!.finishedAt, "2026-10-01T21:00:00.000Z")
  // Nothing to take off is fine too.
  assert.equal(await unarchive("never-archived"), true)
})

test("an unfinished game is never archived", async () => {
  const unfinished = saved(A_CONFIG, play(A_CONFIG, [dart(20), dart(20)]), "open")
  assert.equal(await archiveFinished(unfinished), true)
  assert.deepEqual(await dbGetAll("matches"), [])
})

test("solo games go into the archive but not into 1.0.0's history", async () => {
  await archiveFinished(matchE())
  assert.equal((await stored("match-e"))!.players.length, 1)
  assert.equal(localStore.getItem(V1_KEYS.matches), null)
})

test("1.0.0 results are taken over once, as imported totals without throws", async () => {
  const seat = { ...recordC(), id: "older", players: [{ name: "Spieler 1", won: true, darts: 9, points: 301 }, { name: "Ben", won: false, darts: 9, points: 200 }] }
  localStore.setItem(V1_KEYS.matches, JSON.stringify([recordC(), seat]))
  assert.equal(await importV1Matches(at("2026-10-04T08:00:00.000Z")), 2)
  assert.equal(await importV1Matches(), 0)
  const entry = (await stored(recordC().id))!
  assert.equal(entry.source, "imported-v1")
  assert.equal(entry.config, null)
  assert.equal(entry.throws, null)
  assert.equal(entry.engineVersion, null)
  assert.equal(entry.finishedAt, recordC().finishedAt)
  assert.deepEqual(entry.players[0], { playerId: null, name: "Anna", won: true, darts: 18, points: 501 })
  assert.equal((await stored("older"))!.players[0].unnamed, true)
  // The 1.0.0 history itself is never changed by taking it over.
  assert.equal(localStore.getItem(V1_KEYS.matches), JSON.stringify([recordC(), seat]))
})

test("games this version wrote to 1.0.0's history are not taken over a second time", async () => {
  await archiveFinished(matchA())
  assert.equal(await importV1Matches(), 0)
  assert.equal((await stored("match-a"))!.source, "local")
})

test("a game finished in a tab still running 1.0.0 is taken over", async () => {
  await archiveFinished(matchA())
  const older = JSON.parse(localStore.getItem(V1_KEYS.matches)!)
  localStore.setItem(V1_KEYS.matches, JSON.stringify([recordC(), ...older]))
  assert.equal(await importV1Matches(), 1)
  assert.deepEqual((await loadArchive()).map((m) => [m.id, m.source]), [
    ["match-a", "local"],
    [recordC().id, "imported-v1"],
  ])
})

test("a 1.0.0 game reopened in this version replaces its imported totals and keeps its finish time", async () => {
  const match = matchA()
  localStore.setItem(V1_KEYS.matches, JSON.stringify([{ ...recordC(), id: match.id, finishedAt: "2026-09-30T22:00:00.000Z" }]))
  await importV1Matches()
  await archiveFinished(match, undefined, at("2026-10-04T08:00:00.000Z"))
  const entry = (await stored(match.id))!
  assert.equal(entry.source, "local")
  assert.equal(entry.finishedAt, "2026-09-30T22:00:00.000Z")
  assert.equal(v1().length, 1)
})

test("players of games from 1.0.0 (seat-only ids) are found by name", async () => {
  await savePlayers([newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA)])
  const legacy = { ...matchA(), config: { ...A_CONFIG, players: [{ id: "pmut3p9eo0", name: "anna" }, { id: "pmut3p9eo1", name: "Spieler 2" }] } }
  await archiveFinished(legacy)
  const entry = (await stored(legacy.id))!
  assert.equal(entry.players[0].playerId, ANNA)
  assert.equal(entry.players[1].unnamed, true)
  assert.match(entry.players[1].playerId!, /^pl_[0-9a-f]{32}$/)
  // The seat is not a player of the directory; Anna's spelling follows the latest game.
  assert.deepEqual((await listPlayers()).map((p) => p.name), ["anna"])
})

test("entries in 1.0.0's history this version doesn't understand are kept", async () => {
  const strange = [{ id: "x", note: "from a future version" }, "text", null]
  localStore.setItem(V1_KEYS.matches, JSON.stringify(strange))
  await archiveFinished(matchA())
  await unarchive("x-other")
  assert.deepEqual(v1().slice(1), strange)
})

test("everything is shown even before 1.0.0 results are taken over", async () => {
  localStore.setItem(V1_KEYS.matches, JSON.stringify([recordC()]))
  await archiveFinished(matchD(), undefined, at("2026-10-01T20:00:00.000Z"))
  const shown = await loadArchive()
  assert.deepEqual(shown.map((m) => [m.id, m.source]), [
    ["match-d", "local"],
    [recordC().id, "imported-v1"],
  ])
})

test("resetting the Rangliste removes games with two or more players, keeps solo games", async () => {
  await archiveFinished(matchA())
  await archiveFinished(matchE())
  localStore.setItem(V1_KEYS.matches, JSON.stringify([...v1(), recordC()]))
  await importV1Matches()
  assert.equal(await clearLeaderboard(), true)
  assert.deepEqual((await dbGetAll<ArchivedMatch>("matches")).map((m) => m.id), ["match-e"])
  assert.deepEqual(v1(), [])
  assert.deepEqual((await loadArchive()).map((m) => m.id), ["match-e"])
})

test("a failed write is reported, never passed off as saved", async () => {
  localStore.failWrites = true
  assert.equal(await archiveFinished(matchA()), false)
  // The database still got the game; 1.0.0's copy is what failed.
  assert.ok(await stored("match-a"))
  localStore.failWrites = false
  assert.equal(await archiveFinished(matchA()), true)
  assert.equal(v1().length, 1)
})

test("quick undo after the winning dart never leaves the game archived", async () => {
  const match = matchA()
  const first = archiveFinished(match)
  const second = unarchive(match.id)
  await Promise.all([first, second])
  assert.equal(await stored(match.id), undefined)
  assert.deepEqual(v1(), [])
})

test("before the first write, every 1.0.0 key is kept once exactly as it was", async () => {
  const history = JSON.stringify([recordC()])
  localStore.setItem(V1_KEYS.matches, history)
  localStore.setItem(V1_KEYS.language, "en")
  // The first write of this version: a finished game (1.0.0's history changes right after).
  await archiveFinished(matchA(), undefined, at("2026-10-04T08:00:00.000Z"))
  const snapshot = (await kvGet<V1Snapshot>(V1_SNAPSHOT_KEY))!
  assert.equal(snapshot.takenAt, "2026-10-04T08:00:00.000Z")
  assert.equal(snapshot.raw[V1_KEYS.matches], history)
  assert.equal(snapshot.raw[V1_KEYS.language], "en")
  assert.equal(snapshot.raw[V1_KEYS.settings], null)
  assert.notEqual(localStore.getItem(V1_KEYS.matches), history)
  // Never replaced later.
  await importV1Matches(at("2026-10-05T08:00:00.000Z"))
  await archiveFinished(matchB(), undefined, at("2026-10-05T09:00:00.000Z"))
  assert.deepEqual(await kvGet<V1Snapshot>(V1_SNAPSHOT_KEY), snapshot)
})

test("a device that never ran 1.0.0 has nothing to keep", async () => {
  await importV1Matches()
  assert.equal(await kvGet(V1_SNAPSHOT_KEY), undefined)
})
