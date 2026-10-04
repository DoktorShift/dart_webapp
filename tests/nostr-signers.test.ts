import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { Nip46RequestError } from "../lib/nostr/ext/nostrconnect.ts"
import { connectBunker, connectNip07, createLocalSigner, probeNip44, SignerError, verifyingSigner } from "../lib/nostr/signers.ts"
import type { EventTemplate, Signer, VerifiedEvent } from "../lib/nostr/types.ts"

let core: Core
let alice: Uint8Array
let mallory: Uint8Array
let alicePub: string

before(async () => {
  core = await loadCore()
  alice = core.generateSecretKey()
  mallory = core.generateSecretKey()
  alicePub = core.getPublicKey(alice)
})

const template = (): EventTemplate => ({ kind: 1180, content: "Ergebnis", tags: [["L", "blueline"], ["v", "1"]], created_at: 1_790_000_000 })

// A signer that misbehaves in a chosen way.
function rogue(change: (event: VerifiedEvent, template: EventTemplate) => unknown): Signer {
  return {
    getPublicKey: async () => alicePub,
    // finalizeEvent writes into the object it gets; sign a copy so `t` stays the request.
    signEvent: async (t) => change(core.finalizeEvent({ ...t, tags: t.tags.map((tag) => [...tag]) }, alice), t) as VerifiedEvent,
  }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return "no error"
  } catch (error) {
    assert.ok(error instanceof SignerError, `expected SignerError, got ${error}`)
    return error.code
  }
}

test("verifyingSigner: a correct signature passes and comes back without extra fields", async () => {
  const signer = verifyingSigner(rogue((event) => ({ ...event, extra: "field" })), alicePub)
  const event = await signer.signEvent(template())
  assert.equal(event.pubkey, alicePub)
  assert.deepEqual(Object.keys(event).sort(), ["content", "created_at", "id", "kind", "pubkey", "sig", "tags"])
  assert.ok(core.verifyEventSignature(event))
})

test("verifyingSigner: other key, changed event, bad signature or no event are refused", async () => {
  const cases: [string, (event: VerifiedEvent, t: EventTemplate) => unknown][] = [
    ["other key", (_e, t) => core.finalizeEvent(t, mallory)],
    ["changed content", (_e, t) => core.finalizeEvent({ ...t, content: "Manipuliert" }, alice)],
    ["changed tags", (_e, t) => core.finalizeEvent({ ...t, tags: [...t.tags, ["p", alicePub]] }, alice)],
    ["changed time", (_e, t) => core.finalizeEvent({ ...t, created_at: t.created_at + 1 }, alice)],
    ["changed kind", (_e, t) => core.finalizeEvent({ ...t, kind: 1 }, alice)],
    ["bad signature", (event) => ({ ...event, sig: event.sig.replace(/^./, event.sig[0] === "a" ? "b" : "a") })],
    ["id not matching", (event) => ({ ...event, id: "0".repeat(64) })],
    ["unsigned object", (_e, t) => ({ ...t, pubkey: alicePub })],
    ["nothing", () => null],
  ]
  for (const [name, change] of cases) {
    assert.equal(await codeOf(verifyingSigner(rogue(change), alicePub).signEvent(template())), "mismatch", name)
  }
})

test("verifyingSigner: the caller's template stays untouched, whatever the signer does with its copy", async () => {
  const original = template()
  // nostr-core's local signer writes id, pubkey and sig into the object it signs.
  const mutating = rogue((event, t) => {
    t.content = "Manipuliert"
    return event
  })
  await verifyingSigner(core.createSecretKeySigner(alice), alicePub).signEvent(original)
  assert.deepEqual(Object.keys(original).sort(), ["content", "created_at", "kind", "tags"])
  assert.equal(await codeOf(verifyingSigner(mutating, alicePub).signEvent(original)), "no error")
  assert.equal(original.content, "Ergebnis")
})

test("verifyingSigner: a signer that switched identity is noticed", async () => {
  const switched: Signer = { getPublicKey: async () => core.getPublicKey(mallory), signEvent: async (t) => core.finalizeEvent(t, mallory) }
  assert.equal(await codeOf(verifyingSigner(switched, alicePub).getPublicKey()), "mismatch")
  assert.equal(await codeOf(verifyingSigner(switched, alicePub).signEvent(template())), "mismatch")
})

