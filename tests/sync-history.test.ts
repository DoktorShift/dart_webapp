import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, at, resetStorage, saved } from "./storage-helpers.ts"
import { config, dart, play } from "./helpers.ts"
import { newDevice, switchTo, type Device } from "./support/devices.ts"
import { FakeNetwork, type FakeRelay } from "./support/fake-relay.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { createLocalSigner } from "../lib/nostr/signers.ts"
import { adjustClock } from "../lib/nostr/time.ts"
import { addThisDevice, DEVICES_RECORD } from "../lib/devices/list.ts"
import { importLocalKey, signOut } from "../lib/profile/session.ts"
import { dataKeySlot, recordSlot } from "../lib/protocol/private.ts"
import { archiveFinished, clearLeaderboard, deletedMatches, unarchive, type ArchivedMatch } from "../lib/storage/archive.ts"
import { closeDatabase, dbGetAll, dbKeys, kvGet } from "../lib/storage/db.ts"
import { newPlayerRecord, savePlayers, type PlayerRecord } from "../lib/storage/players.ts"
import { readV1Records } from "../lib/storage/v1.ts"
import { DataKeyError, isDataKeyEvent, storedDataKey, unwrapDataKey } from "../lib/sync/data-key.ts"
import { syncHistory } from "../lib/sync/engine.ts"
import { deliverNow, outboxStatus } from "../lib/sync/outbox.ts"
import { openRecords } from "../lib/sync/records.ts"
import { linkLocalPlayer, loadPlayerLinks, unlinkLocalPlayer } from "../lib/storage/player-links.ts"

// The private history across devices (lib/sync/engine.ts) on in-memory relays: a new device
// finds the profile's games and nothing else, two devices that played offline end up with the
// same games without duplicates, deletions stay deleted (a reset of the Rangliste is no deletion),
// large records come in parts, relays that don't answer give "unavailable" or "partial" (never an
// empty history), a data key made twice ends as one and is only ever the profile's own, a device
// whose clock runs behind still writes versions relays keep, one whose clock runs ahead still
// finds new games, and a sync whose session ends keeps nothing. Each device is its own IndexedDB
// and localStorage; they take turns.

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
  adjustClock(new Date())
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

// One sync without sending, on the device's clock. The session stays signed in, so it never ends
// without a result.
async function syncOnly(full: boolean, now?: () => number) {
  const result = await syncHistory(pubkey, { full }, now)
  assert.ok(result, "the sync ran for the signed-in session")
  return result
}

async function sync(full = true, now?: () => number) {
  const result = await syncOnly(full, now)
  await send()
  return result
}

const profilePlayer = (): PlayerRecord => ({ ...newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), pubkey })
const person = (name: string, n: number) => ({ id: `pl_${n.toString(16).padStart(32, "0")}`, name })
const annaBen = [
  { id: ANNA, name: "Anna" },
  { id: BEN, name: "Ben" },
]

test("player associations and offline removals follow only their profile, without sharing unrelated games", async () => {
  const a = newDevice(), b = newDevice()
  const guest = newPlayerRecord("Ben", "2026-09-01", BEN)
  const targetId = `pl_${"c".repeat(32)}`
  const target = { ...newPlayerRecord("Ben", "2026-09-01", targetId), pubkey: "b".repeat(64) }
  await on(a)
  await savePlayers([profilePlayer(), guest, target])
  await play101("unrelated", [person("Carl", 3), person("Dora", 4)], "2026-10-02T20:00:00.000Z")
  assert.equal(await linkLocalPlayer(BEN, targetId), "linked")
  await sync()
  assert.ok(privateEvents(relays[0]).every((event) => !event.content.includes(BEN)))

  await on(b)
  await sync()
  assert.deepEqual(await loadPlayerLinks(), { [BEN]: targetId })
  assert.deepEqual(await ids(), [])
  assert.ok((await dbGetAll<PlayerRecord>("players")).some((p) => p.id === targetId))
  await unlinkLocalPlayer(BEN)
  for (const relay of relays) relay.options.mode = "down"
  await Promise.all(relays.map((relay) => relay.dropAll()))
  assert.equal((await sync(false)).state, "unavailable")
  assert.deepEqual(await loadPlayerLinks(), {})
  for (const relay of relays) relay.options.mode = "up"
  await sync()
  await on(a)
  await sync()
  assert.deepEqual(await loadPlayerLinks(), {})
  await on(b)
  await sync()
  assert.deepEqual(await loadPlayerLinks(), {})
})

