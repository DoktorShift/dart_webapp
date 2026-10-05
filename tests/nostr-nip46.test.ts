// NIP-46 client behaviour that nak's bunker can't show (auth_url, refusals, silence, relay
// switches, spoofed and competing answers), against in-process remote signers on the fake relay
// network.
// The real interop runs in tests/relay/nip46.test.ts.
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex } from "@noble/hashes/utils.js"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { createRelayClient, type RelayClient } from "../lib/nostr/client.ts"
import { createClientUri, Nip46RequestError, resume, waitForSigner, type Nip46Account, type Nip46Session } from "../lib/nostr/ext/nostrconnect.ts"
import { connectBunker, SignerError } from "../lib/nostr/signers.ts"
import { FakeNetwork } from "./support/fake-relay.ts"

let core: Core
const clients: RelayClient[] = []
after(() => clients.forEach((client) => client.close()))
before(async () => {
  core = await loadCore()
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Request = { id: string; method: string; params: string[]; client?: string }
type Respond = (answer: { result?: string; error?: string }) => void

// A remote signer listening on the given relays; `behave` decides how to answer each request.
function remoteSigner(network: FakeNetwork, relays: string[], behave: (request: Request, respond: Respond, client: string) => void) {
  const key = core.generateSecretKey()
  const pubkey = core.getPublicKey(key)
  const transport = createRelayClient({ websocket: network.WebSocket })
  clients.push(transport)
  const methods: string[] = []
  const requests: Request[] = []
  transport.subscribe([{ kinds: [24133], "#p": [pubkey] }], relays, {
    onevent: (event) => {
      const conversation = core.nip44.getConversationKey(key, event.pubkey)
      const request = JSON.parse(core.nip44.decrypt(event.content, conversation)) as Request
      methods.push(request.method)
      requests.push({ ...request, client: event.pubkey })
      const respond: Respond = (answer) => {
        const content = core.nip44.encrypt(JSON.stringify({ id: request.id, ...answer }), conversation)
        void transport.publish(core.finalizeEvent({ kind: 24133, tags: [["p", event.pubkey]], content, created_at: Math.floor(Date.now() / 1000) }, key), relays)
      }
      behave(request, respond, event.pubkey)
    },
  })
  // Signs with its own key (remote signer key = user key, as in many bunkers).
  const sign = (template: string) => JSON.stringify(core.finalizeEvent(JSON.parse(template), key))
  // Answers the nostrconnect:// link like a signer app that scanned it.
  const answerLink = (link: { clientPubkey: string; secret: string }) => {
    const content = core.nip44.encrypt(JSON.stringify({ id: randomHex(), result: link.secret }), core.nip44.getConversationKey(key, link.clientPubkey))
    return transport.publish(core.finalizeEvent({ kind: 24133, tags: [["p", link.clientPubkey]], content, created_at: Math.floor(Date.now() / 1000) }, key), relays)
  }
  return { key, pubkey, methods, requests, transport, sign, answerLink }
}

const randomHex = () => bytesToHex(core.generateSecretKey()).slice(0, 16)

// A working signer app with its own account on wss://r1.example.
function honestSigner(network: FakeNetwork) {
  const party = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "get_public_key") respond({ result: party.pubkey })
    if (request.method === "sign_event") respond({ result: party.sign(request.params[0]) })
    if (request.method === "nip44_encrypt") respond({ result: core.nip44.encrypt(request.params[1], core.nip44.getConversationKey(party.key, request.params[0])) })
  })
  return party
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
    setTimeout(() => respond({ result: remote.sign(request.params[0]) }), 3000)
  })
  await wait(50)
  const urls: string[] = []
  const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 2000, onAuthUrl: (url) => urls.push(url) })
  // The request timeout would fire before the real answer; the auth_url extends the wait.
  const event = await signer.signEvent({ kind: 1, content: "after confirming", tags: [], created_at: 1_790_000_000 })
  assert.deepEqual(urls, ["https://signer.example/confirm/123"])
  assert.equal(event.content, "after confirming")
  signer.close()
})

test("auth_url: only a web page is passed on; javascript:, data: and the like fail the request", async () => {
  for (const page of ["javascript:alert(document.cookie)", "data:text/html,<script>1</script>", "http://signer.example/confirm", "not a url"]) {
    const { network, transport } = setup()
    const remote = remoteSigner(network, ["wss://r1.example"], (_request, respond) => respond({ result: "auth_url", error: page }))
    await wait(50)
    const urls: string[] = []
    const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 2000, onAuthUrl: (url) => urls.push(url) })
    await assert.rejects(signer.signEvent({ kind: 1, content: "", tags: [], created_at: 1 }), (error: Nip46RequestError) => error.code === "invalid", page)
    assert.deepEqual(urls, [])
    signer.close()
  }
})

