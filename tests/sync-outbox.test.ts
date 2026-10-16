import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { FakeNetwork, type FakeRelay } from "./support/fake-relay.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { closeDatabase } from "../lib/storage/db.ts"
import { backoffMs, deliverNow, deliveryStatus, enqueue, flushDue, outboxStatus, pendingEvents, refusedEvents, resumeOutbox, sendWaitingNow, withdraw } from "../lib/sync/outbox.ts"

// The persistent outbox (lib/sync/outbox.ts) against in-memory relays: delivery rules, which
// answers are tried again, backoff, coalescing, duplicates, order (`after`), what a handoff
// carries and withdraws, relays going down and up, a reload in the middle, the lock that covers
// the queue but never the sends, and a tab that waits for a round's lease or an entry's turn
// instead of spinning. Time is passed in, so retries are checked without waiting for them. The
// tests that resume the background sender come last: its timer runs on the clock.

const network = new FakeNetwork()
Object.assign(globalThis, { WebSocket: network.WebSocket })
// Three operators, and a second relay of the first one.
const URLS = ["wss://one.example", "wss://relay.two.example", "wss://three.example", "wss://cache.one.example"]
const relays = URLS.map((url) => network.add(url))
let core: Core
let key: Uint8Array

// Every IndexedDB transaction opened, by anything: the measure of a tab that spins.
let transactions = 0
const openTransaction = IDBDatabase.prototype.transaction
IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
  transactions++
  return openTransaction.apply(this, args)
}

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const T0 = 1_000_000
const WEEK_MS = 7 * 24 * 60 * 60_000

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

