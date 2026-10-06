// Badges against real relays (two "nak serve" on 127.0.0.1) with nak as the independent reader:
// a self-earned milestone's definition, evidence, award and list as published, read back and
// verified by nak; the organizer's awards; and the data file's badge section read by nak.
// Nothing touches a public relay. Run: npm run test:relay
import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "../storage-helpers.ts"
import { archivedAt, matchA } from "../storage-fixtures.ts"
import { ANNA } from "../storage-helpers.ts"
import { runNak, startRelay, type NakRelay } from "../support/nak.ts"
import { showMilestone } from "../../lib/badges/actions.ts"
import { validAwards } from "../../lib/badges/awards.ts"
import { milestoneById } from "../../lib/badges/catalog.ts"
import { buildBadgeSection } from "../../lib/badges/export.ts"
import { evaluateMilestones } from "../../lib/badges/milestones.ts"
import { issueAwards, type BadgeOccasion } from "../../lib/badges/organizer.ts"
import { fetchBadges, storedBadgeEvents } from "../../lib/badges/store.ts"
import { relayClient } from "../../lib/nostr/client.ts"
import { loadCore, type Core } from "../../lib/nostr/core.ts"
import { lookupOwnEvents } from "../../lib/profile/own-events.ts"
import { importLocalKey, signOut } from "../../lib/profile/session.ts"
import type { ArchivedMatch } from "../../lib/storage/archive.ts"
import { dbWrite } from "../../lib/storage/db.ts"
import { newPlayerRecord, savePlayers } from "../../lib/storage/players.ts"

let core: Core
let a: NakRelay
let b: NakRelay
const events = (args: string[]) => runNak(["req", ...args, a.url]).then((out) => out.split("\n").filter(Boolean).map((line) => JSON.parse(line)))
const verifies = async (list: unknown[]) => (await runNak(["verify"], { input: `${list.map((e) => JSON.stringify(e)).join("\n")}\n` })) === ""

before(async () => {
  core = await loadCore()
  // The wave 3 badges track's relay ports (20080-20089): two relays of different "operators".
  ;[a, b] = await Promise.all([startRelay({ port: 20085 }), startRelay({ port: 20086 })])
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `${a.url},${b.url}`
})

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
})

after(async () => {
  await signOut({ keepLocalData: true })
  relayClient().close()
  await Promise.all([a?.stop(), b?.stop()])
})

const TEXTS = { name: "Erste 180", description: "Drei Triple-20 in einer Aufnahme." }

// Anna's profile with game A (her 180) archived on this device.
async function annaWithGame() {
  const secret = core.generateSecretKey()
  const { pubkey } = await importLocalKey(secret)
  await savePlayers([{ ...newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), pubkey }])
  const game = archivedAt(matchA(), "2026-10-02T20:00:00.000Z")
  const mine: ArchivedMatch = { ...game, players: game.players.map((p, i) => (i === 0 ? { ...p, pubkey } : p)) }
  await dbWrite([{ store: "matches", put: mine }])
  return { secret, pubkey }
}

test("a self-earned milestone reaches both relays as four events nak verifies, and a second device reads them back", async () => {
  const { secret, pubkey } = await annaWithGame()
  const achieved = evaluateMilestones([archivedAt(matchA(), "2026-10-02T20:00:00.000Z")], `id:${ANNA}`).find((s) => s.milestone.id === "first-180")!.achieved!
  assert.equal(await showMilestone(pubkey, milestoneById("first-180")!, achieved, TEXTS), "done")
  const published = await events(["-a", pubkey, "-k", "8", "-k", "30009", "-k", "1180", "-k", "10008"])
  assert.deepEqual(published.map((e: { kind: number }) => e.kind).sort((x: number, y: number) => x - y), [8, 1180, 10008, 30009])
  assert.ok(await verifies(published))
  const award = published.find((e: { kind: number }) => e.kind === 8)
  const evidence = published.find((e: { kind: number }) => e.kind === 1180)
  assert.deepEqual(award.tags.filter((t: string[]) => t[0] === "e" || t[0] === "p"), [["p", pubkey], ["e", evidence.id]])
  assert.deepEqual(JSON.parse(evidence.content).result, { game: "match-a", finishedAt: Date.parse("2026-10-02T20:00:00.000Z") / 1000, mode: "301", value: 180 })

  // A second device of the same profile, with nothing but the key.
  await signOut({ keepLocalData: false })
  await resetStorage()
  await importLocalKey(secret)
  await lookupOwnEvents(pubkey)
  assert.equal(await fetchBadges(pubkey), "complete")
  const [shown] = await validAwards(await storedBadgeEvents(pubkey), pubkey)
  assert.equal(shown.award.id, award.id)
  assert.equal(shown.blueline?.scope, "self")
  // The data file's badge section is what nak verifies too: an independent reader of the export.
  assert.ok(await verifies(await buildBadgeSection()))
})

test("the organizer's awards are published once per player and occasion, and nak reads them by their recipient", async () => {
  const secret = core.generateSecretKey()
  const { pubkey: organizer } = await importLocalKey(secret)
  const anna = core.getPublicKey(core.generateSecretKey())
  const ben = core.getPublicKey(core.generateSecretKey())
  const occasion: BadgeOccasion = {
    scope: "tournament",
    scopeId: "f".repeat(64),
    occasionId: "f".repeat(64),
    name: "Herbstcup",
    ended: { event: "e".repeat(64), by: organizer, at: 1_790_000_000 },
    places: [
      { pubkey: anna, place: 1, games: 2 },
      { pubkey: ben, place: 2, games: 2 },
    ],
    final: true,
  }
  const texts = (badge: string, name: string) => ({ name: badge, description: `${badge} of ${name}` })
  assert.deepEqual(await issueAwards(organizer, occasion, texts), { given: 4, known: 0 })
  assert.deepEqual(await issueAwards(organizer, occasion, texts), { given: 0, known: 4 })
  const annas = await events(["-k", "8", "-p", anna])
  assert.equal(annas.length, 2)
  assert.ok(await verifies(annas))
  assert.ok(annas.every((e: { pubkey: string; tags: string[][] }) => e.pubkey === organizer && e.tags.some((t) => t[0] === "occasion" && t[1] === "f".repeat(64))))
  assert.equal((await events(["-k", "8", "-a", organizer])).length, 4)
})