test("refusal, silence and no relay are told apart", async () => {
  const { network, transport } = setup()
  const remote = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "sign_event") respond({ error: "user denied" })
    // Everything else: no answer at all.
  })
  network.add("wss://down.example", { mode: "down" })
  await wait(50)
  // The refusal gets time to arrive on a busy machine; the silent requests wait only briefly.
  const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 2000 })
  await assert.rejects(signer.signEvent({ kind: 1, content: "", tags: [], created_at: 1 }), (error: Nip46RequestError) => error.code === "rejected")
  await assert.rejects(signer.request("nip44_encrypt", [remote.pubkey, "x"], 300), (error: Nip46RequestError) => error.code === "timeout")
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

test("switch_relays: relays this client can't use are left out; with none left, the session stays", async () => {
  const { network, transport } = setup()
  let answer = JSON.stringify(["ws://relay.example", "https://r2.example", 42])
  const remote = remoteSigner(network, ["wss://r1.example", "wss://r2.example"], (request, respond) => {
    if (request.method === "switch_relays") respond({ result: answer })
  })
  await wait(50)
  const changes: Nip46Session[] = []
  const signer = resume(sessionFor(remote.pubkey, ["wss://r1.example"]), { transport, timeoutMs: 1000, onSessionChange: (session) => changes.push(session) })
  assert.equal(await signer.switchRelays(), null)
  assert.deepEqual(signer.session.relays, ["wss://r1.example"])
  assert.equal(changes.length, 0)
  answer = JSON.stringify(["ws://relay.example", "wss://R2.example/"])
  assert.deepEqual(await signer.switchRelays(), ["wss://r2.example"])
  assert.deepEqual(changes.map((session) => session.relays), [["wss://r2.example"]])
  signer.close()
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
  // The key proof (kind 22242) is asked for too, so signers that honour perms don't prompt for it.
  assert.equal(url.searchParams.get("perms"), "sign_event:1180,nip44_encrypt,sign_event:22242")
  assert.equal(url.searchParams.get("name"), "BlueLine Darts")
  await assert.rejects(createClientUri({ relays: [] }), (error: Nip46RequestError) => error.code === "invalid")
})

test("nostrconnect://: an answer with the wrong secret is ignored; the right one connects", async () => {
  const { network, transport } = setup()
  const link = await createClientUri({ relays: ["wss://r1.example"] })
  const remote = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "get_public_key") respond({ result: remote.pubkey })
    if (request.method === "sign_event") respond({ result: remote.sign(request.params[0]) })
  })
  // An impostor answers first with a guessed secret.
  const impostor = core.generateSecretKey()
  const answer = (key: Uint8Array, secret: string) => {
    const content = core.nip44.encrypt(JSON.stringify({ id: "x", result: secret }), core.nip44.getConversationKey(key, link.clientPubkey))
    return core.finalizeEvent({ kind: 24133, tags: [["p", link.clientPubkey]], content, created_at: Math.floor(Date.now() / 1000) }, key)
  }
  // No second signer answers within graceMs, so the one that proved its key connects.
  const waiting = waitForSigner(link, { transport, timeoutMs: 2000, waitMs: 5000, graceMs: 200 })
  await wait(100)
  await remote.transport.publish(answer(impostor, "deadbeefdeadbeef"), ["wss://r1.example"])
  await remote.transport.publish(answer(remote.key, link.secret), ["wss://r1.example"])
  const { session, signer } = await waiting
  assert.equal(session.remoteSignerPubkey, remote.pubkey)
  assert.equal(session.userPubkey, remote.pubkey)
  assert.equal(session.clientSecretKey, bytesToHex(link.clientSecretKey))
  // The signer proved the key with a fresh challenge (kind 22242).
  const proof = JSON.parse(remote.requests.find((request) => request.method === "sign_event")!.params[0])
  assert.equal(proof.kind, 22242)
  assert.ok(proof.tags.some((tag: string[]) => tag[0] === "challenge" && /^[0-9a-f]{32}$/.test(tag[1])))
  signer.close()
})