test("associations stay with their profile on a shared device and survive a data export", async () => {
  const a = newDevice()
  const guest = newPlayerRecord("Ben", "2026-09-01", BEN)
  const targetId = `pl_${"d".repeat(32)}`
  const target = { ...newPlayerRecord("Ben", "2026-09-01", targetId), pubkey: "b".repeat(64) }
  await on(a)
  await savePlayers([guest, target])
  assert.equal(await linkLocalPlayer(BEN, targetId), "linked")
  const { buildExport, importData, wipeAllData } = await import("../lib/storage/data.ts")
  const backup = await buildExport()
  assert.equal(backup.playerLinks?.profiles[pubkey]?.length, 1)
  await signOut({ keepLocalData: true })
  assert.deepEqual(await loadPlayerLinks(), {})
  const otherSecret = core.generateSecretKey()
  await importLocalKey(otherSecret)
  assert.deepEqual(await loadPlayerLinks(), {})
  await signOut({ keepLocalData: true })
  await importLocalKey(secret)
  assert.deepEqual(await loadPlayerLinks(), { [BEN]: targetId })
  await signOut({ keepLocalData: true })
  await wipeAllData()
  assert.equal((await importData(JSON.stringify(backup))).ok, true)
  await importLocalKey(secret)
  assert.deepEqual(await loadPlayerLinks(), { [BEN]: targetId })
})

test("an older device-only association requires explicit confirmation for a signed-in profile", async () => {
  const device = newDevice()
  await switchTo(device)
  await signOut({ keepLocalData: true })
  const targetId = `pl_${"e".repeat(32)}`
  await savePlayers([newPlayerRecord("Ben", "2026-09-01", BEN), { ...newPlayerRecord("Ben", "2026-09-01", targetId), pubkey: "b".repeat(64) }])
  assert.equal(await linkLocalPlayer(BEN, targetId), "linked")
  await importLocalKey(secret)
  const { loadPlayerLinkState } = await import("../lib/storage/player-links.ts")
  const state = await loadPlayerLinkState()
  assert.deepEqual(state.links, {})
  assert.equal(state.localSuggestions[BEN], targetId)
  assert.equal(await linkLocalPlayer(BEN, targetId), "linked")
  assert.deepEqual(await loadPlayerLinks(), { [BEN]: targetId })
})

test("concurrent offline changes remain separate until explicitly resolved on both devices", async () => {
  const a = newDevice(), b = newDevice()
  const guest = newPlayerRecord("Ben", "2026-09-01", BEN)
  const targetId = `pl_${"d".repeat(32)}`
  const target = { ...newPlayerRecord("Ben", "2026-09-01", targetId), pubkey: "b".repeat(64) }
  await on(a)
  await savePlayers([guest, target])
  assert.equal(await linkLocalPlayer(BEN, targetId), "linked")
  await sync()
  await on(b)
  await sync()
  await unlinkLocalPlayer(BEN)
  assert.equal(await linkLocalPlayer(BEN, targetId), "linked")
  await on(a)
  await unlinkLocalPlayer(BEN)
  await sync()
  await on(b)
  await sync()
  const { loadPlayerLinkState } = await import("../lib/storage/player-links.ts")
  assert.deepEqual(await loadPlayerLinks(), {})
  assert.deepEqual((await loadPlayerLinkState()).conflicts[BEN], [targetId])
  assert.equal(await linkLocalPlayer(BEN, targetId), "linked")
  await sync()
  await on(a)
  await sync()
  assert.deepEqual(await loadPlayerLinks(), { [BEN]: targetId })
})

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
  await Promise.all(relays.map((relay) => relay.dropAll()))
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
  await relays[2].dropAll()
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
  for (const relay of relays) relay.options.mode = "down"
  await Promise.all(relays.map((relay) => relay.dropAll()))
  const none = await syncOnly(true)
  assert.deepEqual([none.state, none.problem, none.lastSync], ["unavailable", "offline", null])
  assert.deepEqual(await ids(), [])

  relays[1].options.mode = "up"
  const some = await syncOnly(true)
  assert.deepEqual([some.state, some.problem], ["partial", "relays"])
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

