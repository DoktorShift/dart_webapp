import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, at, resetStorage, saved } from "./storage-helpers.ts"
import { config, dart, play } from "./helpers.ts"
import { newDevice, switchTo, type Device } from "./support/devices.ts"
import { FakeNetwork, type FakeRelay } from "./support/fake-relay.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { importLocalKey, signOut } from "../lib/profile/session.ts"
import { dataKeySlot } from "../lib/protocol/private.ts"
import { archiveFinished, unarchive, type ArchivedMatch } from "../lib/storage/archive.ts"
import { closeDatabase, dbGetAll, kvGet } from "../lib/storage/db.ts"
import { newPlayerRecord, savePlayers, type PlayerRecord } from "../lib/storage/players.ts"
import { readV1Records } from "../lib/storage/v1.ts"
import { storedDataKey } from "../lib/sync/data-key.ts"
import { syncHistory } from "../lib/sync/engine.ts"
import { deliverNow, outboxStatus } from "../lib/sync/outbox.ts"
import { openRecords } from "../lib/sync/records.ts"

// The private history across devices (lib/sync/engine.ts) on in-memory relays: a new device
// finds the profile's games and nothing else, two devices that played offline end up with the
// same games without duplicates, deletions stay deleted, large records come in parts, relays
// that don't answer give "unavailable" or "partial" (never an empty history), and a data key
// made twice ends as one. Each device is its own IndexedDB and localStorage; they take turns.

const URLS = ["wss://one.example", "wss://two.example", "wss://three.example"]
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = URLS.join(",")
const network = new FakeNetwork()
const relays = URLS.map((url) => network.add(url))
Object.assign(globalThis, { WebSocket: network.WebSocket })

let core: Core
let secret: Uint8Array
let pubkey: string

before(async () => {
  core = await loadCore()
})

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
  secret = core.generateSecretKey()
  pubkey = core.getPublicKey(secret)
  for (const relay of relays) {
    relay.events = []
    relay.options = {}
  }
})

after(async () => {
  await signOut({ keepLocalData: true })
  relayClient().close()
})

// Makes `device` the one the app runs on, signed in with the test's profile.
async function on(device: Device) {
  await switchTo(device)
  await importLocalKey(secret)
}

// Sends everything waiting in this device's outbox.
async function send() {
  await deliverNow((await outboxStatus()).map((s) => s.id))
}

async function sync(full = true) {
  const result = await syncHistory(pubkey, { full })
  await send()
  return result
}

const profilePlayer = (): PlayerRecord => ({ ...newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), pubkey })
const person = (name: string, n: number) => ({ id: `pl_${n.toString(16).padStart(32, "0")}`, name })

// A won 101 (T20, 1, D20): seat 0 wins in three darts.
async function play101(id: string, seats: { id: string; name: string }[], finishedAt: string) {
  const c = config({ modeId: "301", modeName: "301", startScore: 101, players: seats })
  assert.ok(await archiveFinished(saved(c, play(c, [dart(20, 3), dart(1), dart(20, 2)]), id), undefined, at(finishedAt)))
}

const archive = async () => (await dbGetAll<ArchivedMatch>("matches")).sort((a, b) => (a.id < b.id ? -1 : 1))
const ids = async () => (await archive()).map((m) => m.id)
const privateEvents = (relay: FakeRelay) => relay.events.filter((e) => e.kind === 30078 && e.pubkey === pubkey)

async function opened(relay: FakeRelay) {
  const key = (await storedDataKey(pubkey))!.key
  return openRecords(privateEvents(relay), key, pubkey)
}

