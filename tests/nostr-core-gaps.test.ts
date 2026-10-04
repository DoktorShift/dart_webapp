// Gaps in nostr-core 1.0.4, each as a minimal reproduction against the library itself
// (docs/implementation/evidence/P0.03/CORE.md; NC numbers from the P0.01 research). These tests
// pin today's behaviour on purpose: when one fails after an upgrade, the gap is fixed upstream
// and the workaround named in the test can be retired. Gaps already reproduced next to their
// workaround are listed at the end.
import { after, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import * as core from "nostr-core"
import { finalizeEvent, generateSecretKey, getPowDifficulty, getPublicKey, minePow, nip44, Nip07Signer, NWC, parseConnectionURI, RelayPool } from "nostr-core"
import { createRelayClient, type RelayClient } from "../lib/nostr/client.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { FakeNetwork } from "./support/fake-relay.ts"

const clients: RelayClient[] = []
after(() => clients.forEach((client) => client.close()))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("NC-02: the package declares no sideEffects, so bundlers keep RSS, Markdown and mnemonics (lib/nostr/runtime.ts imports names)", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../node_modules/nostr-core/package.json"), "utf8"))
  assert.equal(manifest.version, "1.0.4")
  assert.equal(manifest.sideEffects, undefined)
})

test("NC-04: a nostrconnect:// link's host (the client key) is read as the signer's key (ext/nostrconnect.ts)", () => {
  const client = getPublicKey(generateSecretKey())
  const parsed = parseConnectionURI(`nostrconnect://${client}?relay=wss%3A%2F%2Fr.example&secret=0123456789abcdef&perms=sign_event`)
  assert.equal(parsed.remotePubkey, client)
  // Nothing creates such a link or waits for the signer's answer.
  assert.equal(Object.keys(core).some((name) => /clienturi|nostrconnecturi|waitforsigner/i.test(name)), false)
})

test("NC-06, NC-07: no NIP-49 and no NIP-55 (ext/nip49.ts, ext/nip55.ts)", () => {
  const names = Object.keys(core)
  assert.equal(names.some((name) => /nip49|ncryptsec/i.test(name)), false)
  assert.equal(names.some((name) => /nip55|nostrsigner/i.test(name)), false)
})

test("NC-09: private list items passed without a key are dropped silently (ext/lists.ts refuses)", () => {
  const template = core.nip51.createListEventTemplate({ kind: 30000, identifier: "x", publicItems: [], privateItems: [{ tag: "p", value: "a".repeat(64) }] })
  assert.equal(template.content, "")
})

test("NC-10: RelayPool can't tell 'every relay failed' from 'nothing there', and publish names no relay (client.ts)", async () => {
  const network = new FakeNetwork()
  network.add("wss://up.example")
  network.add("wss://down.example", { mode: "down" })
  const pool = new RelayPool({ websocketImplementation: network.WebSocket, maxWaitForConnection: 200 })
  const allDown = await pool.querySync(["wss://down.example"], { kinds: [1] })
  const empty = await pool.querySync(["wss://up.example"], { kinds: [1] })
  assert.deepEqual([allDown, empty], [[], []])
  const event = finalizeEvent({ kind: 1, content: "x", tags: [], created_at: 1_790_000_000 }, generateSecretKey())
  // One relay accepted, one was unreachable: the answer is a bare list of OK messages.
  assert.deepEqual(await pool.publish(["wss://up.example", "wss://down.example"], event), [""])
  pool.close()
})

