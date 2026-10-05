import { before, test } from "node:test"
import assert from "node:assert/strict"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import {
  adjustClock,
  coordinateOf,
  createdAt,
  createRelayClient,
  latestEvents,
  nowSeconds,
  parseRelayMessage,
  type RelayClientOptions,
} from "../lib/nostr/client.ts"

import { FakeNetwork } from "./support/fake-relay.ts"

let core: Core
let alice: Uint8Array
let bob: Uint8Array

before(async () => {
  core = await loadCore()
  alice = core.generateSecretKey()
  bob = core.generateSecretKey()
})

const sign = (key: Uint8Array, kind: number, content = "", tags: string[][] = [], at = Math.floor(Date.now() / 1000)) =>
  core.finalizeEvent({ kind, content, tags, created_at: at }, key)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// Waits for a condition instead of a fixed time, so a busy machine doesn't fail the test.
async function until(condition: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!condition() && Date.now() < deadline) await wait(10)
}

// Unhandled rejections would surface as test failures here instead of crashing a browser tab.
const unhandled: unknown[] = []
process.on("unhandledRejection", (reason) => unhandled.push(reason))

function setup(options: RelayClientOptions = {}) {
  const network = new FakeNetwork()
  const client = createRelayClient({ websocket: network.WebSocket, connectTimeoutMs: 500, publishTimeoutMs: 300, queryTimeoutMs: 600, ...options })
  return { network, client }
}

test("relay messages: machine-readable prefixes are recognised, anything else has none", () => {
  assert.deepEqual(parseRelayMessage("duplicate: already have this event"), { code: "duplicate", reason: "duplicate: already have this event" })
  assert.equal(parseRelayMessage("rate-limited: slow down").code, "rate-limited")
  assert.equal(parseRelayMessage("auth-required: we only accept events from registered users").code, "auth-required")
  assert.equal(parseRelayMessage("mute: no one was listening for this").code, "mute")
  assert.equal(parseRelayMessage("blocked: you are banned").code, "blocked")
  assert.equal(parseRelayMessage("invalid: event creation date is too far off from the current time").code, "invalid")
  assert.equal(parseRelayMessage("restricted: not allowed").code, "restricted")
  assert.equal(parseRelayMessage("pow: difficulty 26 is less than 30").code, "pow")
  assert.equal(parseRelayMessage("error: could not connect to the database").code, "error")
  assert.equal(parseRelayMessage("").code, "")
  assert.equal(parseRelayMessage("something went wrong").code, "")
  assert.equal(parseRelayMessage("Blocked: wrong case").code, "")
})

test("publish: every relay's answer with its reason; refusals and outages never throw", async () => {
  const { network, client } = setup()
  network.add("wss://ok.example")
  network.add("wss://dup.example", { onEvent: () => [true, "duplicate: already have this event"] })
  network.add("wss://blocked.example", { onEvent: () => [false, "blocked: not on the allow list"] })
  network.add("wss://limited.example", { onEvent: () => [false, "rate-limited: slow down"] })
  network.add("wss://invalid.example", { onEvent: () => [false, "invalid: created_at too late"] })
  network.add("wss://mute.example", { onEvent: () => [false, "mute: no one was listening for this"] })
  network.add("wss://plain.example", { onEvent: () => [false, "nope"] })
  network.add("wss://down.example", { mode: "down" })
  network.add("wss://silent.example", { mode: "silent" })
  const event = sign(alice, 1180, "hello")
  const results = await client.publish(event, [
    "wss://ok.example",
    "wss://dup.example/",
    "wss://blocked.example",
    "wss://limited.example",
    "wss://invalid.example",
    "wss://mute.example",
    "wss://plain.example",
    "wss://down.example",
    "wss://silent.example",
    "ftp://not-a-relay",
    "wss://ok.example", // the same relay again counts once
  ])
  const byUrl = Object.fromEntries(results.map((r) => [r.url, r]))
  assert.equal(results.length, 10)
  assert.deepEqual([byUrl["wss://ok.example"].ok, byUrl["wss://ok.example"].code], [true, ""])
  assert.deepEqual([byUrl["wss://dup.example"].ok, byUrl["wss://dup.example"].code], [true, "duplicate"])
  assert.deepEqual([byUrl["wss://blocked.example"].ok, byUrl["wss://blocked.example"].code], [false, "blocked"])
  assert.equal(byUrl["wss://blocked.example"].reason, "blocked: not on the allow list")
  assert.equal(byUrl["wss://limited.example"].code, "rate-limited")
  assert.equal(byUrl["wss://invalid.example"].code, "invalid")
  assert.equal(byUrl["wss://mute.example"].code, "mute")
  assert.deepEqual([byUrl["wss://plain.example"].ok, byUrl["wss://plain.example"].code, byUrl["wss://plain.example"].reason], [false, "", "nope"])
  assert.deepEqual([byUrl["wss://down.example"].ok, byUrl["wss://down.example"].code], [false, "unreachable"])
  assert.deepEqual([byUrl["wss://silent.example"].ok, byUrl["wss://silent.example"].code], [false, "timeout"])
  assert.deepEqual([byUrl["ftp://not-a-relay"].ok, byUrl["ftp://not-a-relay"].code], [false, "unreachable"])
  await wait(700)
  client.close()
  assert.deepEqual(unhandled, [])
})