test("a new device finds the profile's games and players, and nothing of other people's games", async () => {
  const a = newDevice()
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-01T20:00:00.000Z")
  await play101("game-2", [person("Carl", 3), person("Dora", 4)], "2026-10-02T20:00:00.000Z")
  const first = await sync()
  assert.equal(first.state, "complete")

  // On every relay: the data key, the game and the players. Nothing readable without the key.
  for (const relay of relays) {
    assert.equal(privateEvents(relay).length, 3, relay.url)
    assert.ok(privateEvents(relay).every((e) => e.tags.length === 1 && e.tags[0][0] === "d" && /^[0-9a-f]{64}$/.test(e.tags[0][1])))
    // Records are the binary envelope (version 1, nonce, ciphertext), never JSON.
    for (const e of privateEvents(relay)) if (e.tags[0][1] !== dataKeySlot(pubkey)) assert.equal(Buffer.from(e.content, "base64")[0], 1)
  }
  const keyEvent = privateEvents(relays[0]).find((e) => e.tags[0][1] === dataKeySlot(pubkey))!
  // The data key is NIP-44 to the profile itself: the profile's key opens it, no other.
  const wrapped = JSON.parse(core.nip44.decrypt(keyEvent.content, core.nip44.getConversationKey(secret, pubkey)))
  assert.equal(wrapped.v, 1)
  assert.match(wrapped.key, /^[0-9a-f]{64}$/)

  const played = (await archive()).find((m) => m.id === "game-1")!
  const b = newDevice()
  await on(b)
  assert.deepEqual(await ids(), [])
  const result = await sync()
  assert.equal(result.state, "complete")
  assert.ok(result.lastSync)
  assert.deepEqual(await archive(), [played])
  const players = await dbGetAll<PlayerRecord>("players")
  assert.deepEqual(players.map((p) => [p.id, p.name, p.pubkey ?? null]).sort(), [
    [ANNA, "Anna", pubkey],
    [BEN, "Ben", null],
  ])
  // In 1.0.0's history too, like games played here.
  assert.deepEqual(readV1Records().map((r) => r.id), ["game-1"])
  // The data key is kept here, sealed, never as plain text.
  const stored = JSON.stringify(await kvGet("profile.data-key"))
  assert.ok(!stored.includes(wrapped.key))
  assert.equal(Buffer.from((await storedDataKey(pubkey))!.key).toString("hex"), wrapped.key)
})

