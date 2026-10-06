import { before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { androidSigner, completeAnswer, preparePublicKeyRequest } from "../lib/profile/android-signer.ts"
import { dbKeys } from "../lib/storage/db.ts"

// The Android signer path (NIP-55 from a web page): every request is stored before the page is
// left, its answer comes back as /#signer-return… and is matched to it, once. A signature asked
// for in one page reaches it through the database, wherever the answer arrived.

let core: Core
let secret: Uint8Array
let pubkey: string
const opened: string[] = []

before(async () => {
  core = await loadCore()
  secret = core.generateSecretKey()
  pubkey = core.getPublicKey(secret)
  Object.assign(globalThis.window, { location: { origin: "https://blueline.example", assign: (url: string) => opened.push(url) } })
})
beforeEach(async () => {
  await resetStorage()
  opened.length = 0
})

// The request id and callback the signer app would read from the link.
function request(url: string) {
  const callback = decodeURIComponent(/callbackUrl=([^&]+)/.exec(url)![1])
  const id = /id=([0-9a-f]{32})&result=$/.exec(callback)![1]
  return { id, callback }
}

// What the app sees after the signer app opened the callback with its result appended.
const answer = (id: string, result: string) => `&id=${id}&result=${result}`

test("sign-in: the key comes back once, and only to the request that asked for it", async () => {
  const url = await preparePublicKeyRequest()
  assert.match(url, /^nostrsigner:\?type=get_public_key/)
  const { id, callback } = request(url)
  assert.ok(callback.startsWith("https://blueline.example/#signer-return&id="), "the answer stays in the fragment")
  assert.deepEqual(await dbKeys("pending"), [`signer:${id}`])
  assert.deepEqual(await completeAnswer(answer(id, core.nip19.npubEncode(pubkey))), { type: "pubkey", pubkey })
  assert.deepEqual(await dbKeys("pending"), [])
  // The same link again (browser history) and an unknown request change nothing.
  assert.equal(await completeAnswer(answer(id, pubkey)), null)
  assert.equal(await completeAnswer(answer("0".repeat(32), pubkey)), null)
  assert.equal(await completeAnswer("&garbage"), null)
})

test("signing: the page that asked gets the checked event from the answer", async () => {
  const signer = await androidSigner(pubkey)
  assert.equal(signer.nip44, undefined, "never decryption through the page address")
  const template = { kind: 0, tags: [], content: '{"name":"Lena"}', created_at: 1_790_000_000 }
  const signing = signer.signEvent(template)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(opened.length, 1)
  assert.match(opened[0], /^nostrsigner:/)
  const { id } = request(opened[0])
  const signed = core.finalizeEvent({ ...template }, secret)
  const result = await completeAnswer(answer(id, signed.sig))
  assert.equal(result?.type, "signed")
  assert.equal(result?.type === "signed" && result.awaited, true)
  const event = await signing
  assert.equal(event.id, signed.id)
  assert.equal(event.pubkey, pubkey)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(await dbKeys("pending"), [], "the request is gone once taken")
})

test("a refusal or a signature for something else never counts as signed", async () => {
  const signer = await androidSigner(pubkey)
  const template = { kind: 0, tags: [], content: "{}", created_at: 1_790_000_000 }
  const refused = signer.signEvent(template)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(await completeAnswer(answer(request(opened[0]).id, "")), { type: "refused" })
  await assert.rejects(refused, { name: "SignerError", code: "rejected" })

  const changed = signer.signEvent(template)
  await new Promise((resolve) => setTimeout(resolve, 20))
  const other = core.finalizeEvent({ ...template, content: '{"name":"Mallory"}' }, secret)
  assert.equal(await completeAnswer(answer(request(opened[1]).id, other.sig)), null)
  await assert.rejects(changed, { name: "SignerError", code: "mismatch" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(await dbKeys("pending"), [], "a wrong answer ends the request")
})
