import { before, test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import {
  CryptoError,
  decryptWithDataKey,
  encryptWithDataKey,
  generateDataKey,
  giftWrapWithSigner,
  opaqueDTag,
  sealWithSigner,
  unwrapDataKey,
  unwrapWithSigner,
  wrapDataKey,
} from "../lib/nostr/ext/crypto.ts"
import type { EventTemplate, NostrEvent, Signer } from "../lib/nostr/types.ts"
// nostr-core directly: its raw-key NIP-59 helpers are the reference the signer variants must match.
import { createSeal, unwrap } from "nostr-core"

let core: Core
let aliceKey: Uint8Array
let bobKey: Uint8Array
let alice: Signer
let bob: Signer

before(async () => {
  core = await loadCore()
  aliceKey = core.generateSecretKey()
  bobKey = core.generateSecretKey()
  alice = core.createSecretKeySigner(aliceKey)
  bob = core.createSecretKeySigner(bobKey)
})

const request = (): EventTemplate => ({ kind: 1180, content: '{"amount_msat":21000}', tags: [["l", "payment.request", "blueline"]], created_at: 1_790_000_000 })

async function codeOf(promise: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof promise === "function" ? promise() : promise)
    return "no error"
  } catch (error) {
    assert.ok(error instanceof CryptoError, String(error))
    return error.code
  }
}

test("NIP-59 with signers: wrap for Bob, Bob unwraps the rumor and learns the real sender", async () => {
  const { rumor, wrap } = await giftWrapWithSigner(request(), alice, core.getPublicKey(bobKey))
  assert.equal(wrap.kind, 1059)
  assert.deepEqual(wrap.tags, [["p", core.getPublicKey(bobKey)]])
  assert.notEqual(wrap.pubkey, core.getPublicKey(aliceKey))
  const opened = await unwrapWithSigner(wrap, bob)
  assert.equal(opened.sender, core.getPublicKey(aliceKey))
  assert.deepEqual(opened.rumor, rumor)
  // nostr-core's raw-key unwrap reads the same wrap: both sides speak plain NIP-59.
  assert.equal(unwrap(wrap, bobKey).id, rumor.id)
  // And our signer-based unwrap reads nostr-core's raw-key wrap.
  const theirs = core.createWrap(createSeal(core.createRumor(request(), core.getPublicKey(aliceKey)), aliceKey, core.getPublicKey(bobKey)), core.getPublicKey(bobKey))
  assert.equal((await unwrapWithSigner(theirs, bob)).sender, core.getPublicKey(aliceKey))
})

test("NIP-59 with signers: the ephemeral variant (21059) works the same way, dated now", async () => {
  const { wrap } = await giftWrapWithSigner(request(), alice, core.getPublicKey(bobKey), 21059)
  assert.equal(wrap.kind, 21059)
  // Relays drop ephemeral events that look older than a minute, so no blurred time here.
  assert.ok(Math.abs(wrap.created_at - Math.floor(Date.now() / 1000)) <= 2)
  assert.equal((await unwrapWithSigner(wrap, bob)).sender, core.getPublicKey(aliceKey))
})

test("NIP-59 with signers: a signed event passed as template leaves its signature out of the rumor", async () => {
  const signed = core.finalizeEvent(request(), aliceKey)
  const { rumor, wrap } = await giftWrapWithSigner(signed, alice, core.getPublicKey(bobKey))
  assert.deepEqual(Object.keys(rumor).sort(), ["content", "created_at", "id", "kind", "pubkey", "tags"])
  assert.equal(rumor.id, signed.id)
  assert.equal("sig" in unwrap(wrap, bobKey), false)
})

// A wrap built by hand around any seal, to test forgeries.
async function wrapAround(seal: NostrEvent, recipient: string) {
  return core.createWrap(seal, recipient)
}

test("NIP-59 with signers: a rumor whose id doesn't match its content is refused (nostr-core accepts it)", async () => {
  const bobPub = core.getPublicKey(bobKey)
  const rumor = { ...core.createRumor(request(), core.getPublicKey(aliceKey)), content: '{"amount_msat":1}' }
  const seal = core.finalizeEvent({ kind: 13, tags: [], created_at: 1_790_000_000, content: await alice.nip44!.encrypt(bobPub, JSON.stringify(rumor)) }, aliceKey)
  const wrap = await wrapAround(seal, bobPub)
  assert.equal(await codeOf(unwrapWithSigner(wrap, bob)), "forged")
  assert.equal(unwrap(wrap, bobKey).content, '{"amount_msat":1}')
})

