import { test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { bech32 } from "@scure/base"
import { decrypt, decryptAsync, encrypt, encryptAsync, inspect, Nip49Error, normalizePassword } from "../lib/nostr/ext/nip49.ts"
import { decryptOffThread, encryptOffThread, usesWorker } from "../lib/nostr/ext/nip49.offthread.ts"

// The official NIP-49 test vector.
const VECTOR =
  "ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p"
const VECTOR_KEY = "3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683"

const key = hexToBytes("7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a")

test("NIP-49: the official test vector decrypts with password 'nostr' at log_n 16", () => {
  const result = decrypt(VECTOR, "nostr")
  assert.equal(bytesToHex(result.secretKey), VECTOR_KEY)
  assert.equal(result.logN, 16)
  assert.deepEqual(inspect(VECTOR), { logN: 16, keySecurity: result.keySecurity })
})

test("NIP-49: passwords are NFKC-normalized (the spec's example)", () => {
  // U+212B U+2126 U+1E9B U+0323 becomes U+00C5 U+03A9 U+1E69.
  assert.deepEqual([...normalizePassword("ÅΩẛ̣")], [0xc3, 0x85, 0xce, 0xa9, 0xe1, 0xb9, 0xa9])
  const encrypted = encrypt(key, "ÅΩẛ̣", { logN: 4 })
  assert.equal(bytesToHex(decrypt(encrypted, "ÅΩṩ").secretKey), bytesToHex(key))
  // German umlauts typed composed or decomposed are the same password.
  const umlaut = encrypt(key, "Grüße", { logN: 4 })
  assert.equal(bytesToHex(decrypt(umlaut, "Grüße").secretKey), bytesToHex(key))
})

test("NIP-49: round trip keeps key, log_n and key security byte; output is 91 bytes in bech32", () => {
  for (const keySecurity of [0, 1, 2] as const) {
    const encrypted = encrypt(key, "correct horse", { logN: 5, keySecurity })
    assert.match(encrypted, /^ncryptsec1[02-9ac-hj-np-z]+$/)
    const result = decrypt(encrypted, "correct horse")
    assert.deepEqual([bytesToHex(result.secretKey), result.logN, result.keySecurity], [bytesToHex(key), 5, keySecurity])
  }
  // Reproducible with fixed salt and nonce, random otherwise.
  const fixed = { logN: 4, salt: new Uint8Array(16).fill(1), nonce: new Uint8Array(24).fill(2) }
  assert.equal(encrypt(key, "pw", fixed), encrypt(key, "pw", fixed))
  assert.notEqual(encrypt(key, "pw", { logN: 4 }), encrypt(key, "pw", { logN: 4 }))
})

test("NIP-49: wrong password, damage, foreign strings and absurd log_n fail with a clear code", () => {
  const encrypted = encrypt(key, "right", { logN: 4 })
  const code = (fn: () => unknown) => {
    try {
      fn()
    } catch (error) {
      assert.ok(error instanceof Nip49Error)
      return error.code
    }
    return "no error"
  }
  assert.equal(code(() => decrypt(encrypted, "wrong")), "wrong-password")
  // Flip one character of the ciphertext part (keeps the bech32 checksum broken, so: malformed).
  assert.equal(code(() => decrypt(encrypted.slice(0, 60) + (encrypted[60] === "q" ? "p" : "q") + encrypted.slice(61), "right")), "malformed")
  // A valid ncryptsec whose ciphertext was changed: the authentication tag catches it.
  const bytes = bech32.fromWords(bech32.decode(encrypted as `${string}1${string}`, 200).words)
  bytes[60] ^= 1
  assert.equal(code(() => decrypt(bech32.encode("ncryptsec", bech32.toWords(bytes), 200), "right")), "wrong-password")
  assert.equal(code(() => decrypt("npub1qqqqqq", "right")), "malformed")
  assert.equal(code(() => decrypt("", "right")), "malformed")
  assert.equal(code(() => encrypt(key, "pw", { logN: 21 })), "unsupported")
  assert.equal(code(() => encrypt(new Uint8Array(31), "pw", { logN: 4 })), "invalid-key")
})

test("NIP-49: the async variants give the same results", async () => {
  const encrypted = await encryptAsync(key, "async pw", { logN: 6, keySecurity: 1 })
  assert.equal(bytesToHex(decrypt(encrypted, "async pw").secretKey), bytesToHex(key))
  assert.equal(bytesToHex((await decryptAsync(VECTOR, "nostr")).secretKey), VECTOR_KEY)
  await assert.rejects(decryptAsync(encrypted, "nope"), (error: Nip49Error) => error.code === "wrong-password")
})

test("NIP-49 off the main thread: without Worker (Node) it falls back and still works", async () => {
  const encrypted = await encryptOffThread(key, "fallback", { logN: 5 })
  assert.equal(usesWorker(), false)
  assert.equal(bytesToHex((await decryptOffThread(encrypted, "fallback")).secretKey), bytesToHex(key))
  await assert.rejects(decryptOffThread(encrypted, "nope"), (error: Nip49Error) => error.code === "wrong-password")
})
