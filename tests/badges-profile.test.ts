import { after, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { A_CONFIG, matchA, matchB } from "./storage-fixtures.ts"
import { ANNA, at, resetStorage, saved } from "./storage-helpers.ts"
import { dart, play } from "./helpers.ts"
import { FakeNetwork } from "./support/fake-relay.ts"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { relayClient } from "../lib/nostr/client.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { requestDeletion, showMilestone } from "../lib/badges/actions.ts"
import { validAwards } from "../lib/badges/awards.ts"
import { milestoneById } from "../lib/badges/catalog.ts"
import { evaluateMilestones } from "../lib/badges/milestones.ts"
import { currentSelection } from "../lib/badges/selection.ts"
import { readEvidence, selfAwardHolds } from "../lib/badges/self-award.ts"
import { fetchBadges, storedBadgeEvents } from "../lib/badges/store.ts"
import { lookupOwnEvents } from "../lib/profile/own-events.ts"
import { importLocalKey, signOut } from "../lib/profile/session.ts"
import { archiveFinished, loadArchive } from "../lib/storage/archive.ts"
import { newPlayerRecord, savePlayers } from "../lib/storage/players.ts"

// "Im Profil zeigen" for a milestone, through the profile's one publishing interface and two
// relays (in memory): what goes out, what a second device finds, what a correction does.

const URLS = ["wss://one.example", "wss://two.example"]
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = URLS.join(",")
const network = new FakeNetwork()
const relays = URLS.map((url) => network.add(url))
Object.assign(globalThis, { WebSocket: network.WebSocket })

const secret = generateSecretKey()
const pubkey = getPublicKey(secret)
const anna = `id:${ANNA}`
const TEXTS = { name: "Erste 180", description: "Selbst erreicht: drei Triple-20 in einer Aufnahme." }
const kinds = () => relays[0].events.map((e) => e.kind).sort((a, b) => a - b)
const published = (kind: number) => relays[0].events.filter((e) => e.kind === kind)

// A device where Anna is the profile's player and has played game A (her 180) and B.
async function device() {
  await importLocalKey(secret)
  await savePlayers([{ ...newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), pubkey }])
  await archiveFinished(matchA(), undefined, at("2026-10-02T20:00:00.000Z"))
  await archiveFinished(matchB(), undefined, at("2026-10-03T20:00:00.000Z"))
}
const first180 = async () => evaluateMilestones(await loadArchive(), anna).find((s) => s.milestone.id === "first-180")!.achieved!

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
  for (const relay of relays) {
    relay.events = []
    relay.options.mode = "up"
  }
})

after(() => relayClient().close())

test("showing a milestone: definition, evidence, award and the list, signed by the profile; once only", async () => {
  await device()
  const milestone = milestoneById("first-180")!
  assert.equal(await showMilestone(pubkey, milestone, await first180(), TEXTS), "done")
  assert.deepEqual(kinds(), [8, 1180, 10008, 30009])
  assert.ok(relays[0].events.every((e) => e.pubkey === pubkey))

  // The evidence names the game, its date, mode and the 180; nothing about Ben or other games.
  const [evidence] = published(1180)
  assert.deepEqual(JSON.parse(evidence.content), { badge: "blueline:self:first-180:v1", result: { game: "match-a", finishedAt: Date.parse("2026-10-02T20:00:00.000Z") / 1000, mode: "301", value: 180 } })
  assert.ok(!JSON.stringify(relays[0].events).includes("Ben"))
  const [award] = published(8)
  assert.deepEqual(award.tags.slice(0, 4), [["a", `30009:${pubkey}:blueline:self:first-180:v1`], ["p", pubkey], ["e", evidence.id], ["occasion", "once"]])
  assert.deepEqual(published(10008)[0].tags, [["a", `30009:${pubkey}:blueline:self:first-180:v1`], ["e", award.id]])

  // Kept on this device, and valid as "Selbst erreicht".
  const [shown] = await validAwards(await storedBadgeEvents(pubkey), pubkey)
  assert.equal(shown.award.id, award.id)
  assert.equal(shown.blueline?.scope, "self")

  // Again (another tap, a second try): nothing new is signed or sent.
  assert.equal(await showMilestone(pubkey, milestone, await first180(), TEXTS), "done")
  assert.deepEqual(kinds(), [8, 1180, 10008, 30009])
})