test("two devices that played offline end up with the same games, each written once", async () => {
  const a = newDevice()
  const b = newDevice()
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-01T20:00:00.000Z")
  await sync()
  await on(b)
  await sync()

  // Both offline: relays don't answer, nothing is lost, nothing claims to be empty.
  for (const relay of relays) relay.options.mode = "down"
  for (const relay of relays) relay.dropAll()
  await on(a)
  await play101("game-2", [{ id: ANNA, name: "Anna" }, person("Carl", 3)], "2026-10-02T20:00:00.000Z")
  const offline = await sync(false)
  assert.equal(offline.state, "unavailable")
  assert.equal(offline.problem, "offline")
  await on(b)
  await play101("game-3", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-03T20:00:00.000Z")
  await sync(false)

  for (const relay of relays) relay.options.mode = "up"
  for (const device of [a, b, a]) {
    await on(device)
    assert.equal((await sync(false)).state, "complete")
  }
  for (const device of [a, b]) {
    await on(device)
    assert.deepEqual(await ids(), ["game-1", "game-2", "game-3"])
    assert.deepEqual((await dbGetAll<PlayerRecord>("players")).map((p) => p.name).sort(), ["Anna", "Ben", "Carl"])
  }
  // Every game once, in its first version: nothing was written twice.
  const { versions } = await opened(relays[0])
  const games = [...versions.values()].filter((v) => v.record.type === "match")
  assert.deepEqual(games.map((v) => [v.record.id, v.record.rev]).sort(), [
    ["match:game-1", 1],
    ["match:game-2", 1],
    ["match:game-3", 1],
  ])
})

test("a game deleted on one device goes on the others, and an old copy never brings it back", async () => {
  const [a, b, c] = [newDevice(), newDevice(), newDevice()]
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-01T20:00:00.000Z")
  await play101("game-2", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-02T20:00:00.000Z")
  await sync()
  await on(b)
  await sync()

  // The third relay misses the deletion.
  relays[2].options.mode = "down"
  relays[2].dropAll()
  await on(a)
  assert.ok(await unarchive("game-1"))
  await sync(false)
  const deletion = (await opened(relays[0])).versions.get("match:game-1")!
  assert.equal(deletion.data, null)
  assert.equal(deletion.record.rev, 2)

  await on(b)
  await sync(false)
  assert.deepEqual(await ids(), ["game-2"])
  assert.deepEqual(readV1Records().map((r) => r.id), ["game-2"])

  // A new device meets the old copy on the third relay and the deletion on the others: the game
  // stays deleted, and the third relay gets the deletion as soon as it is back.
  relays[2].options.mode = "up"
  await on(c)
  await sync()
  assert.deepEqual(await ids(), ["game-2"])
  assert.equal((await opened(relays[2])).versions.get("match:game-1")?.data, null)
  // Back on the device that deleted it, the next syncs bring nothing back.
  await on(a)
  await sync()
  assert.deepEqual(await ids(), ["game-2"])
})

test("a large player list goes in chained parts and arrives whole", async () => {
  const a = newDevice()
  await on(a)
  await savePlayers([profilePlayer()])
  let n = 10
  for (let g = 0; g < 12; g++) {
    const others = Array.from({ length: 5 }, () => person(`Spielerin mit einem ausgesprochen langen Vereinsnamen Nummer ${++n} aus dem Dartclub Blauer Pfeil`, n))
    await play101(`game-${g}`, [{ id: ANNA, name: "Anna" }, ...others], `2026-10-0${1 + (g % 9)}T20:00:00.000Z`)
  }
  await sync()
  const record = (await opened(relays[0])).versions.get("players")!
  assert.ok(record.record.parts, "split into parts")
  assert.ok(record.events.length > 1)
  const here = (await dbGetAll<PlayerRecord>("players")).map((p) => p.id).sort()

  const b = newDevice()
  await on(b)
  assert.equal((await sync()).state, "complete")
  assert.deepEqual((await dbGetAll<PlayerRecord>("players")).map((p) => p.id).sort(), here)
  assert.equal((await ids()).length, 12)
})

test("relays that don't answer: unavailable without any, partial with some; never an empty history", async () => {
  const a = newDevice()
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-01T20:00:00.000Z")
  await sync()

  const b = newDevice()
  await on(b)
  for (const relay of relays) {
    relay.options.mode = "down"
    relay.dropAll()
  }
  const none = await syncHistory(pubkey, { full: true })
  assert.deepEqual([none.state, none.problem, none.lastSync], ["unavailable", "offline", null])
  assert.deepEqual(await ids(), [])

  relays[1].options.mode = "up"
  const some = await syncHistory(pubkey, { full: true })
  assert.deepEqual([some.state, some.problem], ["partial", "offline"])
  assert.ok(some.lastSync)
  assert.deepEqual(await ids(), ["game-1"])
})

test("records signed while relays refuse them wait in the outbox across a reload, then arrive", async () => {
  const a = newDevice()
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-01T20:00:00.000Z")
  for (const relay of relays) relay.options.onEvent = () => [false, "error: try again later"]
  await sync()
  assert.ok((await outboxStatus()).every((s) => s.state === "waiting"))
  assert.equal(privateEvents(relays[0]).length, 0)

  await closeDatabase()
  for (const relay of relays) relay.options.onEvent = undefined
  await send()
  assert.equal((await outboxStatus()).length, 0)

  const b = newDevice()
  await on(b)
  assert.equal((await sync()).state, "complete")
  assert.deepEqual(await ids(), ["game-1"])
})

test("two data keys made apart end as one, and every game stays readable", async () => {
  const [a, b] = [newDevice(), newDevice()]
  // A's key and games never reach a relay before B looks.
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-a", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-01T20:00:00.000Z")
  for (const relay of relays) relay.options.onEvent = () => [false, "error: try again later"]
  await sync()
  for (const relay of relays) relay.options.onEvent = undefined

  await on(b)
  await savePlayers([profilePlayer()])
  await play101("game-b", [{ id: ANNA, name: "Anna" }, { id: BEN, name: "Ben" }], "2026-10-02T20:00:00.000Z")
  await sync()
  const keyOf = async () => Buffer.from((await storedDataKey(pubkey))!.key).toString("hex")
  const keyB = await keyOf()
  // Now A's waiting events arrive too.
  await on(a)
  assert.notEqual(await keyOf(), keyB)
  await send()

  for (let round = 0; round < 3; round++) {
    for (const device of [a, b]) {
      await on(device)
      await sync()
    }
  }
  const keys: string[] = []
  for (const device of [a, b]) {
    await on(device)
    assert.deepEqual(await ids(), ["game-a", "game-b"])
    keys.push(await keyOf())
  }
  assert.equal(keys[0], keys[1])
  // A new device reads everything with the one key that is left.
  await on(newDevice())
  assert.equal((await sync()).state, "complete")
  assert.deepEqual(await ids(), ["game-a", "game-b"])
})