test("publish: the same event to the same relay at once is sent once and both callers get the answer", async () => {
  const { network, client } = setup()
  const relay = network.add("wss://ok.example")
  let received = 0
  relay.options.onEvent = () => {
    received++
    return [true, ""]
  }
  const event = sign(alice, 1, "once")
  const [a, b] = await Promise.all([client.publish(event, ["wss://ok.example"]), client.publish(event, ["wss://ok.example"])])
  assert.equal(a[0].ok, true)
  assert.equal(b[0].ok, true)
  assert.equal(received, 1)
  client.close()
})

test("query: no relay answered is unknown, not empty", async () => {
  const { network, client } = setup()
  network.add("wss://down-a.example", { mode: "down" })
  network.add("wss://silent.example", { mode: "silent" })
  const result = await client.query([{ kinds: [1] }], ["wss://down-a.example", "wss://silent.example"])
  assert.deepEqual(result.events, [])
  assert.deepEqual(result.answered, [])
  assert.equal(result.complete, false)
  assert.deepEqual(result.failed.map((f) => [f.url, f.code]), [
    ["wss://down-a.example", "unreachable"],
    ["wss://silent.example", "timeout"],
  ])
  const none = await client.query([{ kinds: [1] }], [])
  assert.equal(none.complete, false)
  client.close()
})

test("query: an empty answer from every relay is complete; one missing relay makes it partial", async () => {
  const { network, client } = setup()
  network.add("wss://a.example")
  network.add("wss://b.example")
  network.add("wss://down.example", { mode: "down" })
  const empty = await client.query([{ kinds: [1] }], ["wss://a.example", "wss://b.example"])
  assert.deepEqual([empty.events.length, empty.answered.length, empty.complete], [0, 2, true])
  const partial = await client.query([{ kinds: [1] }], ["wss://a.example", "wss://down.example"])
  assert.deepEqual([partial.answered, partial.complete], [["wss://a.example"], false])
  client.close()
})

test("query: a relay that closes the request reports its reason", async () => {
  const { network, client } = setup()
  network.add("wss://picky.example", { onReq: (filters) => (filters.some((f) => !f.kinds) ? "invalid: filters must have kinds" : null) })
  const result = await client.query([{ authors: [core.getPublicKey(alice)] }], ["wss://picky.example"])
  assert.deepEqual(result.failed.map((f) => [f.code, f.reason]), [["invalid", "invalid: filters must have kinds"]])
  client.close()
})

test("query: duplicates across relays count once; replaceable and addressable keep only the newest", async () => {
  const { network, client } = setup()
  const a = network.add("wss://a.example")
  const b = network.add("wss://b.example")
  const t = Math.floor(Date.now() / 1000) - 100
  const note = sign(alice, 1, "same everywhere", [], t)
  const profileOld = sign(alice, 0, '{"name":"old"}', [], t)
  const profileNew = sign(alice, 0, '{"name":"new"}', [], t + 10)
  const statsOld = sign(alice, 31180, "v1", [["d", "card"]], t)
  const statsNew = sign(alice, 31180, "v2", [["d", "card"]], t + 5)
  const otherCard = sign(alice, 31180, "other", [["d", "other"]], t)
  const bobProfile = sign(bob, 0, '{"name":"bob"}', [], t)
  a.events.push(note, profileOld, statsNew, otherCard)
  b.events.push(note, profileNew, statsOld, bobProfile)
  const result = await client.query([{ kinds: [0, 1, 31180] }], ["wss://a.example", "wss://b.example"])
  assert.equal(result.complete, true)
  const ids = new Set(result.events.map((e) => e.id))
  assert.equal(result.events.length, 5)
  assert.ok(ids.has(note.id) && ids.has(profileNew.id) && ids.has(statsNew.id) && ids.has(otherCard.id) && ids.has(bobProfile.id))
  assert.ok(!ids.has(profileOld.id) && !ids.has(statsOld.id))
  // Newest first.
  assert.deepEqual(result.events.map((e) => e.created_at), [...result.events.map((e) => e.created_at)].sort((x, y) => y - x))
  client.close()
})