test("nostrconnect://: someone who saw the QR code and claims the victim's key never connects; the victim's answer meanwhile ends the wait as mismatch", async () => {
  const { network, transport } = setup()
  const link = await createClientUri({ relays: ["wss://r1.example"] })
  const victim = honestSigner(network)
  // The attacker read the secret off the screen, answers first and names the victim's key. It
  // can only sign with its own key, and it takes its time.
  const attacker = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "get_public_key") setTimeout(() => respond({ result: victim.pubkey }), 1500)
    if (request.method === "sign_event") respond({ result: attacker.sign(request.params[0]) })
    if (request.method === "nip44_encrypt") respond({ result: "stolen" })
  })
  const changes: Nip46Session[] = []
  const waiting = waitForSigner(link, { transport, timeoutMs: 3000, waitMs: 5000, onSessionChange: (session) => changes.push(session) })
  // It may end while the victim's answer is still being published.
  waiting.catch(() => {})
  await wait(100)
  await attacker.answerLink(link)
  await wait(150)
  await victim.answerLink(link)
  await assert.rejects(waiting, (error: Nip46RequestError) => error.code === "mismatch")
  // Nothing private went anywhere, the victim's signer got no request, nothing reached storage.
  assert.deepEqual(attacker.methods, ["get_public_key"])
  assert.deepEqual(victim.methods, [])
  assert.deepEqual(changes, [])
})

test("nostrconnect://: an onlooker who answers first with its own account and a valid proof is caught when the real signer answers in the grace window", async () => {
  const { network, transport } = setup()
  const link = await createClientUri({ relays: ["wss://r1.example"] })
  // Both are working signers; the onlooker's proof passes because it names its own key.
  const onlooker = honestSigner(network)
  const user = honestSigner(network)
  const changes: Nip46Session[] = []
  const waiting = waitForSigner(link, { transport, timeoutMs: 2000, waitMs: 5000, graceMs: 2000, onSessionChange: (session) => changes.push(session) })
  waiting.catch(() => {})
  await wait(100)
  await onlooker.answerLink(link)
  await wait(150)
  await user.answerLink(link)
  await assert.rejects(waiting, (error: Nip46RequestError) => error.code === "mismatch")
  // No data key request reached the onlooker, the user's signer got none, nothing was stored.
  assert.ok(onlooker.methods.every((method) => method === "get_public_key" || method === "sign_event"), onlooker.methods.join())
  assert.deepEqual(user.methods, [])
  assert.deepEqual(changes, [])
})

test("nostrconnect://: confirm sees the proven account before anything is handed out or stored", async () => {
  const { network, transport } = setup()

  // The user sees an account that isn't theirs and says no.
  const strangerLink = await createClientUri({ relays: ["wss://r1.example"] })
  const stranger = honestSigner(network)
  const shown: Nip46Account[] = []
  const stored: Nip46Session[] = []
  const declined = waitForSigner(strangerLink, {
    transport,
    timeoutMs: 2000,
    waitMs: 5000,
    graceMs: 0,
    onSessionChange: (session) => stored.push(session),
    confirm: async (account) => {
      shown.push(account)
      return false
    },
  })
  declined.catch(() => {})
  await wait(100)
  await stranger.answerLink(strangerLink)
  await assert.rejects(declined, (error: Nip46RequestError) => error.code === "rejected")
  assert.deepEqual(shown, [{ userPubkey: stranger.pubkey, remoteSignerPubkey: stranger.pubkey }])
  assert.deepEqual(stored, [])

  // While the question about the onlooker's account is open (long after graceMs), the user's own
  // signer answers: mismatch, and the question is closed.
  const link = await createClientUri({ relays: ["wss://r1.example"] })
  const onlooker = honestSigner(network)
  const user = honestSigner(network)
  let question: AbortSignal | null = null
  let asked = () => {}
  const askedNow = new Promise<void>((resolve) => (asked = resolve))
  const contested = waitForSigner(link, {
    transport,
    timeoutMs: 2000,
    waitMs: 5000,
    graceMs: 0,
    confirm: (_account, signal) => {
      question = signal
      asked()
      return new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false)))
    },
  })
  contested.catch(() => {})
  await wait(100)
  await onlooker.answerLink(link)
  await askedNow
  await wait(300)
  await user.answerLink(link)
  await assert.rejects(contested, (error: Nip46RequestError) => error.code === "mismatch")
  assert.equal(question!.aborted, true)
  assert.deepEqual(user.methods, [])

  // The user confirms their own account: only then is the session handed out and stored.
  const ownLink = await createClientUri({ relays: ["wss://r1.example"] })
  const own = honestSigner(network)
  const order: string[] = []
  const confirmed = waitForSigner(ownLink, {
    transport,
    timeoutMs: 2000,
    waitMs: 5000,
    graceMs: 0,
    onSessionChange: () => order.push("stored"),
    confirm: async (account) => {
      order.push(account.userPubkey === own.pubkey ? "shown" : "wrong account")
      await wait(200)
      order.push("confirmed")
      return true
    },
  })
  await wait(100)
  await own.answerLink(ownLink)
  const { session, signer } = await confirmed
  assert.equal(session.userPubkey, own.pubkey)
  assert.deepEqual(order, ["shown", "confirmed", "stored"])
  signer.close()
})

