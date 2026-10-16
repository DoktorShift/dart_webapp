import { after, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN, at, resetStorage } from "./storage-helpers.ts"
import { matchA, matchB } from "./storage-fixtures.ts"
import { FakeNetwork } from "./support/fake-relay.ts"
import { createProfile } from "../components/profile/create-profile.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { loadCore } from "../lib/nostr/core.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { metadataTemplate } from "../lib/profile/metadata.ts"
import { ownEvents, rememberOwn } from "../lib/profile/own-events.ts"
import { connectExternal, getSession, getSigner, importLocalKey, signOut, startLocalProfile } from "../lib/profile/session.ts"
import { archiveFinished, type ArchivedMatch } from "../lib/storage/archive.ts"
import { dbGetAll } from "../lib/storage/db.ts"
import { assignPlayers, listPlayers, newPlayerRecord, savePlayers } from "../lib/storage/players.ts"
import { publish, publishOwn, submitOwn } from "../lib/sync/publish.ts"

// What leaves the device, through the one publishing interface (lib/sync/publish.ts): nothing
// for a guest, and for a new profile its name, picture and relay list, nothing of its games
// (PLAN.md "Nutzerwege": private history, opponents and earlier guests are never published).

const URLS = ["wss://one.example", "wss://two.example", "wss://three.example"]
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = URLS.join(",")
const network = new FakeNetwork()
const relays = URLS.map((url) => network.add(url))
Object.assign(globalThis, { WebSocket: network.WebSocket })

const received = () => relays.flatMap((relay) => relay.events)

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
  for (const relay of relays) relay.events = []
})

after(() => relayClient().close())

async function twoGames() {
  await savePlayers([newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), newPlayerRecord("Ben", "2026-09-01T10:00:00.000Z", BEN)])
  await archiveFinished(matchA(), undefined, at("2026-10-01T20:00:00.000Z"))
  await archiveFinished(matchB(), undefined, at("2026-10-02T20:00:00.000Z"))
}

test("a guest publishes nothing, whatever is asked", async () => {
  await twoGames()
  const core = await loadCore()
  const event = core.finalizeEvent({ kind: 0, tags: [], content: '{"name":"Anna"}', created_at: 1_790_000_000 }, core.generateSecretKey())
  await assert.rejects(publish([event]), /without a profile/)
  await assert.rejects(publishOwn([metadataTemplate({ name: "Anna" })]), /without a profile/)
  assert.deepEqual(received(), [])
})

test("a profile publishes only its own events", async () => {
  await startLocalProfile()
  const core = await loadCore()
  const other = core.finalizeEvent({ kind: 0, tags: [], content: "{}", created_at: 1_790_000_000 }, core.generateSecretKey())
  await assert.rejects(publish([other]), /signed-in profile/)
  assert.deepEqual(received(), [])
})

test("a change signed while another profile signs in is neither kept nor sent", async () => {
  const core = await loadCore()
  const key = core.generateSecretKey()
  // A browser extension that waits for the person to approve.
  let approve = () => {}
  const approved = new Promise<void>((resolve) => (approve = resolve))
  const page = globalThis.window as unknown as { nostr?: unknown }
  page.nostr = {
    getPublicKey: async () => core.getPublicKey(key),
    signEvent: async (t: object) => {
      await approved
      return core.finalizeEvent({ ...(t as Parameters<typeof core.finalizeEvent>[0]) }, key)
    },
  }
  try {
    const a = await connectExternal("nip07", { pubkey: core.getPublicKey(key) })
    const change = submitOwn([metadataTemplate({ name: "Anna" })])
    await new Promise((resolve) => setTimeout(resolve, 20))
    await importLocalKey(core.generateSecretKey(), { replace: true })
    approve()
    await assert.rejects(change, /another profile/)
    assert.equal((await ownEvents(a.pubkey)).size, 0, "nothing of the first profile is back on the device")
    assert.deepEqual(received(), [])
  } finally {
    delete page.nostr
  }
})

