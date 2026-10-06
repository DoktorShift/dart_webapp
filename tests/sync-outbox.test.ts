import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { FakeNetwork, type FakeRelay } from "./support/fake-relay.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { closeDatabase } from "../lib/storage/db.ts"
import { backoffMs, deliverNow, deliveryStatus, enqueue, flushDue, outboxStatus, resumeOutbox } from "../lib/sync/outbox.ts"

// The persistent outbox (lib/sync/outbox.ts) against in-memory relays: delivery rules, which
// answers are tried again, backoff, coalescing, duplicates, relays going down and up, and a reload
// in the middle. Time is passed in, so retries are checked without waiting for them.

const network = new FakeNetwork()
Object.assign(globalThis, { WebSocket: network.WebSocket })
// Three operators, and a second relay of the first one.
const URLS = ["wss://one.example", "wss://relay.two.example", "wss://three.example", "wss://cache.one.example"]
const relays = URLS.map((url) => network.add(url))
let core: Core
let key: Uint8Array

before(async () => {
  core = await loadCore()
  key = core.generateSecretKey()
})

beforeEach(async () => {
  await resetStorage()
  for (const relay of relays) {
    relay.events = []
    relay.options = {}
  }
})

// A relay that goes away: open connections drop, new ones fail.
function down(relay: FakeRelay) {
  relay.options.mode = "down"
  relay.dropAll()
}

after(() => relayClient().close())

let serial = 0
const event = (kind = 1180, tags: string[][] = [], at = 1_790_000_000): NostrEvent => core.finalizeEvent({ kind, tags, content: `n${++serial}`, created_at: at }, key)
const stored = (relay: FakeRelay, e: NostrEvent) => relay.events.some((x) => x.id === e.id)
const T0 = 1_000_000

test("delivered once relays of two operators confirm; two relays of one operator are not enough", async () => {
  const e = event()
  down(relays[1])
  down(relays[2])
  await enqueue([{ event: e, relays: [URLS[0], URLS[3], URLS[1]] }], {}, () => T0)
  const [first] = await deliverNow([e.id], () => T0)
  assert.equal(first.state, "waiting")
  assert.deepEqual(first.confirmed, [URLS[0], URLS[3]])
  assert.equal(first.operators, 1)
  assert.ok(first.retryAt! > T0)

  relays[1].options.mode = "up"
  await flushDue(() => T0 + 60 * 60_000)
  const later = await deliveryStatus(e.id)
  // All three have it: every relay answered for good, so nothing is left to do.
  assert.equal(later, null)
  assert.ok(stored(relays[1], e))
})

test("rate-limited and mute are tried again, invalid and blocked are final", async () => {
  const e = event()
  let limited = true
  relays[0].options.onEvent = () => (limited ? [false, "rate-limited: slow down"] : [true, ""])
  relays[1].options.onEvent = () => [false, "mute: no thanks"]
  relays[2].options.onEvent = () => [false, "invalid: kind not accepted"]
  await enqueue([{ event: e, relays: URLS.slice(0, 3) }], {}, () => T0)
  const [status] = await deliverNow([e.id], () => T0)
  assert.equal(status.state, "waiting")
  assert.deepEqual(
    status.results.map((r) => r.code),
    ["rate-limited", "mute", "invalid"],
  )

  // Due later, not now; once due, only the two open relays are asked again.
  await flushDue(() => T0 + 1000)
  assert.equal((await deliveryStatus(e.id))!.attempts, 1)
  limited = false
  relays[1].options.onEvent = undefined
  await flushDue(() => T0 + 60 * 60_000)
  // Confirmed by two operators, refused for good by the third: done and gone.
  assert.equal(await deliveryStatus(e.id), null)
  assert.ok(stored(relays[0], e) && stored(relays[1], e) && !stored(relays[2], e))
})

