import { before, test } from "node:test"
import assert from "node:assert/strict"
import { gzipSync } from "node:zlib"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import {
  buildSignerUrl,
  completeGetPublicKey,
  completeSignEvent,
  createGetPublicKeyRequest,
  createSignEventRequest,
  decodeResult,
  matchPending,
  Nip55Error,
  parseCallback,
} from "../lib/nostr/ext/nip55.ts"
import type { EventTemplate } from "../lib/nostr/types.ts"

let core: Core
let user: Uint8Array
let userPub: string

before(async () => {
  core = await loadCore()
  user = core.generateSecretKey()
  userPub = core.getPublicKey(user)
})

const CALLBACK = "https://blueline21.netlify.app/#signer-return"
const template = (): EventTemplate => ({ kind: 1180, content: "Ergebnis 3:1", tags: [["L", "blueline"]], created_at: 1_790_000_000 })

async function codeOf(action: () => unknown): Promise<string> {
  try {
    await action()
    return "no error"
  } catch (error) {
    assert.ok(error instanceof Nip55Error)
    return error.code
  }
}

test("NIP-55 links: get_public_key carries permissions; the callback keeps its fragment", () => {
  const request = createGetPublicKeyRequest()
  const url = buildSignerUrl(request, { callbackUrl: CALLBACK, permissions: [{ type: "sign_event", kind: 1180 }, { type: "nip44_decrypt" }] })
  assert.ok(url.startsWith("nostrsigner:?"))
  const params = new URLSearchParams(url.slice("nostrsigner:?".length))
  assert.equal(params.get("type"), "get_public_key")
  assert.equal(params.get("callbackUrl"), `${CALLBACK}&id=${request.id}&result=`)
  assert.deepEqual(JSON.parse(params.get("permissions")!), [{ type: "sign_event", kind: 1180 }, { type: "nip44_decrypt" }])
  // The raw link has no second "#": the callback's fragment is encoded inside the parameter.
  assert.equal(url.split("#").length, 1)
})

test("NIP-55 links: sign_event carries the event as payload and the current user", () => {
  const request = createSignEventRequest(template(), userPub)
  const url = buildSignerUrl(request, { callbackUrl: CALLBACK, returnType: "event", compressionType: "gzip" })
  const [payload, query] = url.slice("nostrsigner:".length).split("?")
  assert.deepEqual(JSON.parse(decodeURIComponent(payload)), { ...template(), pubkey: userPub })
  const params = new URLSearchParams(query)
  assert.deepEqual([params.get("type"), params.get("current_user"), params.get("returnType"), params.get("compressionType")], ["sign_event", userPub, "event", "gzip"])
})

test("NIP-55 links: a callback without fragment is refused (results must never reach a server)", async () => {
  assert.equal(await codeOf(() => buildSignerUrl(createGetPublicKeyRequest(), { callbackUrl: "https://blueline21.netlify.app/?result=" })), "malformed")
  assert.equal(await codeOf(() => createSignEventRequest(template(), "npub-not-hex")), "malformed")
})

test("NIP-55 answers: parsed whether the signer appended raw or URL-encoded; other URLs are not answers", () => {
  const id = "0123456789abcdef0123456789abcdef"
  assert.deepEqual(parseCallback(`${CALLBACK}&id=${id}&result=${userPub}`), { id, result: userPub })
  assert.deepEqual(parseCallback(`${CALLBACK}&id=${id}&result=Signer1H4sI+ab/cd==`), { id, result: "Signer1H4sI+ab/cd==" })
  assert.deepEqual(parseCallback(`${CALLBACK}&id=${id}&result=Signer1H4sI%2Bab%2Fcd%3D%3D`), { id, result: "Signer1H4sI+ab/cd==" })
  assert.deepEqual(parseCallback(`${CALLBACK}&id=${id}&result=`), { id, result: "" })
  assert.equal(parseCallback("https://blueline21.netlify.app/#watch=abc"), null)
  assert.equal(parseCallback("https://blueline21.netlify.app/"), null)
  assert.equal(parseCallback(`${CALLBACK}&id=short&result=x`), null)
})

test("NIP-55 answers: matched to the stored request; unknown and stale answers are refused", async () => {
  const request = createGetPublicKeyRequest(1000)
  const callback = { id: request.id, result: userPub }
  assert.equal(matchPending([request], callback, { now: 2000 }), request)
  assert.equal(await codeOf(() => matchPending([], callback, { now: 2000 })), "unknown-request")
  assert.equal(await codeOf(() => matchPending([request], callback, { now: 1000 + 16 * 60 * 1000 })), "expired")
})

test("NIP-55 get_public_key: hex or npub; empty means refused", async () => {
  const request = createGetPublicKeyRequest()
  assert.equal(await completeGetPublicKey(request, { id: request.id, result: userPub }), userPub)
  assert.equal(await completeGetPublicKey(request, { id: request.id, result: core.nip19.npubEncode(userPub) }), userPub)
  assert.equal(await codeOf(() => completeGetPublicKey(request, { id: request.id, result: "" })), "rejected")
  assert.equal(await codeOf(() => completeGetPublicKey(request, { id: request.id, result: "nonsense" })), "malformed")
})

test("NIP-55 sign_event: a bare signature or the signed event (also gzipped) gives a verified event", async () => {
  const request = createSignEventRequest(template(), userPub)
  const signed = core.finalizeEvent({ ...template() }, user)
  const fromSignature = await completeSignEvent(request, { id: request.id, result: signed.sig })
  assert.equal(fromSignature.id, signed.id)
  assert.ok(core.verifyEventSignature(fromSignature))
  const fromEvent = await completeSignEvent(request, { id: request.id, result: JSON.stringify(signed) })
  assert.equal(fromEvent.id, signed.id)
  const gz = `Signer1${gzipSync(Buffer.from(JSON.stringify(signed))).toString("base64")}`
  assert.equal(await decodeResult(gz), JSON.stringify(signed))
  assert.equal((await completeSignEvent(request, { id: request.id, result: gz })).id, signed.id)
})

test("NIP-55 sign_event: another key, another event, a bad signature or nothing are refused", async () => {
  const request = createSignEventRequest(template(), userPub)
  const other = core.generateSecretKey()
  const byOther = core.finalizeEvent({ ...template() }, other)
  const changed = core.finalizeEvent({ ...template(), content: "Ergebnis 0:3" }, user)
  assert.equal(await codeOf(() => completeSignEvent(request, { id: request.id, result: JSON.stringify(byOther) })), "mismatch")
  assert.equal(await codeOf(() => completeSignEvent(request, { id: request.id, result: byOther.sig })), "mismatch")
  assert.equal(await codeOf(() => completeSignEvent(request, { id: request.id, result: JSON.stringify(changed) })), "mismatch")
  assert.equal(await codeOf(() => completeSignEvent(request, { id: request.id, result: "" })), "rejected")
  assert.equal(await codeOf(() => completeSignEvent(request, { id: request.id, result: "Signer1!!!" })), "malformed")
  assert.equal(await codeOf(() => completeSignEvent(request, { id: "f".repeat(32), result: byOther.sig })), "unknown-request")
})