test("nostrconnect://: a spoofer alone never connects; a declined key proof ends the wait as refused", async () => {
  const { network, transport } = setup()
  const victimKey = core.getPublicKey(core.generateSecretKey())
  const link = await createClientUri({ relays: ["wss://r1.example"] })
  const spoofer = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "get_public_key") respond({ result: victimKey })
    // A signature by the spoofer's own key, or anything else, fails the proof.
    if (request.method === "sign_event") respond({ result: spoofer.sign(request.params[0]) })
  })
  const started = Date.now()
  const waiting = waitForSigner(link, { transport, timeoutMs: 2000, waitMs: 10_000 })
  await wait(100)
  await spoofer.answerLink(link)
  // At once, not after waitMs.
  await assert.rejects(waiting, (error: Nip46RequestError) => error.code === "invalid")
  assert.ok(Date.now() - started < 5000)

  const second = await createClientUri({ relays: ["wss://r1.example"] })
  const declining = remoteSigner(network, ["wss://r1.example"], (request, respond) => {
    if (request.method === "get_public_key") respond({ result: declining.pubkey })
    if (request.method === "sign_event") respond({ error: "user declined" })
  })
  const refused = waitForSigner(second, { transport, timeoutMs: 2000, waitMs: 5000 })
  await wait(100)
  await declining.answerLink(second)
  await assert.rejects(refused, (error: Nip46RequestError) => error.code === "rejected")
})

test("bunker://: connect with today's parameters on every relay, pending through auth_url, then a session on the same client key", async () => {
  const { network, transport } = setup()
  network.add("wss://down.example", { mode: "down" })
  const confirmed = new Set<string>()
  const remote = remoteSigner(network, ["wss://r2.example"], (request, respond, client) => {
    if (request.method === "connect") {
      if (request.params[1] !== "abc123") return respond({ error: "invalid secret" })
      // A new client must confirm on the signer's page first; the answer follows on the same id,
      // later than timeoutMs below, so only the auth_url can have kept the request open.
      respond({ result: "auth_url", error: "https://signer.example/confirm?c=1" })
      setTimeout(() => {
        confirmed.add(client)
        respond({ result: "ack" })
      }, 2000)
    }
    if (request.method === "get_public_key") respond({ result: remote.pubkey })
    if (request.method === "sign_event" && confirmed.has(client)) respond({ result: remote.sign(request.params[0]) })
  })
  await wait(50)
  const urls: string[] = []
  const uri = `bunker://${remote.pubkey}?relay=${encodeURIComponent("wss://down.example")}&relay=${encodeURIComponent("wss://r2.example")}&secret=abc123`
  const connection = await connectBunker(uri, { transport, timeoutMs: 1500, perms: ["sign_event:1180", "nip44_encrypt"], onAuthUrl: (url) => urls.push(url) })
  assert.deepEqual(urls, ["https://signer.example/confirm?c=1"])
  assert.equal(connection.pubkey, remote.pubkey)
  const connect = remote.requests.filter((request) => request.method === "connect")
  assert.equal(connect.length, 1)
  assert.deepEqual(connect[0].params, [remote.pubkey, "abc123", "sign_event:1180,nip44_encrypt"])
  // The session keeps the client key the signer just approved.
  assert.equal(core.getPublicKey(Buffer.from(connection.session.clientSecretKey, "hex")), connect[0].client)
  assert.deepEqual(connection.session.relays, ["wss://down.example", "wss://r2.example"])
  const event = await connection.signer.signEvent({ kind: 1180, content: "nach Bestätigung", tags: [], created_at: 1_790_000_000 })
  assert.equal(event.pubkey, remote.pubkey)
  connection.remote.close()

  const used = `bunker://${remote.pubkey}?relay=${encodeURIComponent("wss://r2.example")}&secret=wrong`
  await assert.rejects(connectBunker(used, { transport, timeoutMs: 1000 }), (error: SignerError) => error.code === "rejected")
  await assert.rejects(connectBunker(`bunker://${remote.pubkey}?relay=${encodeURIComponent("ws://public.example")}`, { transport }), (error: SignerError) => error.code === "invalid")
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
