// NIP-46 client behaviour that nak's bunker can't show (auth_url, refusals, silence, relay
// switches, spoofed answers), against an in-process remote signer on the fake relay network.
// The real interop runs in tests/relay/nip46.test.ts.
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex } from "@noble/hashes/utils.js"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { createRelayClient, type RelayClient } from "../lib/nostr/client.ts"
import { createClientUri, Nip46RequestError, resume, waitForSigner, type Nip46Session } from "../lib/nostr/ext/nostrconnect.ts"
import { FakeNetwork } from "./support/fake-relay.ts"

let core: Core
const clients: RelayClient[] = []
after(() => clients.forEach((client) => client.close()))
before(async () => {
  core = await loadCore()
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Request = { id: string; method: string; params: string[] }
type Respond = (answer: { result?: string; error?: string }) => void

// A remote signer listening on the given relays; `behave` decides how to answer each request.
function remoteSigner(network: FakeNetwork, relays: string[], behave: (request: Request, respond: Respond, client: string) => void) {
  const key = core.generateSecretKey()
  const pubkey = core.getPublicKey(key)
  const transport = createRelayClient({ websocket: network.WebSocket })
  clients.push(transport)
  const methods: string[] = []
  transport.subscribe([{ kinds: [24133], "#p": [pubkey] }], relays, {
    onevent: (event) => {
      const conversation = core.nip44.getConversationKey(key, event.pubkey)
      const request = JSON.parse(core.nip44.decrypt(event.content, conversation)) as Request
      methods.push(request.method)
      const respond: Respond = (answer) => {
        const content = core.nip44.encrypt(JSON.stringify({ id: request.id, ...answer }), conversation)
        void transport.publish(core.finalizeEvent({ kind: 24133, tags: [["p", event.pubkey]], content, created_at: Math.floor(Date.now() / 1000) }, key), relays)
      }
      behave(request, respond, event.pubkey)
    },
  })
  // Signs with its own key (remote signer key = user key, as in many bunkers).
  const sign = (template: string) => JSON.stringify(core.finalizeEvent(JSON.parse(template), key))
  return { key, pubkey, methods, transport, sign }
}

function setup() {
  const network = new FakeNetwork()
  network.add("wss://r1.example")
  network.add("wss://r2.example")
  const transport = createRelayClient({ websocket: network.WebSocket })
  clients.push(transport)
  return { network, transport }
}

const sessionFor = (remotePubkey: string, relays: string[]): Nip46Session => ({
  clientSecretKey: bytesToHex(core.generateSecretKey()),
  remoteSignerPubkey: remotePubkey,
  userPubkey: remotePubkey,
  relays,
})

test("resume: a stored session signs right away, without a new connect", async () => {
  const { network, transport } = setup()
  const remote = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "sign_event") respond({ result: remote.sign(request.params[0]) })
  })
  await wait(50)
  const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 2000 })
  assert.equal(await signer.getPublicKey(), remote.pubkey)
  const event = await signer.signEvent({ kind: 1180, content: "x", tags: [], created_at: 1_790_000_000 })
  assert.ok(core.verifyEventSignature(event))
  assert.deepEqual(remote.methods, ["sign_event"])
  signer.close()
})

test("auth_url: the request stays pending while the user confirms, then completes", async () => {
  const { network, transport } = setup()
  const remote = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    respond({ result: "auth_url", error: "https://signer.example/confirm/123" })
    setTimeout(() => respond({ result: remote.sign(request.params[0]) }), 1500)
  })
  await wait(50)
  const urls: string[] = []
  const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 800, onAuthUrl: (url) => urls.push(url) })
  // The request timeout would fire before the real answer; the auth_url extends the wait.
  const event = await signer.signEvent({ kind: 1, content: "after confirming", tags: [], created_at: 1_790_000_000 })
  assert.deepEqual(urls, ["https://signer.example/confirm/123"])
  assert.equal(event.content, "after confirming")
  signer.close()
})

test("refusal, silence and no relay are told apart", async () => {
  const { network, transport } = setup()
  const remote = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "sign_event") respond({ error: "user denied" })
    // Everything else: no answer at all.
  })
  network.add("wss://down.example", { mode: "down" })
  await wait(50)
  const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 300 })
  await assert.rejects(signer.signEvent({ kind: 1, content: "", tags: [], created_at: 1 }), (error: Nip46RequestError) => error.code === "rejected")
  await assert.rejects(signer.nip44.encrypt(remote.pubkey, "x"), (error: Nip46RequestError) => error.code === "timeout")
  assert.equal(await signer.ping(300), false)
  const offline = resume(sessionFor(remote.pubkey, ["wss://down.example"]), { transport, timeoutMs: 2000 })
  await assert.rejects(offline.nip44.encrypt(remote.pubkey, "x"), (error: Nip46RequestError) => error.code === "unreachable")
  signer.close()
  offline.close()
  await assert.rejects(signer.request("ping", []), (error: Nip46RequestError) => error.code === "closed")
})

test("a relay that takes the request but never confirms it: the answer may still come, so it ends as unknown", async () => {
  const network = new FakeNetwork()
  network.add("wss://silent.example", { mode: "silent" })
  const transport = createRelayClient({ websocket: network.WebSocket, publishTimeoutMs: 200 })
  clients.push(transport)
  const signer = resume(sessionFor(core.getPublicKey(core.generateSecretKey()), ["wss://silent.example"]), { transport, timeoutMs: 800 })
  await assert.rejects(signer.nip44.encrypt(signer.session.userPubkey, "x"), (error: Nip46RequestError) => error.code === "timeout")
  signer.close()
})