test("resetting the Rangliste on one device deletes nothing from the profile and brings nothing back", async () => {
  const [a, b] = [newDevice(), newDevice()]
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", annaBen, "2026-10-01T20:00:00.000Z")
  await play101("game-2", annaBen, "2026-10-02T20:00:00.000Z")
  await sync()
  await on(b)
  await sync()
  assert.deepEqual(await ids(), ["game-1", "game-2"])

  // The reset stays on device A: no deletion goes out, and the games don't come back there.
  await on(a)
  assert.ok(await clearLeaderboard())
  assert.deepEqual(await deletedMatches(), [])
  assert.equal((await sync(false)).state, "complete")
  assert.equal((await sync(true)).state, "complete")
  assert.deepEqual(await ids(), [])
  const games = [...(await opened(relays[0])).versions.values()].filter((v) => v.record.type === "match")
  assert.deepEqual(games.map((v) => [v.record.id, v.record.rev, v.data !== null]).sort(), [
    ["match:game-1", 1, true],
    ["match:game-2", 1, true],
  ])
  await on(b)
  assert.equal((await sync(false)).state, "complete")
  assert.deepEqual(await ids(), ["game-1", "game-2"])

  // A game deleted on purpose still goes everywhere.
  assert.ok(await unarchive("game-2"))
  assert.deepEqual(await deletedMatches(), [{ id: "game-2", by: pubkey }])
  await sync(false)
  assert.equal((await opened(relays[0])).versions.get("match:game-2")?.data, null)
  await on(newDevice())
  await sync()
  assert.deepEqual(await ids(), ["game-1"])
})

test("signing out with 'delete everything' during a sync leaves nothing of it behind; the profile keeps its games", async () => {
  const [a, b] = [newDevice(), newDevice()]
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", annaBen, "2026-10-01T20:00:00.000Z")
  await sync()
  await on(b)
  await sync()
  assert.deepEqual(await ids(), ["game-1"])

  // Relays answer slowly, as public ones do: the sync is in flight while the person signs out.
  for (const relay of relays) relay.options.delayMs = 400
  const running = syncHistory(pubkey, { full: true })
  await new Promise((resolve) => setTimeout(resolve, 100))
  await signOut({ keepLocalData: false })
  assert.equal(await running, null)
  assert.deepEqual(await dbKeys("kv"), [])
  // Nor do the profile's public events, which the full sync looked up on the way.
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.deepEqual(await dbKeys("objects"), [])
  for (const relay of relays) relay.options.delayMs = undefined

  // Signed in again here, nothing is deleted; device A keeps its game.
  await importLocalKey(secret)
  assert.equal((await sync()).state, "complete")
  assert.deepEqual(await ids(), ["game-1"])
  assert.notEqual((await opened(relays[0])).versions.get("match:game-1")?.data, null)
  await on(a)
  await sync(false)
  assert.deepEqual(await ids(), ["game-1"])
})

test("a device whose clock runs behind still writes above the version relays hold, or waits and says why", async () => {
  const [a, b] = [newDevice(), newDevice()]
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", annaBen, "2026-10-01T20:00:00.000Z")
  await play101("game-2", annaBen, "2026-10-02T20:00:00.000Z")
  await sync()
  await on(b)
  await sync()
  const before = (await opened(relays[0])).versions.get("match:game-1")!

  // Ten minutes behind: the deletion is signed just above the version the relays hold.
  adjustClock(new Date(Date.now() - 10 * 60_000))
  assert.ok(await unarchive("game-1"))
  assert.equal((await sync(false)).state, "complete")
  const deletion = (await opened(relays[0])).versions.get("match:game-1")!
  assert.equal(deletion.data, null)
  assert.ok(deletion.events[0].created_at > before.events[0].created_at)

  // Further behind than relays accept ahead of their time: the change waits, and the sync says so.
  adjustClock(new Date(Date.now() - 20 * 60_000))
  assert.ok(await unarchive("game-2"))
  const late = await sync(false)
  assert.deepEqual([late.state, late.problem], ["partial", "clock"])
  assert.notEqual((await opened(relays[0])).versions.get("match:game-2")?.data, null)
  adjustClock(new Date())
  assert.equal((await sync(false)).state, "complete")
  assert.equal((await opened(relays[0])).versions.get("match:game-2")?.data, null)
  await on(a)
  await sync(false)
  assert.deepEqual(await ids(), [])
})

test("a device whose clock runs ahead still finds the other device's new game in an incremental sync", async () => {
  const [a, b] = [newDevice(), newDevice()]
  await on(a)
  await savePlayers([profilePlayer()])
  await play101("game-1", annaBen, "2026-10-01T20:00:00.000Z")
  await sync()

  // B's clock is twenty minutes ahead, and the app's origin has told it so.
  const ahead = () => Date.now() + 20 * 60_000
  await on(b)
  adjustClock(new Date(), ahead())
  assert.equal((await sync(true, ahead)).state, "complete")
  assert.deepEqual(await ids(), ["game-1"])

  await on(a)
  adjustClock(new Date())
  await play101("game-2", annaBen, "2026-10-02T20:00:00.000Z")
  assert.equal((await sync(false)).state, "complete")

  // B asks for what changed since its last sync: in the relays' time, not in its own.
  await on(b)
  adjustClock(new Date(), ahead())
  assert.equal((await sync(false, ahead)).state, "complete")
  assert.deepEqual(await ids(), ["game-1", "game-2"])
})

