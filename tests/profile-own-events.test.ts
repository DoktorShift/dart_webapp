import { after, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { FakeNetwork } from "./support/fake-relay.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { loadCore } from "../lib/nostr/core.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { metadataTemplate } from "../lib/profile/metadata.ts"
import { RELAY_LIST_KIND } from "../lib/profile/relay-list.ts"
import { changeBase, lookupOwnEvents, OWN, ownEvents, ownLookup, rememberOwn } from "../lib/profile/own-events.ts"
import { connectExternal, signOut } from "../lib/profile/session.ts"

// A change of the profile builds on the version relays have, and a profile that could not be
// loaded is never written over (PLAN.md "Profilbearbeitung": the current version is loaded
// first; "Bestehende Profilfelder … bleiben erhalten").

const URLS = ["wss://one.example", "wss://two.example"]
// A relay only the profile's own list names.
const OWN_URL = "wss://three.example"
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = URLS.join(",")
const network = new FakeNetwork()
const relays = URLS.map((url) => network.add(url))
const own = network.add(OWN_URL)
Object.assign(globalThis, { WebSocket: network.WebSocket })

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
  for (const relay of [...relays, own]) {
    relay.events = []
    relay.options.mode = "up"
  }
})

after(() => relayClient().close())

// A profile kept in another app: its key signs here only to make the versions.
async function someoneElsewhere() {
  const core = await loadCore()
  const secret = core.generateSecretKey()
  const pubkey = core.getPublicKey(secret)
  const version = (name: string, created_at: number) => core.finalizeEvent({ kind: 0, tags: [], content: JSON.stringify({ name, about: "Darts!" }), created_at }, secret) as NostrEvent
  const relayList = (urls: string[], created_at: number) => core.finalizeEvent({ kind: RELAY_LIST_KIND, tags: urls.map((url) => ["r", url]), content: "", created_at }, secret) as NostrEvent
  await connectExternal("nip07", { pubkey })
  return { pubkey, version, relayList }
}

test("a change builds on the newest version the relays have, not on an older copy here", async () => {
  const { pubkey, version } = await someoneElsewhere()
  await rememberOwn(pubkey, [version("Lena", 1_790_000_000)])
  relays[0].events.push(version("Lena S.", 1_790_000_100))
  const base = await changeBase(pubkey, OWN.metadata)
  assert.equal(base?.created_at, 1_790_000_100)
  assert.deepEqual(JSON.parse(metadataTemplate({ picture: "https://img.example/l.jpg" }, base).content), { name: "Lena S.", about: "Darts!", picture: "https://img.example/l.jpg" })
  assert.deepEqual(ownLookup(pubkey), { state: "complete" })
})

// Relays that can't be reached, connections from earlier tests included.
function allDown() {
  for (const relay of relays) {
    relay.options.mode = "down"
    relay.dropAll()
  }
}

test("nothing here and no relay answering: the change is refused, and the profile shows as not loaded", async () => {
  const { pubkey } = await someoneElsewhere()
  allDown()
  await assert.rejects(changeBase(pubkey, OWN.metadata), { name: "OwnEventsError", code: "unreachable" })
  const lookup = ownLookup(pubkey)
  assert.equal(lookup?.state, "incomplete")
  assert.deepEqual(lookup?.state === "incomplete" && lookup.unanswered.sort(), URLS)
  assert.equal((await ownEvents(pubkey)).size, 0)
  // Once a relay can be reached, the next attempt asks again on its own.
  for (const relay of relays) relay.options.mode = "up"
  assert.equal(await changeBase(pubkey, OWN.metadata), null)
  assert.deepEqual(ownLookup(pubkey), { state: "complete" })
})

// Decision 0002 §5: a relay that gave no answer leaves the result unknown, never empty.
test("the profile's own relay down while the app's relays have nothing: not found is not known, and nothing is written over", async () => {
  const { pubkey, relayList } = await someoneElsewhere()
  await rememberOwn(pubkey, [relayList([OWN_URL], 1_790_000_000)])
  own.options.mode = "down"
  await assert.rejects(changeBase(pubkey, OWN.metadata), { name: "OwnEventsError", code: "unreachable" })
  assert.deepEqual(ownLookup(pubkey), { state: "incomplete", unanswered: [OWN_URL] })
  // The list itself is known here, so it can still be changed.
  assert.equal((await changeBase(pubkey, OWN.relayList))?.kind, RELAY_LIST_KIND)
  // Back, the lookup is complete and the metadata turns out not to exist anywhere.
  own.options.mode = "up"
  assert.equal(await changeBase(pubkey, OWN.metadata), null)
  assert.deepEqual(ownLookup(pubkey), { state: "complete" })
})

// Decision 0002 §1: a change takes effect at once; a relay that doesn't answer may not hold it up.
test("a version kept here is changed after a moment at most while a relay keeps quiet", async () => {
  const { pubkey, version } = await someoneElsewhere()
  await rememberOwn(pubkey, [version("Lena", 1_790_000_000)])
  for (const relay of relays) relay.options.mode = "silent"
  const started = Date.now()
  const base = await changeBase(pubkey, OWN.metadata)
  const took = Date.now() - started
  assert.equal(base?.created_at, 1_790_000_000)
  assert.ok(took < 5000, `waited ${took} ms`)
  assert.deepEqual(ownLookup(pubkey), { state: "asking" })
  for (const relay of relays) {
    relay.options.mode = "up"
    relay.dropAll()
  }
})

test("a version kept here is enough to change while relays are down", async () => {
  const { pubkey, version } = await someoneElsewhere()
  await rememberOwn(pubkey, [version("Lena", 1_790_000_000)])
  allDown()
  const base = await changeBase(pubkey, OWN.metadata)
  assert.equal(base?.created_at, 1_790_000_000)
})

test("relays that answered without a version: there is nothing to build on, and that is known", async () => {
  const { pubkey } = await someoneElsewhere()
  assert.equal(await changeBase(pubkey, OWN.metadata), null)
  assert.deepEqual(ownLookup(pubkey), { state: "complete" })
})

test("one lookup per page load, shared while it runs; asked again only when wanted", async () => {
  const { pubkey } = await someoneElsewhere()
  const first = lookupOwnEvents(pubkey)
  assert.equal(lookupOwnEvents(pubkey), first)
  assert.deepEqual(ownLookup(pubkey), { state: "asking" })
  await first
  const asked = relays[0].reqs.length
  await lookupOwnEvents(pubkey)
  assert.equal(relays[0].reqs.length, asked)
  await lookupOwnEvents(pubkey, { again: true })
  assert.ok(relays[0].reqs.length > asked)
  // Signing out forgets the lookup: the next profile on this page starts over.
  await signOut({ keepLocalData: true })
  assert.equal(ownLookup(pubkey), null)
})