test("ping, switch_relays and logout", async () => {
  const { network, transport } = setup()
  const remote = remoteSigner(network, ["wss://r1.example", "wss://r2.example"], (request, respond) => {
    if (request.method === "ping") respond({ result: "pong" })
    if (request.method === "switch_relays") respond({ result: JSON.stringify(["wss://r2.example"]) })
    if (request.method === "logout") respond({ result: "ack" })
  })
  await wait(50)
  const changes: Nip46Session[] = []
  const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 1000, onSessionChange: (session) => changes.push(session) })
  assert.equal(await signer.ping(), true)
  assert.deepEqual(await signer.switchRelays(), ["wss://r2.example"])
  assert.deepEqual(changes.map((session) => session.relays), [["wss://r2.example"]])
  // Same list again: nothing changes.
  assert.equal(await signer.switchRelays(), null)
  network.relayFor("wss://r1.example")!.options.mode = "down"
  network.relayFor("wss://r1.example")!.dropAll()
  assert.equal(await signer.ping(), true, "requests now travel over the new relay")
  await signer.logout()
  assert.deepEqual(remote.methods, ["ping", "switch_relays", "switch_relays", "ping", "logout"])
})

test("switch_relays while a request is open: its answer on the old relay still arrives", async () => {
  const { network, transport } = setup()
  let answerLater: Respond | null = null
  let signTemplate = ""
  const remote = remoteSigner(network, ["wss://r1.example", "wss://r2.example"], (request, respond) => {
    if (request.method === "switch_relays") respond({ result: JSON.stringify(["wss://r2.example"]) })
    if (request.method === "sign_event") {
      answerLater = respond
      signTemplate = request.params[0]
    }
  })
  await wait(50)
  const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 2000 })
  const signing = signer.signEvent({ kind: 1180, content: "slow approval", tags: [], created_at: 1_790_000_000 })
  await wait(100)
  assert.deepEqual(await signer.switchRelays(), ["wss://r2.example"])
  // The signer answers the old request where it was asked (r1), after the switch.
  answerLater!({ result: remote.sign(signTemplate) })
  assert.equal((await signing).content, "slow approval")
  signer.close()
})

test("nostrconnect://: the link carries client key, relays, secret, perms and name", async () => {
  const link = await createClientUri({ relays: ["wss://r1.example", "wss://r2.example"], perms: ["sign_event:1180", "nip44_encrypt"], name: "BlueLine Darts", url: "https://blueline21.netlify.app" })
  const url = new URL(link.uri.replace("nostrconnect://", "https://"))
  assert.equal(url.hostname, link.clientPubkey)
  assert.equal(core.getPublicKey(link.clientSecretKey), link.clientPubkey)
  assert.deepEqual(url.searchParams.getAll("relay"), ["wss://r1.example", "wss://r2.example"])
  assert.equal(url.searchParams.get("secret"), link.secret)
  assert.match(link.secret, /^[0-9a-f]{16}$/)
  assert.equal(url.searchParams.get("perms"), "sign_event:1180,nip44_encrypt")
  assert.equal(url.searchParams.get("name"), "BlueLine Darts")
  await assert.rejects(createClientUri({ relays: [] }), (error: Nip46RequestError) => error.code === "invalid")
})

test("nostrconnect://: an answer with the wrong secret is ignored; the right one connects", async () => {
  const { network, transport } = setup()
  const link = await createClientUri({ relays: ["wss://r1.example"] })
  const remote = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "get_public_key") respond({ result: remote.pubkey })
  })
  // An impostor answers first with a guessed secret.
  const impostor = core.generateSecretKey()
  const answer = (key: Uint8Array, secret: string) => {
    const content = core.nip44.encrypt(JSON.stringify({ id: "x", result: secret }), core.nip44.getConversationKey(key, link.clientPubkey))
    return core.finalizeEvent({ kind: 24133, tags: [["p", link.clientPubkey]], content, created_at: Math.floor(Date.now() / 1000) }, key)
  }
  const waiting = waitForSigner(link, { transport, timeoutMs: 2000, waitMs: 3000 })
  await wait(100)
  await remote.transport.publish(answer(impostor, "deadbeefdeadbeef"), ["wss://r1.example"])
  await remote.transport.publish(answer(remote.key, link.secret), ["wss://r1.example"])
  const { session, signer } = await waiting
  assert.equal(session.remoteSignerPubkey, remote.pubkey)
  assert.equal(session.userPubkey, remote.pubkey)
  assert.equal(session.clientSecretKey, bytesToHex(link.clientSecretKey))
  signer.close()
})

test("nostrconnect://: waiting can be cancelled or time out", async () => {
  const { transport } = setup()
  const link = await createClientUri({ relays: ["wss://r1.example"] })
  const controller = new AbortController()
  const cancelled = waitForSigner(link, { transport, signal: controller.signal })
  controller.abort()
  await assert.rejects(cancelled, (error: Nip46RequestError) => error.code === "closed")
  await assert.rejects(waitForSigner(link, { transport, waitMs: 200 }), (error: Nip46RequestError) => error.code === "timeout")
})