test("the former list is taken over with everything another app put in it", async () => {
  await device()
  const otherApp = generateSecretKey()
  const foreign = ["a", `30009:${getPublicKey(otherApp)}:early-adopter`]
  const legacy = finalizeEvent({ kind: 30008, created_at: 1_790_000_000, content: "", tags: [["d", "profile_badges"], foreign, ["e", "5".repeat(64)], ["client", "other"]] }, secret) as NostrEvent
  relays[0].events.push(legacy)
  assert.equal(await showMilestone(pubkey, milestoneById("first-180")!, await first180(), TEXTS), "done")
  const [list] = published(10008)
  const [award] = published(8)
  assert.deepEqual(list.tags, [["a", `30009:${pubkey}:blueline:self:first-180:v1`], ["e", award.id], foreign, ["e", "5".repeat(64)], ["client", "other"]])
  // The former list is left for the apps that still read it.
  assert.ok(relays[0].events.includes(legacy))
})

test("without any relay answering nothing is signed, kept or sent", async () => {
  await device()
  for (const relay of relays) {
    relay.options.mode = "down"
    relay.dropAll()
  }
  assert.equal(await showMilestone(pubkey, milestoneById("first-180")!, await first180(), TEXTS), "offline")
  assert.deepEqual(await storedBadgeEvents(pubkey), [])
  assert.deepEqual(relays.flatMap((r) => r.events), [])
})

test("a correction takes the evidence away; the deletion request takes the award back", async () => {
  await device()
  await showMilestone(pubkey, milestoneById("first-180")!, await first180(), TEXTS)
  const events = await storedBadgeEvents(pubkey)
  const [award] = await validAwards(events, pubkey)
  const evidence = readEvidence(events.find((e) => e.id === award.blueline?.evidence)!)
  assert.equal(selfAwardHolds(award, evidence, await loadArchive(), anna), true)

  // Anna's first dart in A was a T19: 177, not 180 (corrected on the result screen).
  await archiveFinished(saved(A_CONFIG, play(A_CONFIG, [dart(19, 3), dart(20, 3), dart(20, 3), dart(20), dart(20), dart(20), dart(20, 3), dart(14, 3), dart(11, 2)]), "match-a"))
  assert.equal(selfAwardHolds(award, evidence, await loadArchive(), anna), false)

  assert.equal(await requestDeletion(pubkey, [award], "Das Spiel wurde korrigiert."), "done")
  const [deletion] = published(5)
  assert.deepEqual(
    deletion.tags.filter((t) => t[0] === "e").map((t) => t[1]).sort(),
    [award.award.id, evidence!.id].sort(),
  )
  assert.deepEqual(currentSelection(relays[0].events, pubkey).badges, [])
  assert.deepEqual(await validAwards(await storedBadgeEvents(pubkey), pubkey), [])
})

test("a second device finds the badges on relays, each once however often it is fetched", async () => {
  await device()
  await showMilestone(pubkey, milestoneById("first-180")!, await first180(), TEXTS)
  // Another app gave the player a badge, sent to both relays.
  const otherApp = generateSecretKey()
  const definition = finalizeEvent({ kind: 30009, created_at: 1_790_000_000, content: "", tags: [["d", "darts-fan"], ["name", "Darts-Fan"]] }, otherApp) as NostrEvent
  const given = finalizeEvent({ kind: 8, created_at: 1_790_000_001, content: "", tags: [["a", `30009:${definition.pubkey}:darts-fan`], ["p", pubkey]] }, otherApp) as NostrEvent
  for (const relay of relays) relay.events.push(definition, given)

  // The new device: nothing of the profile here yet.
  await signOut({ keepLocalData: false })
  await resetStorage()
  await importLocalKey(secret)
  assert.deepEqual(await storedBadgeEvents(pubkey), [])
  // The list of shown badges comes with the profile's own events, the rest with the badges.
  await lookupOwnEvents(pubkey)
  assert.equal(await fetchBadges(pubkey), "complete")
  assert.equal(await fetchBadges(pubkey), "complete")
  const stored = await storedBadgeEvents(pubkey)
  assert.equal(new Set(stored.map((e) => e.id)).size, stored.length)
  const awards = await validAwards(stored, pubkey)
  assert.deepEqual(awards.map((a) => a.name).sort(), ["Darts-Fan", "Erste 180"])
  assert.equal(currentSelection(stored, pubkey).badges.length, 1)
})