test("the data key is only ever taken from the profile's own record", async () => {
  await on(newDevice())
  await savePlayers([profilePlayer()])
  await play101("game-1", annaBen, "2026-10-01T20:00:00.000Z")
  await sync()
  const own = privateEvents(relays[0]).find((e) => e.tags[0][1] === dataKeySlot(pubkey))!
  // Someone else's event at the profile's key slot, as a bad relay could answer with.
  const forged = core.finalizeEvent({ kind: 30078, tags: [["d", dataKeySlot(pubkey)]], content: own.content, created_at: own.created_at - 1000 }, core.generateSecretKey())
  const signer = await createLocalSigner(secret)
  assert.equal(isDataKeyEvent(forged, pubkey), false)
  await assert.rejects(unwrapDataKey(forged, signer, pubkey), (error: unknown) => error instanceof DataKeyError && error.problem === "key")
  const unwrapped = await unwrapDataKey(own, signer, pubkey)
  assert.equal(Buffer.from(unwrapped.key).toString("hex"), Buffer.from((await storedDataKey(pubkey))!.key).toString("hex"))
})

test("without `write` a sync only reads: nothing is signed, nothing is sent", async () => {
  await on(newDevice())
  await savePlayers([profilePlayer()])
  await play101("game-1", annaBen, "2026-10-01T20:00:00.000Z")
  const result = await syncHistory(pubkey, { full: true, write: false })
  // The game and the players record wait for a sync that writes, and the screens can say so.
  assert.deepEqual([result?.state, result?.pending], ["complete", 2])
  assert.equal((await outboxStatus()).length, 0)
  assert.equal(privateEvents(relays[0]).length, 0)
  assert.equal(await storedDataKey(pubkey), null)
  // Once a sync writes, nothing waits any more, and a new device gets the game.
  const written = await sync()
  assert.deepEqual([written.state, written.pending], ["complete", 0])
  await on(newDevice())
  await sync()
  assert.deepEqual(await ids(), ["game-1"])
})

test("a game a guest deletes on a shared device stays in the profile's history on its other devices", async () => {
  const [shared, phone] = [newDevice(), newDevice()]
  await on(shared)
  await savePlayers([profilePlayer()])
  await play101("game-1", annaBen, "2026-10-01T20:00:00.000Z")
  await sync()
  await on(phone)
  await sync()
  assert.deepEqual(await ids(), ["game-1"])

  // The profile signs out on the shared device, keeping its games, and a guest deletes the game.
  await switchTo(shared)
  await signOut({ keepLocalData: true })
  assert.ok(await unarchive("game-1"))
  assert.deepEqual(await deletedMatches(), [{ id: "game-1", by: null }])
  // Signed in there again, the profile's sync doesn't take the guest's deletion for its own.
  await on(shared)
  await sync()
  await on(phone)
  await sync()
  assert.deepEqual(await ids(), ["game-1"])
})

test("a device-list change made for a profile is neither signed nor kept by one that signs in meanwhile", async () => {
  await on(newDevice())
  await savePlayers([profilePlayer()])
  await sync()
  const dataKey = (await storedDataKey(pubkey))!
  // Relays answer slowly, as public ones do: another profile signs in while the list is read.
  for (const relay of relays) relay.options.delayMs = 300
  const adding = addThisDevice(pubkey, "Laptop")
  await new Promise((resolve) => setTimeout(resolve, 100))
  const other = core.generateSecretKey()
  await importLocalKey(other, { replace: true })
  await assert.rejects(adding, { name: "DeviceListError", problem: "switched" })
  for (const relay of relays) relay.options = {}
  await send()
  const slot = recordSlot(dataKey.key, DEVICES_RECORD)
  const atSlot = relays[0].events.filter((e) => e.kind === 30078 && e.tags.some((t) => t[0] === "d" && t[1] === slot))
  assert.deepEqual(atSlot, [], "nothing at the profile's slot, least of all signed by the other key")
  assert.equal(await kvGet("profile.devices"), undefined, "the switch's deletion of the list's copy stands")
})