test("verifyingSigner: errors become codes; a timeout is unknown, never refused", async () => {
  const failing = (error: unknown): Signer => ({
    getPublicKey: async () => alicePub,
    signEvent: async () => {
      throw error
    },
    nip44: {
      encrypt: async () => {
        throw error
      },
      decrypt: async () => {
        throw error
      },
    },
  })
  assert.equal(await codeOf(verifyingSigner(failing(new Nip46RequestError("timeout", "no answer")), alicePub).signEvent(template())), "unknown")
  assert.equal(await codeOf(verifyingSigner(failing(new Nip46RequestError("rejected", "denied")), alicePub).signEvent(template())), "rejected")
  assert.equal(await codeOf(verifyingSigner(failing(new Nip46RequestError("unreachable", "no relay")), alicePub).signEvent(template())), "unavailable")
  const unsupported = Object.assign(new Error("Extension does not support NIP-44"), { code: "NIP07_NIP44_UNSUPPORTED" })
  assert.equal(await codeOf(verifyingSigner(failing(unsupported), alicePub).nip44!.encrypt(alicePub, "x")), "unsupported")
  assert.equal(await codeOf(verifyingSigner(failing(new Error("User rejected")), alicePub).signEvent(template())), "rejected")
})

test("verifyingSigner: capabilities can hide NIP-44 the signer object pretends to have", async () => {
  const inner = core.createSecretKeySigner(alice)
  assert.ok(verifyingSigner(inner, alicePub).nip44)
  assert.equal(verifyingSigner(inner, alicePub, { nip44: false }).nip44, undefined)
})

test("createLocalSigner: signs verified events and encrypts; refuses keys of the wrong size", async () => {
  const signer = await createLocalSigner(alice)
  assert.equal(await signer.getPublicKey(), alicePub)
  const event = await signer.signEvent(template())
  assert.ok(core.verifyEventSignature(event))
  assert.equal(await signer.nip44!.decrypt(alicePub, await signer.nip44!.encrypt(alicePub, "geheim")), "geheim")
  assert.equal(await probeNip44(signer, alicePub), true)
  assert.equal(await codeOf(createLocalSigner(new Uint8Array(16))), "invalid")
})

test("probeNip44: false when the signer can't encrypt or decrypts to something else", async () => {
  assert.equal(await probeNip44({ getPublicKey: async () => alicePub, signEvent: async (t) => core.finalizeEvent(t, alice) }, alicePub), false)
  const broken: Signer = { ...core.createSecretKeySigner(alice), nip44: { encrypt: async () => "x", decrypt: async () => "y" } }
  assert.equal(await probeNip44(broken, alicePub), false)
})

// --- NIP-07 with a fake extension ----------------------------------------------------------------

const globals = globalThis as unknown as { window?: { nostr?: unknown } }

after(() => {
  delete globals.window
})

function fakeExtension(options: { nip44?: boolean; decline?: boolean } = {}) {
  const inner = core.createSecretKeySigner(alice)
  return {
    getPublicKey: async () => {
      if (options.decline) throw new Error("User rejected")
      return alicePub
    },
    signEvent: (t: EventTemplate) => inner.signEvent(t),
    ...(options.nip44 ? { nip44: inner.nip44 } : {}),
  }
}

test("connectNip07: waits for an extension that injects late and reports NIP-44", async () => {
  globals.window = {}
  setTimeout(() => (globals.window!.nostr = fakeExtension({ nip44: true })), 150)
  const connected = await connectNip07({ timeoutMs: 1000, intervalMs: 20 })
  assert.equal(connected.pubkey, alicePub)
  assert.equal(connected.nip44, true)
  assert.ok(connected.signer.nip44)
  assert.ok(core.verifyEventSignature(await connected.signer.signEvent(template())))
})

test("connectNip07: without NIP-44 the signer offers none; no extension is unavailable; declining is rejected", async () => {
  globals.window = { nostr: fakeExtension() }
  const plain = await connectNip07({ timeoutMs: 100 })
  assert.equal(plain.nip44, false)
  assert.equal(plain.signer.nip44, undefined)
  globals.window = {}
  assert.equal(await codeOf(connectNip07({ timeoutMs: 100, intervalMs: 20 })), "unavailable")
  globals.window = { nostr: fakeExtension({ decline: true }) }
  assert.equal(await codeOf(connectNip07({ timeoutMs: 100 })), "rejected")
})

test("connectBunker: links that aren't bunker:// or lack a valid key are invalid, without network", async () => {
  assert.equal(await codeOf(connectBunker("nostrconnect://abc?relay=wss://r.example")), "invalid")
  assert.equal(await codeOf(connectBunker("bunker://not-a-key?relay=wss%3A%2F%2Fr.example")), "invalid")
  assert.equal(await codeOf(connectBunker(`bunker://${alicePub}`)), "invalid")
})
