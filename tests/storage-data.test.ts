import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, at, localStore, resetStorage } from "./storage-helpers.ts"
import { matchA, matchB, matchD, matchE, recordC } from "./storage-fixtures.ts"
import { archiveFinished, clearLeaderboard, fromV1Record, importV1Matches, loadArchive, type ArchivedMatch } from "../lib/storage/archive.ts"
import { buildExport, exportFileName, importData, wipeAllData, type ExportFile } from "../lib/storage/data.ts"
import { dbGetAll, dbPut, kvSet, onStorageChange, STORES, type StorageMessage } from "../lib/storage/db.ts"
import { listPlayers, newPlayerRecord, savePlayers } from "../lib/storage/players.ts"
import { V1_KEYS, V1_KEY_LIST } from "../lib/storage/v1.ts"

beforeEach(resetStorage)

// A device after an evening: three games here, one solo game, one result from 1.0.0, settings.
async function evening() {
  await savePlayers([newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA)])
  localStore.setItem(V1_KEYS.matches, JSON.stringify([recordC()]))
  localStore.setItem(V1_KEYS.settings, JSON.stringify({ sound: false, caller: true, entryMode: "visit", askAtDouble: true }))
  localStore.setItem(V1_KEYS.language, "en")
  localStore.setItem(V1_KEYS.theme, "light")
  await importV1Matches()
  let minute = 0
  for (const match of [matchA(), matchB(), matchD(), matchE()]) await archiveFinished(match, undefined, at(`2026-10-01T20:0${minute++}:00.000Z`))
}

const ids = (matches: ArchivedMatch[]) => matches.map((m) => m.id).sort()

test("the export holds every game, every player and the exact 1.0.0 texts", async () => {
  await evening()
  const file = await buildExport(at("2026-10-04T09:00:00.000Z"))
  assert.equal(file.format, "blueline-data")
  assert.equal(file.version, 1)
  assert.equal(file.exportedAt, "2026-10-04T09:00:00.000Z")
  assert.deepEqual(ids(file.matches), ["match-a", "match-b", "match-d", "match-e", recordC().id].sort())
  assert.deepEqual(file.players.map((p) => p.name).sort(), ["Anna", "Ben"])
  assert.deepEqual(Object.keys(file.v1).sort(), [...V1_KEY_LIST].sort())
  assert.equal(file.v1[V1_KEYS.language], "en")
  assert.equal(file.v1[V1_KEYS.theme], "light")
  assert.equal(file.v1[V1_KEYS.matches], localStore.getItem(V1_KEYS.matches))
  assert.equal(file.v1[V1_KEYS.currentMatch], null)
  // And as they were before this version first wrote anything.
  assert.equal(file.v1Snapshot?.raw[V1_KEYS.matches], JSON.stringify([recordC()]))
  // Plain JSON, readable by anything.
  assert.deepEqual(JSON.parse(JSON.stringify(file)), file)
})

test("export, delete everything, import: the same games and players come back", async () => {
  await evening()
  const text = JSON.stringify(await buildExport())
  const before = await loadArchive()
  const players = await listPlayers()
  const v1Before = JSON.parse(localStore.getItem(V1_KEYS.matches)!) as { id: string }[]

  assert.equal(await wipeAllData(), true)
  assert.deepEqual(await loadArchive(), [])

  const result = await importData(text)
  assert.deepEqual(result, { ok: true, added: 5, completed: 0, known: 0, playersAdded: 2, playersKnown: 0, skipped: 0 })
  assert.deepEqual(await loadArchive(), before)
  assert.deepEqual(await listPlayers(), players)
  // Games with two or more players are back in 1.0.0's history too (a rollback keeps them).
  const v1After = JSON.parse(localStore.getItem(V1_KEYS.matches)!) as { id: string }[]
  assert.deepEqual(v1After.map((r) => r.id).sort(), v1Before.map((r) => r.id).sort())
})

test("importing the same file again adds nothing", async () => {
  await evening()
  const text = JSON.stringify(await buildExport())
  assert.deepEqual(await importData(text), { ok: true, added: 0, completed: 0, known: 5, playersAdded: 0, playersKnown: 2, skipped: 0 })
})

test("the result tells things already here from entries that couldn't be read", async () => {
  await evening()
  const file = await buildExport()
  // Only players, all known here.
  assert.deepEqual(await importData(JSON.stringify({ ...file, matches: [] })), {
    ok: true,
    added: 0,
    completed: 0,
    known: 0,
    playersAdded: 0,
    playersKnown: 2,
    skipped: 0,
  })
  // Nothing readable at all.
  const unreadable = { ...file, matches: [{ id: 5 }], players: [{ ...file.players[0], name: "x".repeat(5000) }] }
  assert.deepEqual(await importData(JSON.stringify(unreadable)), {
    ok: true,
    added: 0,
    completed: 0,
    known: 0,
    playersAdded: 0,
    playersKnown: 0,
    skipped: 2,
  })
})

test("after resetting the Rangliste, an export holds none of its games", async () => {
  await evening()
  assert.equal(await clearLeaderboard(), true)
  const file = await buildExport()
  const text = JSON.stringify(file)
  for (const id of ["match-a", "match-b", "match-d", recordC().id]) assert.ok(!text.includes(id), id)
  // The solo game stays for personal statistics, the rest of the earlier copy as it was.
  assert.deepEqual(ids(file.matches), ["match-e"])
  assert.equal(file.v1Snapshot?.raw[V1_KEYS.matches], "[]")
  assert.equal(file.v1Snapshot?.raw[V1_KEYS.language], "en")
  assert.equal(file.v1[V1_KEYS.matches], "[]")
})