test("every relay refusing for good ends it as refused", async () => {
  const e = event()
  relays[0].options.onEvent = () => [false, "blocked: not on the list"]
  relays[1].options.onEvent = () => [false, "invalid: bad"]
  await enqueue([{ event: e, relays: URLS.slice(0, 2) }])
  const [status] = await deliverNow([e.id])
  assert.equal(status.state, "refused")
  assert.equal(await deliveryStatus(e.id), null)
})

test("backoff doubles from 5 s up to 10 min, with jitter in the upper half", () => {
  assert.equal(backoffMs(1, 0), 2500)
  assert.equal(backoffMs(1, 1), 5000)
  assert.equal(backoffMs(2, 1), 10_000)
  assert.equal(backoffMs(3, 0.5), 15_000)
  assert.equal(backoffMs(30, 1), 600_000)
  for (let i = 0; i < 50; i++) {
    const ms = backoffMs(4)
    assert.ok(ms >= 20_000 && ms <= 40_000, `${ms}`)
  }
})

test("one relay is enough for the 'any' rule", async () => {
  const e = event(31180, [["d", "match-1"]])
  down(relays[1])
  await enqueue([{ event: e, relays: URLS.slice(0, 2) }], { rule: "any" })
  const [status] = await deliverNow([e.id])
  assert.equal(status.state, "delivered")
  assert.equal(status.retryAt, null)
})

test("coalescing keeps the newest version per coordinate; an older one arriving late is dropped", async () => {
  relays.forEach(down)
  const old = event(31180, [["d", "match-1"]], 1_790_000_000)
  const fresh = event(31180, [["d", "match-1"]], 1_790_000_005)
  const other = event(31180, [["d", "match-2"]], 1_790_000_000)
  await enqueue([{ event: old, relays: URLS }], { rule: "any", coalesce: true })
  await enqueue([{ event: fresh, relays: URLS }, { event: other, relays: URLS }], { rule: "any", coalesce: true })
  await enqueue([{ event: old, relays: URLS }], { rule: "any", coalesce: true })
  assert.deepEqual((await outboxStatus()).map((s) => s.id).sort(), [fresh.id, other.id].sort())
})

test("the same event twice is one entry; a relay that has it already counts as a copy", async () => {
  const e = event()
  relays[0].events.push(e)
  relays[0].options.onEvent = () => [true, "duplicate: already have it"]
  await enqueue([{ event: e, relays: [URLS[0]] }])
  await enqueue([{ event: e, relays: [URLS[0], URLS[1]] }])
  const all = await outboxStatus()
  assert.equal(all.length, 1)
  assert.deepEqual(all[0].relays, [URLS[0], URLS[1]])
  const [status] = await deliverNow([e.id])
  assert.equal(status.state, "delivered")
  assert.deepEqual(status.confirmed, [URLS[0], URLS[1]])
})

test("waiting events survive a reload and go out once the relays are back", async () => {
  const e = event()
  relays.forEach(down)
  await enqueue([{ event: e, relays: URLS.slice(0, 2) }], {}, () => T0)
  const [status] = await deliverNow([e.id], () => T0)
  assert.equal(status.state, "waiting")
  assert.deepEqual(
    status.results.map((r) => r.code),
    ["unreachable", "unreachable"],
  )

  // The page goes away; the database stays.
  await closeDatabase()
  relays.forEach((r) => (r.options.mode = "up"))
  const reloaded = await deliveryStatus(e.id)
  assert.equal(reloaded?.state, "waiting")
  await flushDue(() => reloaded!.retryAt!)
  assert.equal(await deliveryStatus(e.id), null)
  assert.ok(stored(relays[0], e) && stored(relays[1], e))
})

test("copies still missing once delivered are sent again when the app starts", async () => {
  const e = event()
  down(relays[2])
  await enqueue([{ event: e, relays: URLS.slice(0, 3) }])
  const [status] = await deliverNow([e.id])
  assert.equal(status.state, "delivered")
  assert.equal((await deliveryStatus(e.id))?.retryAt, null)
  assert.ok(!stored(relays[2], e))

  relays[2].options.mode = "up"
  await resumeOutbox()
  assert.ok(stored(relays[2], e))
  assert.equal(await deliveryStatus(e.id), null)
})