test("latestEvents: on equal created_at the lowest id wins (NIP-01)", () => {
  const t = 1_700_000_000
  const x = sign(alice, 10002, "", [["r", "wss://x.example"]], t)
  const y = sign(alice, 10002, "", [["r", "wss://y.example"]], t)
  const winner = x.id < y.id ? x : y
  assert.deepEqual(latestEvents([x, y]).map((e) => e.id), [winner.id])
  assert.deepEqual(latestEvents([y, x]).map((e) => e.id), [winner.id])
  assert.equal(coordinateOf(x), `10002:${x.pubkey}:`)
  assert.equal(coordinateOf(sign(alice, 30078, "", [["d", "abc"]])), `30078:${x.pubkey}:abc`)
  assert.equal(coordinateOf(sign(alice, 30078, "", [])), `30078:${x.pubkey}:`)
  assert.equal(coordinateOf(sign(alice, 1180, "")), null)
})

test("NIP-42: without a signer the relay's auth-required refusal is reported; with one, AUTH once and retry", async () => {
  // The refusals come at once; the AUTH round trip gets time on a busy machine.
  const { network, client } = setup({ publishTimeoutMs: 3000, queryTimeoutMs: 3000 })
  const relay = network.add("wss://members.example", { auth: true })
  const event = sign(alice, 1180, "members only")
  const refused = await client.publish(event, ["wss://members.example"])
  assert.deepEqual([refused[0].ok, refused[0].code], [false, "auth-required"])
  const closed = await client.query([{ kinds: [1180] }], ["wss://members.example"])
  assert.deepEqual(closed.failed.map((f) => f.code), ["auth-required"])

  const signer = core.createSecretKeySigner(alice)
  client.setAuthSigner(signer)
  const accepted = await client.publish(event, ["wss://members.example"])
  assert.deepEqual([accepted[0].ok, accepted[0].code], [true, ""])
  const found = await client.query([{ kinds: [1180] }], ["wss://members.example"])
  assert.deepEqual([found.complete, found.events.map((e) => e.id)], [true, [event.id]])
  // One AUTH for the connection, for the relay's own challenge.
  assert.equal(relay.authEvents.length, 1)
  assert.equal(relay.authEvents[0].kind, 22242)
  assert.equal(relay.authEvents[0].pubkey, core.getPublicKey(alice))
  client.close()
})

test("NIP-42: a per-call null never authenticates, even with a client signer", async () => {
  const { network, client } = setup()
  const relay = network.add("wss://members.example", { auth: true })
  client.setAuthSigner(core.createSecretKeySigner(alice))
  const result = await client.publish(sign(bob, 1, "x"), ["wss://members.example"], { auth: null })
  assert.equal(result[0].code, "auth-required")
  assert.equal(relay.authEvents.length, 0)
  client.close()
})

test("subscribe: many subscriptions stay within the relay budget and each gets only its own events", async () => {
  const { network, client } = setup()
  const relay = network.add("wss://busy.example")
  const received: string[][] = Array.from({ length: 24 }, () => [])
  const eoses: number[] = []
  const closers = received.map((list, i) =>
    client.subscribe([{ kinds: [1180], "#t": [`topic-${i}`] }], ["wss://busy.example"], {
      onevent: (event) => list.push(event.content),
      oneose: () => eoses.push(i),
    }),
  )
  await until(() => eoses.length === 24)
  assert.equal(eoses.length, 24)
  for (let i = 0; i < 24; i++) await client.publish(sign(alice, 1180, `for ${i}`, [["t", `topic-${i}`]]), ["wss://busy.example"])
  await until(() => received.every((list) => list.length > 0))
  // A little longer: an event delivered to the wrong subscription would show up now.
  await wait(50)
  assert.ok(relay.maxOpenReqs <= 15, `open REQs ${relay.maxOpenReqs}`)
  received.forEach((list, i) => assert.deepEqual(list, [`for ${i}`]))
  for (const closer of closers) closer.close()
  const openReqs = () => [...relay.sockets].reduce((n, s) => n + s.subs.size, 0)
  await until(() => openReqs() === 0)
  assert.equal(openReqs(), 0)
  client.close()
})