test("an imported 1.0.0 total is completed by the full game from a file", async () => {
  await archiveFinished(matchA(), undefined, at("2026-10-01T20:00:00.000Z"))
  const text = JSON.stringify(await buildExport())
  await resetStorage()
  // This device knows the game only from 1.0.0's history.
  localStore.setItem(V1_KEYS.matches, JSON.stringify([{ ...recordC(), id: "match-a" }]))
  await importV1Matches()
  const result = await importData(text)
  assert.equal(result.ok && result.completed, 1)
  const [entry] = await dbGetAll<ArchivedMatch>("matches")
  assert.equal(entry.source, "local")
  assert.ok(entry.throws && entry.throws.length > 0)
})

test("games and players already here are never overwritten by a file", async () => {
  await evening()
  const file = (await buildExport()) as ExportFile
  file.matches = file.matches.map((m) => ({ ...m, modeName: "Changed" }))
  file.players = file.players.map((p) => ({ ...p, name: "Changed" }))
  await importData(JSON.stringify(file))
  assert.ok((await loadArchive()).every((m) => m.modeName !== "Changed"))
  assert.ok((await listPlayers()).every((p) => p.name !== "Changed"))
})

test("files that aren't an export, or come from a newer version, are refused", async () => {
  assert.deepEqual(await importData("not json"), { ok: false, reason: "format" })
  assert.deepEqual(await importData("[]"), { ok: false, reason: "format" })
  assert.deepEqual(await importData(JSON.stringify({ format: "other", version: 1, matches: [], players: [] })), { ok: false, reason: "format" })
  assert.deepEqual(await importData(JSON.stringify({ format: "blueline-data", version: 1 })), { ok: false, reason: "format" })
  assert.deepEqual(await importData(JSON.stringify({ format: "blueline-data", version: 2, matches: [], players: [] })), { ok: false, reason: "newer" })
})

test("broken or forged entries are skipped and counted", async () => {
  const good = { ...fromV1Record(recordC()) }
  const full = await (async () => {
    await archiveFinished(matchA())
    return (await dbGetAll<ArchivedMatch>("matches"))[0]
  })()
  await resetStorage()
  const forged = { ...full, id: "forged", players: full.players.map((p) => ({ ...p, won: !p.won })) }
  const brokenLog = { ...full, id: "broken", throws: [null] }
  const tooMany = { ...good, id: "seven", players: Array.from({ length: 7 }, () => good.players[0]) }
  const text = JSON.stringify({
    format: "blueline-data",
    version: 1,
    matches: [good, full, forged, brokenLog, tooMany, { id: 5 }, "x"],
    players: [{ id: ANNA, name: "Anna" }, { id: "nope", name: "X" }],
  })
  const result = await importData(text)
  assert.deepEqual(result, { ok: true, added: 2, completed: 0, known: 0, playersAdded: 1, playersKnown: 0, skipped: 6 })
  assert.deepEqual(ids(await dbGetAll("matches")), ["match-a", recordC().id].sort())
})

test("deleting everything clears every 1.0.0 key and every store, and tells other tabs", async () => {
  await evening()
  localStore.setItem(V1_KEYS.currentMatch, "{}")
  localStore.setItem(V1_KEYS.lastPlayers, "[]")
  localStore.setItem(V1_KEYS.rules, "{}")
  localStore.setItem(V1_KEYS.lastGame, "{}")
  localStore.setItem("someone-else", "kept")
  for (const store of STORES) await dbPut(store, { id: `x-${store}` })
  await kvSet("note", 1)

  const heard: StorageMessage[] = []
  const stop = onStorageChange((m) => heard.push(m))
  assert.equal(await wipeAllData(), true)
  stop()

  for (const key of V1_KEY_LIST) assert.equal(localStore.getItem(key), null, key)
  assert.equal(localStore.getItem("someone-else"), "kept")
  for (const store of STORES) assert.deepEqual(await dbGetAll(store), [], store)
  assert.deepEqual(heard.at(-1), { type: "wipe" })
})

test("a wipe that fails part way says so, and only the other tabs are told to start fresh", async (t) => {
  await evening()
  const before = await loadArchive()
  t.mock.method(IDBObjectStore.prototype, "clear", () => {
    throw new DOMException("simulated", "UnknownError")
  })
  const heard: StorageMessage[] = []
  const stop = onStorageChange((m) => heard.push(m))
  const otherTab = new BroadcastChannel("blueline")
  t.after(() => otherTab.close())
  const elsewhere = new Promise((resolve) => (otherTab.onmessage = (event) => resolve(event.data)))

  assert.equal(await wipeAllData(), false)
  stop()
  // This tab stays, to show that not everything was deleted ...
  assert.deepEqual(heard, [])
  // ... while other tabs start fresh, so they can't write back what is gone.
  assert.deepEqual(await elsewhere, { type: "wipe" })
  assert.deepEqual(await loadArchive(), before)
  for (const key of V1_KEY_LIST) assert.equal(localStore.getItem(key), null, key)
})

test("file names carry the date", () => {
  assert.equal(exportFileName("blueline-daten", new Date(2026, 9, 4, 23, 30)), "blueline-daten-2026-10-04.json")
})
