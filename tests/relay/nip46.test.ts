// Remote signing against nak's NIP-46 bunker on a local relay. Run: npm run test:relay
// - bunker:// (signer-initiated): connect with today's parameters on the resumable signer, a
//   reload resumes without a new connect.
// - nostrconnect:// (client-initiated): the app's link handed to "nak bunker connect"; the
//   bunker proves the user key by signing the challenge, and the app confirms the account.
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { loadCore, type Core } from "../../lib/nostr/core.ts"
import { createRelayClient, type RelayClient } from "../../lib/nostr/client.ts"
import { resume } from "../../lib/nostr/ext/nostrconnect.ts"
import { connectBunker, probeNip44, resumeNip46, SignerError, startNostrConnect } from "../../lib/nostr/signers.ts"
import { startBunker, startRelay, type NakBunker, type NakRelay } from "../support/nak.ts"

let core: Core
let relay: NakRelay
let bunker: NakBunker
const clients: RelayClient[] = []
const transport = () => {
  const client = createRelayClient({ connectTimeoutMs: 3000, publishTimeoutMs: 5000 })
  clients.push(client)
  return client
}
const now = () => Math.floor(Date.now() / 1000)

before(async () => {
  core = await loadCore()
  relay = await startRelay()
  bunker = await startBunker(relay.url)
})

after(async () => {
  for (const client of clients) client.close()
  await bunker?.stop()
  await relay?.stop()
})

test("bunker://: connect, sign (verified), encrypt; a reload resumes without a second connect", async () => {
  const connection = await connectBunker(bunker.uri, { transport: transport(), timeoutMs: 10_000, perms: ["sign_event:1180", "nip44_encrypt", "nip44_decrypt"] })
  assert.equal(connection.pubkey, bunker.pubkey)
  // connect went out as NIP-46 names it today: signer key, secret, permissions.
  assert.match(bunker.output(), new RegExp(`"method": "connect",\\s*"params": \\[\\s*"${bunker.pubkey}",\\s*"[^"]+",\\s*"sign_event:1180,nip44_encrypt,nip44_decrypt"`))
  assert.equal(connection.session.remoteSignerPubkey, bunker.pubkey)
  const event = await connection.signer.signEvent({ kind: 1180, content: "Ergebnis 3:1", tags: [["L", "blueline"]], created_at: now() })
  assert.equal(event.pubkey, bunker.pubkey)
  assert.ok(core.verifyEventSignature(event))
  assert.equal(await probeNip44(connection.signer, connection.pubkey), true)
  connection.remote.close()

  // After a reload: only the stored session, a fresh relay client, no connect.
  const connectsBefore = (bunker.output().match(/"method": "connect"/g) ?? []).length
  const resumed = resumeNip46(JSON.parse(JSON.stringify(connection.session)), { transport: transport(), timeoutMs: 10_000 })
  const again = await resumed.signer.signEvent({ kind: 1180, content: "nach dem Neuladen", tags: [], created_at: now() })
  assert.ok(core.verifyEventSignature(again))
  assert.equal(await resumed.remote.ping(5000), true)
  assert.equal((bunker.output().match(/"method": "connect"/g) ?? []).length, connectsBefore)
  resumed.remote.close()
})

test("bunker://: the link's secret is single-use, which is why sessions resume instead of reconnecting", async () => {
  // The first test already used bunker.uri's secret.
  await assert.rejects(connectBunker(bunker.uri, { transport: transport(), timeoutMs: 10_000 }), (error: SignerError) => error.code === "rejected")
})

test("nostrconnect://: the app's link, scanned by the bunker, gives a working session", async () => {
  const shown: string[] = []
  const start = await startNostrConnect({
    relays: [relay.url],
    perms: ["sign_event:1180", "nip44_encrypt", "nip44_decrypt"],
    name: "BlueLine Darts",
    transport: transport(),
    timeoutMs: 10_000,
    waitMs: 20_000,
    graceMs: 500,
    // The sign-in screen would show this account and wait for the user's yes.
    confirm: async (account) => {
      shown.push(account.userPubkey)
      return true
    },
  })
  assert.match(start.uri, /^nostrconnect:\/\/[0-9a-f]{64}\?/)
  await bunker.connect(start.uri)
  const connection = await start.connection
  assert.deepEqual(shown, [bunker.pubkey])
  assert.equal(connection.pubkey, bunker.pubkey)
  const event = await connection.signer.signEvent({ kind: 1180, content: "per QR verbunden", tags: [], created_at: now() })
  assert.ok(core.verifyEventSignature(event))
  const ciphertext = await connection.signer.nip44!.encrypt(connection.pubkey, "geheim")
  assert.equal(await connection.signer.nip44!.decrypt(connection.pubkey, ciphertext), "geheim")
  assert.equal(await connection.remote.ping(5000), true)
  connection.remote.close()
})

test("nostrconnect://: a second bunker answering the same link while the account question is open ends as mismatch", async () => {
  const second = await startBunker(relay.url)
  try {
    let asked = () => {}
    const askedNow = new Promise<void>((resolve) => (asked = resolve))
    const shown: string[] = []
    const start = await startNostrConnect({
      relays: [relay.url],
      transport: transport(),
      timeoutMs: 10_000,
      waitMs: 20_000,
      graceMs: 0,
      // The user hasn't answered yet; the question closes when the wait ends.
      confirm: (account, signal) => {
        shown.push(account.userPubkey)
        asked()
        return new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false)))
      },
    })
    await bunker.connect(start.uri)
    await askedNow
    await second.connect(start.uri)
    await assert.rejects(start.connection, (error: SignerError) => error.code === "mismatch")
    assert.deepEqual(shown, [bunker.pubkey])
  } finally {
    await second.stop()
  }
})

test("a request the signer never answers ends as a timeout (unknown), not as a refusal", async () => {
  const connection = await (async () => {
    const start = await startNostrConnect({ relays: [relay.url], transport: transport(), timeoutMs: 10_000, waitMs: 20_000, graceMs: 500 })
    await bunker.connect(start.uri)
    return start.connection
  })()
  // nak doesn't answer methods it doesn't know (NIP-46 says it should send an error).
  const silent = resume(connection.session, { transport: transport(), timeoutMs: 1500 })
  await assert.rejects(silent.request("describe", []), (error: { code?: string }) => error.code === "timeout")
  silent.close()
  connection.remote.close()
})