test("every relay refusing for good ends it as refused, kept as such for its week", async () => {
  const refused = event()
  const ok = event()
  relays[0].options.onEvent = (e) => (e.id === refused.id ? [false, "blocked: not on the list"] : [true, ""])
  relays[1].options.onEvent = (e) => (e.id === refused.id ? [false, "invalid: bad"] : [true, ""])
  await enqueue([{ event: refused, relays: URLS.slice(0, 2) }, { event: ok, relays: URLS.slice(0, 2) }], {}, () => T0)
  const states = new Map((await deliverNow([refused.id, ok.id], () => T0)).map((s) => [s.id, s.state]))
  assert.deepEqual([states.get(refused.id), states.get(ok.id)], ["refused", "delivered"])
  // A refusal is not a delivery: it stays, sent no more, while a delivered one is gone.
  const kept = await deliveryStatus(refused.id)
  assert.deepEqual([kept?.state, kept?.retryAt], ["refused", null])
  assert.equal(await deliveryStatus(ok.id), null)
  assert.deepEqual(await pendingEvents(() => true), [], "nothing waits")
  assert.deepEqual(
    (await refusedEvents(() => true)).map((e) => e.id),
    [refused.id],
  )
  // Taken by one operator and refused by the other: as delivered as it gets, and done.
  const partial = event()
  relays[1].options.onEvent = (e) => (e.id === refused.id || e.id === partial.id ? [false, "invalid: bad"] : [true, ""])
  await enqueue([{ event: partial, relays: URLS.slice(0, 2) }], {}, () => T0)
  const [taken] = await deliverNow([partial.id], () => T0)
  assert.deepEqual([taken.state, taken.operators], ["delivered", 1])
  assert.equal(await deliveryStatus(partial.id), null)
  // An event queued after it is not held up.
  const next = event()
  await enqueue([{ event: next, relays: URLS.slice(0, 2), after: [refused.id] }], {}, () => T0)
  await flushDue(() => T0)
  assert.equal((await deliveryStatus(next.id)) ?? "gone", "gone")

  await sendWaitingNow(() => T0 + WEEK_MS + 1)
  assert.equal(await deliveryStatus(refused.id), null, "given up a week after the first attempt")
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

test("an entry goes out after the ones it names: once they have a copy somewhere, or are gone", async () => {
  relays.forEach(down)
  const founding = event()
  const result = event()
  const seat = event()
  const targets = URLS.slice(0, 2)
  await enqueue(
    [
      { event: founding, relays: targets },
      { event: result, relays: targets, after: [founding.id] },
      // After an event that was never queued (or is long done): nothing to wait for.
      { event: seat, relays: targets, after: ["0".repeat(64)] },
    ],
    {},
    () => T0,
  )
  await flushDue(() => T0)
  assert.equal((await deliveryStatus(founding.id))!.attempts, 1)
  assert.equal((await deliveryStatus(result.id))!.attempts, 0, "not tried while no relay has the founding")
  assert.equal((await deliveryStatus(seat.id))!.attempts, 1)
  const listed = (await outboxStatus()).map((s) => s.id)
  assert.ok(listed.indexOf(founding.id) < listed.indexOf(result.id), "listed in sending order")

  // One relay back: the founding lands there in its retry, and the result follows it in the
  // same flush. One copy is enough for the order; the founding itself still waits for the second
  // relay.
  relays[0].options.mode = "up"
  await flushDue(() => T0 + 60 * 60_000)
  const stored = relays[0].events.map((e) => e.id)
  assert.ok(stored.includes(founding.id) && stored.includes(result.id))
  assert.ok(stored.indexOf(founding.id) < stored.indexOf(result.id))
  assert.equal((await deliveryStatus(founding.id))!.state, "waiting")
  assert.equal((await deliveryStatus(result.id))!.attempts, 1)
})

test("pendingEvents lists what still waits for its rule, in sending order; withdraw takes it out", async () => {
  down(relays[1])
  down(relays[2])
  const first = event()
  const second = event()
  const score = event(31180, [["d", "match-1"]])
  const other = event()
  const ofMatch = (e: NostrEvent) => [first.id, second.id, score.id].includes(e.id)
  await enqueue(
    [
      { event: second, relays: URLS.slice(0, 3), after: [first.id] },
      { event: first, relays: URLS.slice(0, 3) },
      { event: other, relays: URLS.slice(0, 2) },
    ],
    {},
    () => T0,
  )
  await enqueue([{ event: score, relays: URLS.slice(0, 2) }], { rule: "any" }, () => T0 + 1)
  await flushDue(() => T0 + 1)
  // The score is delivered (one relay) and only misses a copy; the records wait for a second operator.
  assert.equal((await deliveryStatus(score.id))!.state, "delivered")
  assert.deepEqual(
    (await pendingEvents(ofMatch)).map((e) => e.id),
    [first.id, second.id],
  )

  await withdraw(ofMatch)
  assert.deepEqual(
    (await outboxStatus()).map((s) => s.id),
    [other.id],
  )
  assert.deepEqual(await pendingEvents(ofMatch), [])
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

test("queueing never waits behind a round's sends", async () => {
  relays[0].options.delayMs = 1500
  const first = event()
  const second = event()
  await enqueue([{ event: first, relays: [URLS[0]] }])
  const round = flushDue()
  await sleep(50)
  const started = Date.now()
  await enqueue([{ event: second, relays: [URLS[1]] }])
  assert.ok(Date.now() - started < 500, "enqueue waited for the sends")
  await round
  assert.ok(stored(relays[0], first) && stored(relays[1], second))
})

test("an entry one round is sending is left alone by another", async () => {
  relays[0].options.delayMs = 300
  down(relays[2])
  const e = event()
  await enqueue([{ event: e, relays: URLS.slice(0, 3) }])
  const round = flushDue()
  await sleep(50)
  const [meanwhile] = await deliverNow([e.id])
  assert.equal(meanwhile.attempts, 0)
  await round
  const after = await deliveryStatus(e.id)
  assert.deepEqual([after?.state, after?.attempts], ["delivered", 1])
})

test("an event never tried is never given up: the week counts from the first attempt", async () => {
  const e = event()
  // Queued while offline, or right before the app was closed: no attempt yet.
  await enqueue([{ event: e, relays: URLS.slice(0, 3) }], {}, () => T0)
  // Eight days later the app starts again, every relay reachable.
  await sendWaitingNow(() => T0 + WEEK_MS + 24 * 60 * 60_000)
  assert.equal(relays.slice(0, 3).filter((r) => stored(r, e)).length, 3)
  assert.equal(await deliveryStatus(e.id), null, "delivered everywhere, done")
})

test("an entry no relay accepts for good is given up after a week", async () => {
  relays[0].options.onEvent = () => [false, "error: not now"]
  const e = event()
  await enqueue([{ event: e, relays: [URLS[0]] }], {}, () => T0)
  const [status] = await deliverNow([e.id], () => T0)
  assert.equal(status.state, "waiting")
  await flushDue(() => T0 + WEEK_MS + 1)
  assert.equal(await deliveryStatus(e.id), null)
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

test("while a round sends, the tab waits for the lease to end instead of spinning over the entry", async () => {
  await resumeOutbox()
  relays[0].options.delayMs = 1500
  const e = event()
  const before = transactions
  await enqueue([{ event: e, relays: [URLS[0]] }], { rule: "any" })
  await sleep(1800)
  const during = transactions - before
  assert.ok(stored(relays[0], e))
  assert.equal(await deliveryStatus(e.id), null)
  const after = transactions
  await sleep(500)
  // Queueing, the pick, the merge, and the wake-ups they announce: a dozen or so, not thousands.
  assert.ok(during < 50, `${during} IndexedDB transactions during one 1.5 s send`)
  assert.equal(transactions - after, 0, "nothing runs once the send is over")
})

test("an entry waiting for its turn doesn't wake the tab before the one before it is due", async () => {
  await resumeOutbox()
  relays.forEach(down)
  const first = event()
  const second = event()
  const before = transactions
  await enqueue([{ event: first, relays: [URLS[0]] }, { event: second, relays: [URLS[0]], after: [first.id] }], { rule: "any" })
  await sleep(800)
  assert.equal((await deliveryStatus(first.id))?.attempts, 1)
  assert.equal((await deliveryStatus(second.id))?.attempts, 0)
  // The first is due again after its backoff (2.5 s at least); until then nothing runs.
  assert.ok(transactions - before < 50, `${transactions - before} IndexedDB transactions while an entry waits for its turn`)
})
