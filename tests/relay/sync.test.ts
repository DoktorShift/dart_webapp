// The private history and the outbox against real relays ("nak serve" on 127.0.0.1, P3b.01 to
// P3b.03) and a real signer app ("nak bunker"), with nak as an independent reader of what the
// relays hold. Each device is its own IndexedDB and localStorage (tests/support/devices.ts).
// Nothing touches a public relay. Run: npm run test:relay
import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, at, resetStorage, saved } from "../storage-helpers.ts"
import { config, dart, play } from "../helpers.ts"
import { newDevice, switchTo, type Device } from "../support/devices.ts"
import { runNak, startBunker, startRelay, type NakRelay } from "../support/nak.ts"
import { relayClient } from "../../lib/nostr/client.ts"
import { loadCore, type Core } from "../../lib/nostr/core.ts"
import { relayAnswers } from "../../lib/nostr/relay-info.ts"
import { connectBunker, startNostrConnect } from "../../lib/nostr/signers.ts"
import { OWN } from "../../lib/profile/own-events.ts"
import { addRelay, editableRelays, relayListTemplate } from "../../lib/profile/relay-list.ts"
import { connectExternal, importLocalKey, signOut } from "../../lib/profile/session.ts"
import { dataKeySlot } from "../../lib/protocol/private.ts"
import type { ArchivedMatch } from "../../lib/storage/archive.ts"
import { archiveFinished } from "../../lib/storage/archive.ts"
import { dbGetAll } from "../../lib/storage/db.ts"
import { newPlayerRecord, savePlayers, type PlayerRecord } from "../../lib/storage/players.ts"
import { syncHistory } from "../../lib/sync/engine.ts"
import { deliverNow, flushDue, outboxStatus } from "../../lib/sync/outbox.ts"
import { changeOwnList } from "../../lib/sync/own-lists.ts"

let core: Core
let a: NakRelay
let b: NakRelay
let secret: Uint8Array
let pubkey: string

before(async () => {
  core = await loadCore()
  ;[a, b] = await Promise.all([startRelay(), startRelay()])
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `${a.url},${b.url}`
})

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
  secret = core.generateSecretKey()
  pubkey = core.getPublicKey(secret)
})

after(async () => {
  await signOut({ keepLocalData: true })
  relayClient().close()
  await Promise.all([a?.stop(), b?.stop()])
})

// Makes `device` the one the app runs on, signed in with the test's key.
async function on(device: Device) {
  await switchTo(device)
  await importLocalKey(secret)
}

const send = async () => deliverNow((await outboxStatus()).map((s) => s.id))
async function sync(full = true) {
  const result = await syncHistory(pubkey, { full })
  await send()
  return result
}

const profilePlayer = (): PlayerRecord => ({ ...newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), pubkey })
const seats = [
  { id: ANNA, name: "Anna" },
  { id: BEN, name: "Ben" },
]

// A won 101 (T20, 1, D20): seat 0 wins in three darts.
async function play101(id: string, finishedAt: string) {
  const c = config({ modeId: "301", modeName: "301", startScore: 101, players: seats })
  assert.ok(await archiveFinished(saved(c, play(c, [dart(20, 3), dart(1), dart(20, 2)]), id), undefined, at(finishedAt)))
}

const ids = async () => (await dbGetAll<ArchivedMatch>("matches")).map((m) => m.id).sort()

// What nak reads from a relay: the profile's private records, as any outsider sees them.
async function recordsOn(relay: NakRelay): Promise<{ id: string; kind: number; tags: string[][]; content: string }[]> {
  const out = await runNak(["req", "-k", "30078", "-a", pubkey, relay.url])
  return out ? out.split("\n").map((line) => JSON.parse(line)) : []
}

test("games reach both relays as opaque encrypted records that nak verifies but can't read; a new device reads them back", async () => {
  const first = newDevice()
  await on(first)
  await savePlayers([profilePlayer()])
  await play101("game-1", "2026-10-01T20:00:00.000Z")
  const result = await sync()
  assert.equal(result.state, "complete")

  for (const relay of [a, b]) {
    const records = await recordsOn(relay)
    // The data key, the game and the players: one opaque d tag each, content no one else can read.
    assert.equal(records.length, 3, relay.url)
    for (const r of records) {
      assert.equal(r.kind, 30078)
      assert.deepEqual(r.tags.map((t) => t[0]), ["d"])
      assert.match(r.tags[0][1], /^[0-9a-f]{64}$/)
      for (const word of ["Anna", "Ben", "game-1", "301", "match"]) assert.ok(!r.content.includes(word), word)
    }
    assert.equal(await runNak(["verify"], { input: `${records.map((r) => JSON.stringify(r)).join("\n")}\n` }), "")
    // nak itself can open the data key record with the profile's key: it is NIP-44 to the profile.
    const keyRecord = records.find((r) => r.tags[0][1] === dataKeySlot(pubkey))!
    const opened = JSON.parse(await runNak(["decrypt", "--sec", Buffer.from(secret).toString("hex"), "-p", pubkey, keyRecord.content]))
    assert.match(opened.key, /^[0-9a-f]{64}$/)
  }

  const second = newDevice()
  await on(second)
  assert.deepEqual(await ids(), [])
  assert.equal((await sync()).state, "complete")
  assert.deepEqual(await ids(), ["game-1"])
  assert.deepEqual((await dbGetAll<PlayerRecord>("players")).map((p) => p.name).sort(), ["Anna", "Ben"])
})

test("a relay address is checked with NIP-11 before it goes on the list", async () => {
  assert.equal(await relayAnswers(a.url), true)
  assert.equal(await relayAnswers("ws://127.0.0.1:9", 2000), false)
})