test("NIP-59 with signers: a seal claiming another author, broken signatures, foreign wraps are refused", async () => {
  const bobPub = core.getPublicKey(bobKey)
  const mallory = core.generateSecretKey()
  // Mallory seals a rumor that claims Alice wrote it.
  const claimed = core.createRumor(request(), core.getPublicKey(aliceKey))
  const sealByMallory = core.finalizeEvent(
    { kind: 13, tags: [], created_at: 1_790_000_000, content: await core.createSecretKeySigner(mallory).nip44!.encrypt(bobPub, JSON.stringify(claimed)) },
    mallory,
  )
  assert.equal(await codeOf(unwrapWithSigner(await wrapAround(sealByMallory, bobPub), bob)), "forged")
  const { wrap } = await giftWrapWithSigner(request(), alice, bobPub)
  assert.equal(await codeOf(unwrapWithSigner({ ...wrap, sig: "00".repeat(64) }, bob)), "forged")
  assert.equal(await codeOf(unwrapWithSigner(wrap, alice)), "undecryptable")
  assert.equal(await codeOf(unwrapWithSigner({ ...wrap, kind: 4 }, bob)), "malformed")
  assert.equal(await codeOf(giftWrapWithSigner(request(), { getPublicKey: alice.getPublicKey, signEvent: alice.signEvent }, bobPub)), "no-nip44")
})

test("NIP-59 with signers: seals carry no tags and a blurred time", async () => {
  const { seal } = await sealWithSigner(request(), alice, core.getPublicKey(bobKey))
  assert.equal(seal.kind, 13)
  assert.deepEqual(seal.tags, [])
  const now = Math.floor(Date.now() / 1000)
  assert.ok(seal.created_at <= now && seal.created_at >= now - 2 * 24 * 60 * 60)
})

test("data key: encrypt and decrypt under a random 32-byte key; wrong key, wrong record or damage fail", async () => {
  const key = generateDataKey()
  assert.equal(key.length, 32)
  const envelope = encryptWithDataKey(key, "Spiel 501, 3:1 gewonnen", "match:abc")
  assert.equal(decryptWithDataKey(key, envelope, "match:abc"), "Spiel 501, 3:1 gewonnen")
  assert.notEqual(encryptWithDataKey(key, "x"), encryptWithDataKey(key, "x"))
  // version 1, 24-byte nonce, 16-byte tag
  assert.equal(Buffer.from(envelope, "base64")[0], 1)
  assert.equal(Buffer.from(envelope, "base64").length, 1 + 24 + Buffer.byteLength("Spiel 501, 3:1 gewonnen") + 16)
  assert.equal(await codeOf(() => decryptWithDataKey(generateDataKey(), envelope, "match:abc")), "undecryptable")
  assert.equal(await codeOf(() => decryptWithDataKey(key, envelope, "match:other")), "undecryptable")
  const damaged = Buffer.from(envelope, "base64")
  damaged[30] ^= 1
  assert.equal(await codeOf(() => decryptWithDataKey(key, damaged.toString("base64"), "match:abc")), "undecryptable")
  const future = Buffer.from(envelope, "base64")
  future[0] = 2
  assert.equal(await codeOf(() => decryptWithDataKey(key, future.toString("base64"), "match:abc")), "malformed")
  assert.equal(await codeOf(() => decryptWithDataKey(key, "AAAA", "match:abc")), "malformed")
  assert.equal(await codeOf(() => encryptWithDataKey(new Uint8Array(16), "x")), "wrong-key")
})

test("data key: wrapped once for the profile itself; only that profile's signer unwraps it", async () => {
  const key = generateDataKey()
  const wrapped = await wrapDataKey(key, alice)
  assert.equal(bytesToHex(await unwrapDataKey(wrapped, alice)), bytesToHex(key))
  assert.equal(await codeOf(unwrapDataKey(wrapped, bob)), "undecryptable")
  // It's plain NIP-44 to self: nostr-core's primitives read it too.
  const conversation = core.nip44.getConversationKey(aliceKey, core.getPublicKey(aliceKey))
  assert.equal(core.nip44.decrypt(wrapped, conversation), bytesToHex(key))
})

test("opaque d tag: HMAC-SHA256(data key, record id) in hex, same on every device", () => {
  const key = hexToBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
  const expected = createHmac("sha256", Buffer.from(key)).update("match:pl_2f0c").digest("hex")
  assert.equal(opaqueDTag(key, "match:pl_2f0c"), expected)
  assert.equal(opaqueDTag(key, "match:pl_2f0c"), opaqueDTag(Uint8Array.from(key), "match:pl_2f0c"))
  assert.notEqual(opaqueDTag(key, "match:pl_2f0d"), expected)
  assert.match(expected, /^[0-9a-f]{64}$/)
})