test("NC-11, NC-12: NWC sends pay_invoice twice when the wallet's answer can't be read, and no encryption tag (lib/payments must use verifyEncryption and the journal)", async () => {
  const network = new FakeNetwork()
  network.add("wss://wallet.example")
  const walletKey = generateSecretKey()
  const walletPubkey = getPublicKey(walletKey)
  const service = createRelayClient({ websocket: network.WebSocket })
  clients.push(service)
  // The wallet advertises NIP-44 and NIP-04 (kind 13194), as Alby Hub and Coinos do.
  await service.publish(finalizeEvent({ kind: 13194, content: "pay_invoice get_info", tags: [["encryption", "nip44_v2 nip04"]], created_at: 1_790_000_000 }, walletKey), ["wss://wallet.example"])
  const requests: { method: string; tags: string[][] }[] = []
  service.subscribe([{ kinds: [23194], "#p": [walletPubkey] }], ["wss://wallet.example"], {
    onevent: (event: NostrEvent) => {
      let method = "unreadable"
      try {
        method = JSON.parse(nip44.decrypt(event.content, nip44.getConversationKey(walletKey, event.pubkey))).method
      } catch {
        try {
          method = JSON.parse(core.nip04.decrypt(walletKey, event.pubkey, event.content)).method
        } catch {
          // stays "unreadable"
        }
      }
      requests.push({ method, tags: event.tags })
      // get_info is answered properly; a payment is made, then its answer gets garbled on the way back.
      const content = method === "get_info" ? nip44.encrypt(JSON.stringify({ result_type: "get_info", result: { methods: ["pay_invoice"] } }), nip44.getConversationKey(walletKey, event.pubkey)) : "garbled"
      void service.publish(finalizeEvent({ kind: 23195, content, tags: [["p", event.pubkey], ["e", event.id]], created_at: 1_790_000_000 }, walletKey), ["wss://wallet.example"])
    },
  })
  await wait(50)
  const pay = async (verifyEncryption: boolean) => {
    requests.length = 0
    const original = globalThis.WebSocket
    globalThis.WebSocket = network.WebSocket
    const nwc = new NWC(`nostr+walletconnect://${walletPubkey}?relay=wss%3A%2F%2Fwallet.example&secret=${bytesToHex(generateSecretKey())}`)
    try {
      await nwc.connect({ verifyEncryption })
      await assert.rejects(nwc.payInvoice("lnbc210n1fake"))
    } finally {
      nwc.close()
      globalThis.WebSocket = original
    }
    return requests.map((request) => request.method)
  }
  assert.deepEqual(await pay(false), ["pay_invoice", "pay_invoice"])
  assert.deepEqual(requests[0].tags, [["p", walletPubkey]])
  // The workaround: one get_info round trip pins the scheme, and the payment is sent once.
  assert.deepEqual(await pay(true), ["get_info", "pay_invoice"])
})

test("NC-17: minePow mines with a placeholder key, so the signed event misses the target", () => {
  const key = hexToBytes("7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a")
  const mined = minePow({ kind: 1, content: "pow", tags: [], created_at: 1_790_000_000 }, 12)
  assert.ok(getPowDifficulty(finalizeEvent(mined, key)) < 12)
})

test("NC-22: Nip07Signer passes through whatever the extension returns, even an unsigned event (signers.ts verifies)", async () => {
  const pubkey = getPublicKey(generateSecretKey())
  const scope = globalThis as unknown as { window?: unknown }
  scope.window = { nostr: { getPublicKey: async () => pubkey, signEvent: async (event: object) => ({ ...event, pubkey }) } }
  try {
    const event = await new Nip07Signer().signEvent({ kind: 1, content: "x", tags: [], created_at: 1_790_000_000 })
    assert.equal("sig" in event, false)
  } finally {
    delete scope.window
  }
})

// Reproduced next to their workaround:
// - NC-09 parseList shows unreadable private items as an empty list: tests/nostr-lists.test.ts
// - NC-14 validateZapReceipt accepts any signer: tests/nostr-validate.test.ts
// - NC-15 validateBadgeAward accepts any issuer: tests/nostr-validate.test.ts
// - NC-16 parseRelayList throws on one bad URL: tests/nostr-lists.test.ts
// - PR-06 unwrap doesn't check the rumor id: tests/nostr-crypto.test.ts
// - NC-05 bunker secret single-use, no resume: tests/relay/nip46.test.ts
