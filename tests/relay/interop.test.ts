// Our NIP-44, NIP-59 and NIP-49 against nak's independent implementations (no relay needed,
// but nak is). Run: npm run test:relay
import { before, test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bytesToHex } from "@noble/hashes/utils.js"
import { loadCore, type Core } from "../../lib/nostr/core.ts"
import { giftWrapWithSigner, unwrapWithSigner } from "../../lib/nostr/ext/crypto.ts"
import { decrypt as nip49Decrypt, encrypt as nip49Encrypt } from "../../lib/nostr/ext/nip49.ts"
import { createLocalSigner } from "../../lib/nostr/signers.ts"
import type { NostrEvent, Signer } from "../../lib/nostr/types.ts"
import { runNak } from "../support/nak.ts"

let core: Core
let aliceKey: Uint8Array
let bobKey: Uint8Array
let alice: Signer
let bob: Signer
let alicePub: string
let bobPub: string
// nak looks for "decoupled keys" in its config; an empty HOME keeps it to the given keys.
const env = { HOME: mkdtempSync(join(tmpdir(), "nak-")) }
process.on("exit", () => rmSync(env.HOME, { recursive: true, force: true }))

before(async () => {
  core = await loadCore()
  aliceKey = core.generateSecretKey()
  bobKey = core.generateSecretKey()
  alice = await createLocalSigner(aliceKey)
  bob = await createLocalSigner(bobKey)
  alicePub = core.getPublicKey(aliceKey)
  bobPub = core.getPublicKey(bobKey)
})

test("NIP-44: ours to nak and nak to ours", async () => {
  const text = "Spielstand 501: 121 Rest, Doppel 20 offen. Grüße!"
  const ours = await alice.nip44!.encrypt(bobPub, text)
  assert.equal(await runNak(["decrypt", "--sec", bytesToHex(bobKey), "-p", alicePub, ours], { env }), text)
  const theirs = await runNak(["encrypt", "--sec", bytesToHex(aliceKey), "-p", bobPub, text], { env })
  assert.equal(await bob.nip44!.decrypt(alicePub, theirs), text)
})

test("NIP-59: our gift wrap opens in nak; nak's gift wrap opens with our signer-based unwrap", async () => {
  const { rumor, wrap } = await giftWrapWithSigner({ kind: 1180, content: "Zahlungsanfrage 21 sats", tags: [["l", "payment.request", "blueline"]], created_at: 1_790_000_000 }, alice, bobPub)
  const opened = JSON.parse(await runNak(["gift", "unwrap", "--sec", bytesToHex(bobKey)], { input: JSON.stringify(wrap), env })) as NostrEvent
  assert.equal(opened.id, rumor.id)
  assert.equal(opened.pubkey, alicePub)
  assert.equal(opened.content, "Zahlungsanfrage 21 sats")

  const event = await runNak(["event", "--sec", bytesToHex(aliceKey), "-k", "1180", "-c", "von nak verpackt"], { env })
  const nakWrap = JSON.parse(
    await runNak(["gift", "wrap", "--sec", bytesToHex(aliceKey), "-p", bobPub, "--use-our-identity-key", "--use-their-identity-key"], { input: event, env }),
  ) as NostrEvent
  const { rumor: fromNak, sender } = await unwrapWithSigner(nakWrap, bob)
  assert.equal(sender, alicePub)
  assert.equal(fromNak.content, "von nak verpackt")
})

test("NIP-49: our ncryptsec decrypts in nak and nak's in ours, including an umlaut password", async () => {
  const key = core.generateSecretKey()
  for (const password of ["nostr", "Grüße aus Köln 🎯"]) {
    const ours = nip49Encrypt(key, password, { logN: 16 })
    assert.equal(await runNak(["key", "decrypt", ours, password], { env }), bytesToHex(key))
    const theirs = await runNak(["key", "encrypt", bytesToHex(key), password], { env })
    assert.equal(bytesToHex(nip49Decrypt(theirs, password).secretKey), bytesToHex(key))
  }
  // The same password, typed composed in nak and decomposed here (u + combining diaeresis).
  const composed = await runNak(["key", "encrypt", bytesToHex(key), "Gr\u00fc\u00dfe"], { env })
  assert.equal(bytesToHex(nip49Decrypt(composed, "Gru\u0308\u00dfe").secretKey), bytesToHex(key))
})

test("signatures from the verifying signer pass nak verify", async () => {
  const event = await alice.signEvent({ kind: 1180, content: "geprüft", tags: [["L", "blueline"], ["v", "1"]], created_at: 1_790_000_000 })
  await runNak(["verify"], { input: JSON.stringify(event), env })
  const forged = { ...event, content: "verändert" }
  await assert.rejects(runNak(["verify"], { input: JSON.stringify(forged), env }))
})