test("a relay down and up again: waiting events go out after the restart, and a full sync fills what the restart lost", async () => {
  const device = newDevice()
  await on(device)
  await savePlayers([profilePlayer()])
  await play101("game-1", "2026-10-01T20:00:00.000Z")
  assert.equal((await sync()).state, "complete")

  await b.stop()
  await play101("game-2", "2026-10-02T20:00:00.000Z")
  const partial = await sync(false)
  assert.equal(partial.state, "partial")
  assert.equal(partial.problem, "offline")
  // The game is on the relay that answered, and waits for the other one.
  assert.equal((await recordsOn(a)).length, 4)
  const waiting = await outboxStatus()
  assert.ok(waiting.length > 0 && waiting.every((s) => s.state === "waiting" && s.results.some((r) => r.url === b.url && !r.ok)))

  // The relay comes back empty (nak keeps nothing across a restart): the waiting events arrive,
  // and the next full sync notices that the earlier records are missing there and sends them again.
  b = await startRelay({ port: b.port })
  await flushDue(() => Number.MAX_SAFE_INTEGER)
  assert.equal((await outboxStatus()).filter((s) => s.state === "waiting").length, 0)
  const after = await recordsOn(b)
  assert.ok(after.length >= 1 && after.length < 4, `${after.length} records after the restart`)
  assert.equal((await sync(true)).state, "complete")
  assert.equal((await recordsOn(b)).length, 4)
})

test("two devices play while every relay is down; afterwards both have every game once, written once", async () => {
  const [first, second] = [newDevice(), newDevice()]
  await on(first)
  await savePlayers([profilePlayer()])
  await play101("game-1", "2026-10-01T20:00:00.000Z")
  await sync()
  await on(second)
  await sync()

  // Both relays go away, with everything on them.
  await Promise.all([a.stop(), b.stop()])
  await on(first)
  await play101("game-2", "2026-10-02T20:00:00.000Z")
  assert.equal((await sync(false)).state, "unavailable")
  await on(second)
  await play101("game-3", "2026-10-03T20:00:00.000Z")
  assert.equal((await sync(false)).state, "unavailable")

  ;[a, b] = await Promise.all([startRelay({ port: a.port }), startRelay({ port: b.port })])
  for (const device of [first, second, first]) {
    await on(device)
    assert.equal((await sync(true)).state, "complete")
  }
  for (const device of [first, second]) {
    await on(device)
    assert.deepEqual(await ids(), ["game-1", "game-2", "game-3"])
  }
  // On the relays: the data key, the players and one version per game, nothing twice.
  const records = await recordsOn(a)
  assert.equal(records.length, 5)
  assert.equal(new Set(records.map((r) => r.tags[0][1])).size, 5)
  assert.deepEqual((await recordsOn(b)).map((r) => r.id).sort(), records.map((r) => r.id).sort())
})

test("a profile kept in a signer app (nak bunker) makes its data key through the signer; a second device reads the games with it", async () => {
  const bunker = await startBunker(a.url)
  try {
    const perms = ["sign_event:30078", "nip44_encrypt", "nip44_decrypt"]
    const first = newDevice()
    await switchTo(first)
    await connectExternal("nip46", { connection: await connectBunker(bunker.uri, { timeoutMs: 15_000, perms }) })
    pubkey = bunker.pubkey
    await savePlayers([profilePlayer()])
    await play101("game-1", "2026-10-01T20:00:00.000Z")
    assert.equal((await sync()).state, "complete")
    assert.equal((await recordsOn(a)).length, 3)
    assert.ok((await recordsOn(a)).every((r) => core.verifyEventSignature(r as never)))

    // The second device connects the way a phone does: its code is handed to the signer app.
    const second = newDevice()
    await switchTo(second)
    const start = await startNostrConnect({ relays: [a.url], perms, timeoutMs: 15_000, waitMs: 20_000, graceMs: 500 })
    await bunker.connect(start.uri)
    await connectExternal("nip46", { connection: await start.connection })
    assert.equal((await sync()).state, "complete")
    assert.deepEqual(await ids(), ["game-1"])
  } finally {
    await signOut({ keepLocalData: true })
    await bunker.stop()
  }
})

test("a relay that is gone for good is replaced: adding a relay under Erweitert fills it on the next sync, and keeps what another device added", async () => {
  const [c, d] = await Promise.all([startRelay(), startRelay()])
  try {
    const [first, second] = [newDevice(), newDevice()]
    await on(first)
    await savePlayers([profilePlayer()])
    await play101("game-1", "2026-10-01T20:00:00.000Z")
    await sync()
    await on(second)
    await sync()
    // The second device adds a relay to the list...
    await changeOwnList(OWN.relayList, (latest) => relayListTemplate(addRelay(editableRelays(latest), c.url)!, latest))
    await send()

    // ...and the first, whose copy of the list is older, adds another: both end up on the list.
    await on(first)
    await changeOwnList(OWN.relayList, (latest) => relayListTemplate(addRelay(editableRelays(latest), d.url)!, latest))
    await send()
    const list = JSON.parse(await runNak(["req", "-k", "10002", "-a", pubkey, a.url]))
    assert.deepEqual(list.tags.filter((t: string[]) => t[0] === "r").map((t: string[]) => t[1]), [a.url, b.url, c.url, d.url])

    // Relay a is gone for good. The next full sync copies everything onto the new relays.
    await a.stop()
    const result = await sync(true)
    assert.equal(result.state, "partial")
    assert.equal((await recordsOn(c)).length, 3)
    assert.equal((await recordsOn(d)).length, 3)
    // A new device finds the games without relay a.
    await on(newDevice())
    assert.deepEqual([(await sync()).state, await ids()], ["partial", ["game-1"]])
    a = await startRelay({ port: a.port })
  } finally {
    await Promise.all([c.stop(), d.stop()])
  }
})
