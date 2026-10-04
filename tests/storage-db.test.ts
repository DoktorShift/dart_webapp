import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import {
  closeDatabase,
  dbClear,
  dbDelete,
  dbGet,
  dbGetAll,
  dbKeys,
  dbPut,
  dbWrite,
  isStorageUnavailable,
  kvGet,
  kvSet,
  onStorageChange,
  storageUnavailable,
  STORES,
  type StorageMessage,
} from "../lib/storage/db.ts"

beforeEach(resetStorage)

// A record with an id and anything else.
const rec = (id: string, fields: Record<string, unknown> = {}) => ({ id, ...fields })

test("the database has the seven stores of decision 0002", async () => {
  assert.deepEqual([...STORES], ["matches", "players", "kv", "outbox", "payments", "objects", "pending"])
  for (const store of STORES) {
    await dbPut(store, { id: "x" })
    assert.deepEqual(await dbGet(store, "x"), { id: "x" })
  }
  assert.equal(await storageUnavailable(), false)
})

test("put, get, list sorted by id, keys, delete and clear", async () => {
  await dbPut("players", [rec("b", { n: 2 }), rec("a", { n: 1 })])
  assert.deepEqual(await dbGetAll("players"), [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
  ])
  assert.deepEqual(await dbKeys("players"), ["a", "b"])
  await dbDelete("players", "a")
  assert.equal(await dbGet("players", "a"), undefined)
  await dbClear("players")
  assert.deepEqual(await dbGetAll("players"), [])
})

test("a write across stores lands whole or not at all", async () => {
  await dbPut("matches", { id: "m1" })
  await assert.rejects(
    dbWrite([
      { store: "matches", delete: "m1" },
      { store: "players", put: { id: "p1" } },
      // A function can't be stored: the whole transaction must be cancelled.
      { store: "kv", put: rec("bad", { value: () => 1 }) },
    ]),
  )
  assert.deepEqual(await dbGet("matches", "m1"), { id: "m1" })
  assert.equal(await dbGet("players", "p1"), undefined)
})

test("putNew stores only what isn't there yet, inside the same transaction", async () => {
  await dbPut("matches", rec("full", { v: "local" }))
  await dbWrite([
    { store: "matches", putNew: rec("full", { v: "imported" }) },
    { store: "matches", putNew: rec("new", { v: "imported" }) },
  ])
  assert.deepEqual(await dbGetAll("matches"), [
    { id: "full", v: "local" },
    { id: "new", v: "imported" },
  ])
})

test("stored values are copies, not shared objects", async () => {
  const value = { id: "k", list: [1] }
  await dbPut("kv", value)
  value.list.push(2)
  assert.deepEqual(await dbGet("kv", "k"), { id: "k", list: [1] })
})

test("every write tells listeners which stores changed", async () => {
  const heard: StorageMessage[] = []
  const stop = onStorageChange((m) => heard.push(m))
  await dbWrite([
    { store: "matches", put: { id: "m" } },
    { store: "players", put: { id: "p" } },
  ])
  await dbClear("kv")
  stop()
  await dbPut("kv", { id: "after" })
  assert.deepEqual(heard, [
    { type: "change", stores: ["matches", "players"] },
    { type: "change", stores: ["kv"] },
  ])
})

test("small values by name", async () => {
  assert.equal(await kvGet("missing"), undefined)
  await kvSet("answer", { n: 42 })
  assert.deepEqual(await kvGet("answer"), { n: 42 })
})

test("without IndexedDB the same calls work on memory, and say so", async () => {
  await closeDatabase()
  Object.assign(globalThis, { indexedDB: undefined })
  await dbPut("matches", [{ id: "b" }, { id: "a" }])
  assert.deepEqual(await dbKeys("matches"), ["a", "b"])
  await dbWrite([{ store: "matches", putNew: rec("a", { changed: true }) }])
  assert.deepEqual(await dbGet("matches", "a"), { id: "a" })
  assert.equal(isStorageUnavailable(), true)
  assert.equal(await storageUnavailable(), true)
  await assert.rejects(dbWrite([{ store: "kv", put: rec("x", { value: Symbol("no") }) }]))
})

test("an IndexedDB that refuses to open falls back to memory", async () => {
  await closeDatabase()
  Object.assign(globalThis, {
    indexedDB: {
      open() {
        throw new DOMException("Blocked", "SecurityError")
      },
    },
  })
  await dbPut("kv", { id: "x" })
  assert.deepEqual(await dbGet("kv", "x"), { id: "x" })
  assert.equal(isStorageUnavailable(), true)
})
