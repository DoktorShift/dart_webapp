// The profile against real relays (two "nak serve" on 127.0.0.1, P3a.03) and a real remote
// signer ("nak bunker", P2.02), with nak as an independent check of signatures and encryption.
// Nothing touches a public relay. Run: npm run test:relay
import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "../storage-helpers.ts"
import { runNak, startBunker, startRelay, type NakBunker, type NakRelay } from "../support/nak.ts"
import { createRelayClient, relayClient, type RelayClient } from "../../lib/nostr/client.ts"
import { loadCore, type Core } from "../../lib/nostr/core.ts"
import { connectBunker, createLocalSigner } from "../../lib/nostr/signers.ts"
import type { NostrEvent } from "../../lib/nostr/types.ts"
import { metadataTemplate, readMetadata } from "../../lib/profile/metadata.ts"
import { fetchOwnEvents, OWN, ownEvents } from "../../lib/profile/own-events.ts"
import { loadPublicProfile } from "../../lib/profile/public-profile.ts"
import { addRelay, editableRelays, newRelayList, relayListTemplate } from "../../lib/profile/relay-list.ts"
import { readRound, roundTemplate } from "../../lib/profile/rounds.ts"
import { connectExternal, getSigner, importLocalKey, signOut } from "../../lib/profile/session.ts"
import { publishOwn } from "../../lib/sync/publish.ts"

let core: Core
let a: NakRelay
let b: NakRelay
let bunker: NakBunker
const clients: RelayClient[] = []
const elsewhere = () => {
  const client = createRelayClient({ connectTimeoutMs: 3000, publishTimeoutMs: 5000, queryTimeoutMs: 5000 })
  clients.push(client)
  return client
}
const now = () => Math.floor(Date.now() / 1000)
const hex = (bytes: Uint8Array) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("")

before(async () => {
  core = await loadCore()
  ;[a, b] = await Promise.all([startRelay(), startRelay()])
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `${a.url},${b.url}`
  bunker = await startBunker(a.url)
})

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
})

after(async () => {
  await signOut({ keepLocalData: true })
  relayClient().close()
  for (const client of clients) client.close()
  await bunker?.stop()
  await Promise.all([a?.stop(), b?.stop()])
})

// What another device reads, through its own connections.
async function published(pubkey: string, kinds: number[]) {
  const found = await elsewhere().query([{ authors: [pubkey], kinds }], [a.url, b.url])
  assert.equal(found.complete, true)
  return found.events
}

test("a new profile's name and relay list reach both relays, signed so that nak verifies them", async () => {
  const secret = core.generateSecretKey()
  const { pubkey } = await importLocalKey(secret)
  const reports = await publishOwn([relayListTemplate(newRelayList()), metadataTemplate({ name: "Lena" })])
  assert.ok(reports.every((r) => r.published && r.results.every((x) => x.ok)))
  const events = await published(pubkey, [0, 10002])
  assert.deepEqual(events.map((e) => e.kind).sort((x, y) => x - y), [0, 10002])
  assert.equal(await runNak(["verify"], { input: `${events.map((e) => JSON.stringify(e)).join("\n")}\n` }), "")
  assert.deepEqual(events.find((e) => e.kind === 10002)!.tags, [["r", a.url], ["r", b.url]])
  // Anyone can open it: a public profile, read from the relays.
  const { profile, status } = await loadPublicProfile(pubkey)
  assert.equal(status, "complete")
  assert.equal(readMetadata(profile.metadata).name, "Lena")
})

test("an existing profile from another app: read, changed, and every field of the other app kept", async () => {
  const secret = core.generateSecretKey()
  const pubkey = core.getPublicKey(secret)
  // The other app's profile and relay list, with fields and tags BlueLine doesn't know.
  const theirs = (kind: number, content: string, tags: string[][]) => core.finalizeEvent({ kind, content, tags, created_at: now() - 100 }, secret)
  const other = elsewhere()
  await other.publish(theirs(0, JSON.stringify({ name: "lena_s", display_name: "Lena S.", about: "Darts!", lud16: "lena@wallet.example", nip05: "lena@example.com" }), [["i", "github:lena", "proof"]]), [a.url, b.url])
  await other.publish(theirs(10002, "", [["r", a.url, "write"], ["r", "ws://10.0.0.2:7777"], ["client", "other-app"]]), [a.url, b.url])

  await importLocalKey(secret)
  const fetched = await fetchOwnEvents(pubkey)
  assert.deepEqual(fetched.failed, [])
  const mine = await ownEvents(pubkey)
  assert.equal(readMetadata(mine.get(OWN.metadata)).name, "Lena S.")

  await publishOwn([metadataTemplate({ name: "Lena Schmidt" }, mine.get(OWN.metadata)), relayListTemplate(addRelay(editableRelays(mine.get(OWN.relayList)), b.url)!, mine.get(OWN.relayList))])
  const [metadata, relays] = [0, 10002].map((kind) => published(pubkey, [kind]).then(([e]) => e))
  assert.deepEqual(JSON.parse((await metadata).content), { name: "lena_s", display_name: "Lena Schmidt", about: "Darts!", lud16: "lena@wallet.example", nip05: "lena@example.com" })
  assert.deepEqual((await metadata).tags, [["i", "github:lena", "proof"]])
  assert.deepEqual((await relays).tags, [["r", a.url, "write"], ["r", b.url], ["r", "ws://10.0.0.2:7777"], ["client", "other-app"]])
})

test("a player round travels with the profile; its guests are readable only with the key, also by nak", async () => {
  const secret = core.generateSecretKey()
  const { pubkey } = await importLocalKey(secret)
  const lena = core.getPublicKey(core.generateSecretKey())
  await publishOwn([await roundTemplate({ id: "f".repeat(32), title: "Dienstag", players: [{ name: "Lena", pubkey: lena }, { name: "Gast Mia" }] }, null, await getSigner())])
  const [event] = await published(pubkey, [30000])
  assert.deepEqual(event.tags, [["d", `blueline-round-${"f".repeat(32)}`], ["title", "Dienstag"], ["p", lena]])
  assert.ok(!JSON.stringify(event).includes("Mia"))
  // Another device with the same key reads every seat; nak decrypts the same private part.
  const round = await readRound(event as NostrEvent, await createLocalSigner(secret))
  assert.deepEqual(round?.players, [{ name: "Lena", pubkey: lena }, { name: "Gast Mia" }])
  const plain = await runNak(["decrypt", "--sec", hex(secret), "-p", pubkey, event.content])
  assert.deepEqual(JSON.parse(plain), [["player", "Lena", lena], ["player", "Gast Mia"]])
})

test("a profile kept in a signer app (nak bunker): signs through it, and every signature is checked", async () => {
  const connection = await connectBunker(bunker.uri, { timeoutMs: 15_000, perms: ["sign_event:0", "nip44_encrypt", "nip44_decrypt"] })
  const session = await connectExternal("nip46", { connection })
  assert.equal(session.pubkey, bunker.pubkey)
  const [report] = await publishOwn([metadataTemplate({ name: "Bunker Lena" })])
  assert.equal(report.event.pubkey, bunker.pubkey)
  assert.ok(core.verifyEventSignature(report.event))
  const [event] = await published(bunker.pubkey, [0])
  assert.equal(readMetadata(event).name, "Bunker Lena")
})
