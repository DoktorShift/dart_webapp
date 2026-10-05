// lib/nostr/client.ts against real relays (nak serve on 127.0.0.1). Run: npm run test:relay
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { loadCore, type Core } from "../../lib/nostr/core.ts"
import { createRelayClient, type RelayClient } from "../../lib/nostr/client.ts"
import { createLocalSigner } from "../../lib/nostr/signers.ts"
import type { NostrEvent } from "../../lib/nostr/types.ts"
import { startRelay, type NakRelay } from "../support/nak.ts"

let core: Core
let key: Uint8Array
let a: NakRelay
let b: NakRelay
const clients: RelayClient[] = []
const unhandled: unknown[] = []
process.on("unhandledRejection", (reason) => unhandled.push(reason))

const client = () => {
  const created = createRelayClient({ connectTimeoutMs: 2000, publishTimeoutMs: 3000, queryTimeoutMs: 3000 })
  clients.push(created)
  return created
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const sign = (kind: number, content: string, tags: string[][] = [], at = Math.floor(Date.now() / 1000)): NostrEvent =>
  core.finalizeEvent({ kind, content, tags, created_at: at }, key)

before(async () => {
  core = await loadCore()
  key = core.generateSecretKey()
  ;[a, b] = await Promise.all([startRelay(), startRelay()])
})

after(async () => {
  for (const c of clients) c.close()
  await Promise.all([a?.stop(), b?.stop()])
})

test("publish and query round trip on two relays; query merges and deduplicates", async () => {
  const c = client()
  const event = sign(1180, "Ergebnis", [["L", "blueline"], ["l", "match.result", "blueline"], ["v", "1"]])
  const results = await c.publish(event, [a.url, b.url])
  assert.deepEqual(results.map((r) => [r.ok, r.code]), [[true, ""], [true, ""]])
  // Sending it again is fine: the relay already has it. (nak answers OK true without a reason;
  // strfry says "duplicate:", which the unit tests cover.)
  const [again] = await c.publish(event, [a.url])
  assert.equal(again.ok, true, again.reason)
  const found = await client().query([{ kinds: [1180], authors: [event.pubkey] }], [a.url, b.url])
  assert.equal(found.complete, true)
  assert.deepEqual(found.answered.sort(), [a.url, b.url].sort())
  assert.deepEqual(found.events.map((e) => e.id), [event.id])
})

test("replaceable and addressable: the newest version wins across relays", async () => {
  const c = client()
  const t = Math.floor(Date.now() / 1000) - 60
  const oldCard = sign(31180, "v1", [["d", "stats"]], t)
  const newCard = sign(31180, "v2", [["d", "stats"]], t + 30)
  await c.publish(oldCard, [a.url])
  await c.publish(newCard, [b.url])
  const found = await client().query([{ kinds: [31180], authors: [newCard.pubkey], "#d": ["stats"] }], [a.url, b.url])
  assert.deepEqual(found.events.map((e) => e.content), ["v2"])
})

test("OK reasons from a real relay: mute for an ephemeral event nobody listens to, invalid for a bad signature", async () => {
  const c = client()
  const [ephemeral] = await c.publish(sign(21180, "handshake"), [a.url])
  assert.deepEqual([ephemeral.ok, ephemeral.code], [false, "mute"])
  const good = sign(1180, "signed")
  const [forged] = await c.publish({ ...good, content: "changed after signing" }, [a.url])
  assert.equal(forged.ok, false)
  assert.equal(forged.code, "invalid", forged.reason)
  assert.deepEqual(unhandled, [])
})

test("empty is not failed: a stopped relay is unreachable; all relays down means unknown", async () => {
  const gone = await startRelay()
  const goneUrl = gone.url
  await gone.stop()
  const c = client()
  const partial = await c.query([{ kinds: [9999] }], [a.url, goneUrl])
  assert.deepEqual([partial.events.length, partial.answered, partial.complete], [0, [a.url], false])
  assert.deepEqual(partial.failed.map((f) => [f.url, f.code]), [[goneUrl, "unreachable"]])
  const unknown = await c.query([{ kinds: [9999] }], [goneUrl])
  assert.deepEqual([unknown.answered.length, unknown.complete], [0, false])
  const empty = await c.query([{ kinds: [9999] }], [a.url, b.url])
  assert.deepEqual([empty.events.length, empty.complete], [0, true])
  const [publishFailed] = await c.publish(sign(1180, "nowhere"), [goneUrl])
  assert.deepEqual([publishFailed.ok, publishFailed.code], [false, "unreachable"])
  await wait(100)
  assert.deepEqual(unhandled, [])
})

test("NIP-42 with nak serve --auth: refused without a signer, accepted after one AUTH", async () => {
  const guarded = await startRelay({ auth: true })
  try {
    const c = client()
    const event = sign(1180, "nur für Mitglieder")
    const [refused] = await c.publish(event, [guarded.url])
    assert.deepEqual([refused.ok, refused.code], [false, "auth-required"])
    const closed = await c.query([{ kinds: [1180] }], [guarded.url])
    assert.deepEqual(closed.failed.map((f) => f.code), ["auth-required"])

    c.setAuthSigner(await createLocalSigner(key))
    const [accepted] = await c.publish(event, [guarded.url])
    assert.deepEqual([accepted.ok, accepted.code], [true, ""])
    const found = await c.query([{ kinds: [1180] }], [guarded.url])
    assert.deepEqual([found.complete, found.events.map((e) => e.id)], [true, [event.id]])

    // A subscription on a fresh client authenticates when the relay asks.
    const live = client()
    live.setAuthSigner(await createLocalSigner(key))
    const seen: string[] = []
    const closer = live.subscribe([{ kinds: [1180] }], [guarded.url], { onevent: (e) => seen.push(e.content) })
    await wait(800)
    assert.deepEqual(seen, ["nur für Mitglieder"])
    closer.close()
  } finally {
    await guarded.stop()
  }
})

test("subscribe: live events arrive; after a relay restart the subscription comes back by itself", async () => {
  const relay = await startRelay()
  const port = relay.port
  const live = client()
  const seen: string[] = []
  let eose = 0
  const closer = live.subscribe([{ kinds: [1180], "#t": ["live"] }], [relay.url], { onevent: (e) => seen.push(e.content), oneose: () => eose++ })
  await wait(300)
  assert.equal(eose, 1)
  await client().publish(sign(1180, "first", [["t", "live"]]), [relay.url])
  await wait(300)
  assert.deepEqual(seen, ["first"])

  await relay.stop()
  await wait(300)
  const restarted = await startRelay({ port })
  try {
    // nostr-core reconnects with backoff (about 1 s, then 2 s, ...).
    await wait(3500)
    await client().publish(sign(1180, "after restart", [["t", "live"]]), [restarted.url])
    await wait(500)
    assert.deepEqual(seen, ["first", "after restart"])
  } finally {
    closer.close()
    await restarted.stop()
  }
})

test("subscribe: thirty subscriptions on one relay each get exactly their events", async () => {
  const live = client()
  const received: string[][] = Array.from({ length: 30 }, () => [])
  const closers = received.map((list, i) => live.subscribe([{ kinds: [1180], "#t": [`board-${i}`] }], [a.url], { onevent: (e) => list.push(e.content) }))
  await wait(500)
  const publisher = client()
  await Promise.all(received.map((_, i) => publisher.publish(sign(1180, `Board ${i}`, [["t", `board-${i}`]]), [a.url])))
  await wait(800)
  received.forEach((list, i) => assert.deepEqual(list, [`Board ${i}`]))
  for (const closer of closers) closer.close()
  assert.deepEqual(unhandled, [])
})