test("creating a profile from a game: name, picture and relays go out; the games stay, and only this seat's become the profile's", async () => {
  await twoGames()
  const { published } = await createProfile({ name: "Anna Schmidt", picture: "https://img.example/anna.jpg", claim: { matchId: "match-a", seat: 0 } })
  const pubkey = getSession()!.pubkey
  // The profile is complete here before any relay answered; the events are the profile's own.
  assert.equal((await ownEvents(pubkey)).size, 2)
  await published

  // Every relay has the two events, signed by the new profile, and nothing else.
  for (const relay of relays) assert.deepEqual(relay.events.map((e) => e.kind).sort((a, b) => a - b), [0, 10002], relay.url)
  const [metadata, relayList] = [0, 10002].map((kind) => relays[0].events.find((e) => e.kind === kind) as NostrEvent)
  assert.ok(received().every((e) => e.pubkey === pubkey))
  assert.deepEqual(JSON.parse(metadata.content), { name: "Anna Schmidt", display_name: "Anna Schmidt", picture: "https://img.example/anna.jpg" })
  assert.deepEqual(metadata.tags, [])
  assert.deepEqual(relayList.tags, URLS.map((url) => ["r", url]))
  // No opponent, no game, no score in anything published (ids and signatures are random hex,
  // so only what the events say is looked at).
  const everything = JSON.stringify(received().map((e) => [e.kind, e.tags, e.content]))
  for (const secret of ["Ben", "match-a", "match-b", "301"]) assert.ok(!everything.includes(secret), secret)

  // Anna (seat 0) is the profile's player, still named as she plays; Ben is nobody's.
  const players = await listPlayers()
  assert.equal(players.find((p) => p.id === ANNA)?.pubkey, pubkey)
  assert.equal(players.find((p) => p.id === ANNA)?.name, "Anna")
  assert.equal(players.find((p) => p.id === BEN)?.pubkey, undefined)
  // The next game counts for the profile: typed as before, or seated as "Du" by the profile.
  assert.deepEqual(
    assignPlayers(["Anna", "Ben"], players).players.map((p) => p.id),
    [ANNA, BEN],
  )
  assert.equal(assignPlayers(["Anna"], players, undefined, [pubkey]).players[0].id, ANNA)
  // Anna's games are marked as the profile's, Ben's seats are not.
  const games = await dbGetAll<ArchivedMatch>("matches")
  assert.equal(games.length, 2)
  for (const game of games) {
    assert.deepEqual(
      game.players.map((p) => [p.playerId, p.pubkey ?? null]),
      [
        [ANNA, pubkey],
        [BEN, null],
      ],
    )
  }
})

test("a profile from nobody's games starts with a player of its own, named as a seat holds it", async () => {
  await twoGames()
  await (await createProfile({ name: "Carla Konstantinopoulou", picture: "", claim: null })).published
  const pubkey = getSession()!.pubkey
  const players = await listPlayers()
  assert.deepEqual(players.filter((p) => p.pubkey === pubkey).map((p) => p.name), ["Carla Konstantin"])
  const metadata = relays[0].events.find((e) => e.kind === 0)!
  assert.deepEqual(JSON.parse(metadata.content), { name: "Carla Konstantinopoulou", display_name: "Carla Konstantinopoulou" })
  assert.ok((await dbGetAll<ArchivedMatch>("matches")).every((m) => m.players.every((p) => !p.pubkey)))
})

test("blocked relays never get anything", async () => {
  const { pubkey } = await startLocalProfile()
  // The blocked list as another app may have published it: one relay of ours on it.
  const blocked = await (await getSigner()).signEvent({ kind: 10006, tags: [["relay", URLS[1]]], content: "", created_at: 1_790_000_000 })
  await rememberOwn(pubkey, [blocked])
  const [report] = await publishOwn([metadataTemplate({ name: "Lena" })])
  assert.deepEqual(report.relays, [URLS[0], URLS[2]])
  assert.equal(relays[1].events.length, 0)
  assert.ok(report.published)
})