test("subscribe: an event from two relays arrives once; EOSE reports who answered", async () => {
  const { network, client } = setup()
  const a = network.add("wss://a.example")
  const b = network.add("wss://b.example")
  network.add("wss://down.example", { mode: "down" })
  const stored = sign(alice, 1180, "stored")
  a.events.push(stored)
  b.events.push(stored)
  const seen: string[] = []
  const statuses: { answered: string[]; failed: { url: string; code: string }[] }[] = []
  const closer = client.subscribe([{ kinds: [1180] }], ["wss://a.example", "wss://b.example", "wss://down.example"], {
    onevent: (event, url) => seen.push(`${event.content}@${url}`),
    oneose: (status) => statuses.push(status),
  })
  await wait(200)
  assert.equal(seen.length, 1)
  assert.equal(statuses.length, 1)
  assert.deepEqual([...statuses[0].answered].sort(), ["wss://a.example", "wss://b.example"])
  assert.deepEqual(statuses[0].failed.map((f) => [f.url, f.code]), [["wss://down.example", "unreachable"]])
  closer.close()
  client.close()
})

test("subscribe: a relay that was down at the start is retried; a dropped connection reconnects", async () => {
  const { network, client } = setup()
  const relay = network.add("wss://flaky.example", { mode: "down" })
  const seen: string[] = []
  const closer = client.subscribe([{ kinds: [1180] }], ["wss://flaky.example"], { onevent: (event) => seen.push(event.content) })
  await wait(100)
  relay.options.mode = "up"
  relay.events.push(sign(alice, 1180, "after the outage"))
  // First retry after about one second (with jitter).
  await wait(2500)
  assert.deepEqual(seen, ["after the outage"])

  relay.dropAll()
  await wait(50)
  relay.events.push(sign(alice, 1180, "while away"))
  // nostr-core reconnects after about one second (with jitter) and repeats the REQ.
  await wait(2500)
  assert.deepEqual(seen, ["after the outage", "while away"])
  await client.publish(sign(alice, 1180, "live again"), ["wss://flaky.example"])
  await wait(50)
  assert.deepEqual(seen, ["after the outage", "while away", "live again"])
  closer.close()
  client.close()
})

test("subscribe: a relay that refuses the filters ends the subscription there and says why", async () => {
  const { network, client } = setup()
  network.add("wss://picky.example", { onReq: () => "blocked: no thanks" })
  const closes: string[] = []
  let eose = false
  client.subscribe([{ kinds: [1] }], ["wss://picky.example"], { onevent: () => {}, onclose: (url, reason) => closes.push(`${url} ${reason}`), oneose: () => (eose = true) })
  await wait(100)
  assert.deepEqual(closes, ["wss://picky.example blocked: no thanks"])
  assert.equal(eose, true)
  client.close()
})

test("clock: a large device clock error is corrected, small noise is ignored, updates always move forward", () => {
  const real = Math.floor(Date.now() / 1000)
  adjustClock(new Date(Date.now() - 20 * 60 * 1000))
  assert.ok(Math.abs(nowSeconds() - (real - 1200)) <= 2)
  adjustClock(new Date(Date.now() + 10 * 1000))
  assert.ok(Math.abs(nowSeconds() - real) <= 1)
  adjustClock("not a date")
  assert.ok(Math.abs(nowSeconds() - real) <= 1)
  const now = nowSeconds()
  assert.ok(createdAt() >= now)
  assert.ok(createdAt(now - 50) >= now)
  assert.equal(createdAt(now + 5), now + 6)
  // A version from a clock far ahead can't be outrun without relays refusing the event.
  assert.ok(createdAt(now + 5000) <= now + 601)
})

test("no unhandled rejections were left behind", async () => {
  await wait(50)
  assert.deepEqual(unhandled, [])
})

