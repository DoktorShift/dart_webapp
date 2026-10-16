import { after, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { FakeNetwork } from "./support/fake-relay.ts"
import { outboxTried } from "./support/outbox.ts"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { relayClient } from "../lib/nostr/client.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { validAwards } from "../lib/badges/awards.ts"
import { registerIssuerCheck } from "../lib/badges/issuers.ts"
import { awardPlan, currentPlan, giveRecognition, issueAwards, plannedAwards, withdrawAwards, type BadgeOccasion } from "../lib/badges/organizer.ts"
import { badgeAwardTemplate, badgeD } from "../lib/protocol/badges.ts"
import { importLocalKey, signOut } from "../lib/profile/session.ts"

// Badges from a tournament's organizer and a club's owner (decision 0001 F3, A23): who gets
// which, each once however often the end is processed, and taken back when a correction changes
// the result.

const URLS = ["wss://one.example", "wss://two.example"]
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = URLS.join(",")
const network = new FakeNetwork()
const relays = URLS.map((url) => network.add(url))
Object.assign(globalThis, { WebSocket: network.WebSocket })

const organizerKey = generateSecretKey()
const organizer = getPublicKey(organizerKey)
const [anna, ben, carla, dirk] = Array.from({ length: 4 }, () => getPublicKey(generateSecretKey()))
const TOURNAMENT = "a".repeat(64)
const ENDED = "b".repeat(64)
const texts = (badge: string) => ({ name: badge, description: `Badge ${badge} of the Herbstcup.` })

// A single-elimination tournament with a final: Anna beat Ben in it, Carla and Dirk went out
// before.
const herbstcup: BadgeOccasion = {
  scope: "tournament",
  scopeId: TOURNAMENT,
  occasionId: TOURNAMENT,
  name: "Herbstcup",
  ended: { event: ENDED, by: organizer, at: 1_790_000_000 },
  places: [
    { pubkey: anna, place: 1, games: 3 },
    { pubkey: ben, place: 2, games: 3 },
    { pubkey: carla, place: 3, games: 2 },
    { pubkey: dirk, place: 3, games: 2 },
  ],
  final: true,
}

// A season with five games needed for a place in the table: Dirk played two.
const season: BadgeOccasion = {
  scope: "club",
  scopeId: "c".repeat(64),
  occasionId: "d".repeat(32),
  name: "Herbst 2026",
  ended: { event: "e".repeat(64), by: organizer, at: 1_790_000_000 },
  places: [
    { pubkey: ben, place: 1, games: 9 },
    { pubkey: anna, place: 2, games: 7 },
    { pubkey: dirk, place: 3, games: 2 },
  ],
  minGames: 5,
}

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
  for (const relay of relays) relay.events = []
})

after(() => relayClient().close())

const pairs = (plan: { badge: string; recipient: string }[]) => plan.map((p) => `${p.badge}:${p.recipient.slice(0, 4)}`).sort()

test("who gets which badge: winner, finalist and every participant; season winner and regulars", () => {
  assert.deepEqual(
    pairs(plannedAwards(herbstcup)),
    pairs([
      { badge: "tournament-winner", recipient: anna },
      { badge: "tournament-participant", recipient: anna },
      { badge: "tournament-finalist", recipient: ben },
      { badge: "tournament-participant", recipient: ben },
      { badge: "tournament-participant", recipient: carla },
      { badge: "tournament-participant", recipient: dirk },
    ]),
  )
  // Without a final (round robin), second place is no finalist.
  assert.ok(!plannedAwards({ ...herbstcup, final: false }).some((p) => p.badge === "tournament-finalist"))
  assert.deepEqual(
    pairs(plannedAwards(season)),
    pairs([
      { badge: "season-winner", recipient: ben },
      { badge: "season-regular", recipient: ben },
      { badge: "season-regular", recipient: anna },
    ]),
  )
})

test("the plan: what was given counts, what no longer fits is stale", () => {
  const d = (badge: string) => badgeD({ badge, version: 1, scope: "tournament", scopeId: TOURNAMENT })
  const given = (badge: string, recipient: string, at: number) =>
    finalizeEvent(badgeAwardTemplate({ issuer: organizer, d: d(badge), recipient, evidence: ENDED, occasion: TOURNAMENT }, at), organizerKey) as NostrEvent
  // Before a correction, Ben had won the final: his winner badge, Anna's finalist badge, and
  // Carla's participation were sent, the latter twice.
  const events = [given("tournament-winner", ben, 1), given("tournament-finalist", anna, 2), given("tournament-participant", carla, 3), given("tournament-participant", carla, 4)]
  const plan = awardPlan(events, organizer, herbstcup)
  assert.deepEqual(pairs(plan.given), pairs([{ badge: "tournament-participant", recipient: carla }]))
  assert.deepEqual(pairs(plan.stale), pairs([{ badge: "tournament-winner", recipient: ben }, { badge: "tournament-finalist", recipient: anna }]))
  assert.equal(plan.missing.length, 5)
  // Another organizer's awards for the same tournament are not this one's.
  assert.equal(awardPlan(events, anna, herbstcup).given.length, 0)
})

test("issuing sends only what is missing, however often the end is processed", async () => {
  await importLocalKey(organizerKey)
  assert.deepEqual(await issueAwards(organizer, herbstcup, texts), { given: 6, known: 0 })
  await outboxTried()
  const sent = () => relays[0].events.filter((e) => e.kind === 8)
  assert.equal(sent().length, 6)
  assert.equal(relays[0].events.filter((e) => e.kind === 30009).length, 3)
  // Processed again (a reload, a second device of the organizer after its sync): nothing new.
  assert.deepEqual(await issueAwards(organizer, herbstcup, texts), { given: 0, known: 6 })
  await outboxTried()
  assert.equal(sent().length, 6)
  const [award] = sent()
  assert.deepEqual(award.tags.filter((t) => t[0] === "e" || t[0] === "occasion"), [["e", ENDED], ["occasion", TOURNAMENT]])

  // Anna's device: the tournament's state says the organizer may award, so hers show.
  const stop = registerIssuerCheck("tournament", { mayIssue: async (id, issuer) => id === TOURNAMENT && issuer === organizer })
  try {
    const hers = await validAwards(relays[0].events, anna)
    assert.deepEqual(hers.map((a) => a.blueline?.badge).sort(), ["tournament-participant", "tournament-winner"])
    assert.equal(hers[0].name, hers[0].blueline?.badge)
  } finally {
    stop()
  }

  // Only who ended the tournament gives its badges.
  await assert.rejects(issueAwards(organizer, { ...herbstcup, ended: { ...herbstcup.ended, by: anna } }, texts), /only who ended/)
})

test("a correction: stale awards are withdrawn, the new ones given; a withdrawn award is gone for readers", async () => {
  await importLocalKey(organizerKey)
  await issueAwards(organizer, herbstcup, texts)
  await outboxTried()
  // The final's result was corrected: Ben won.
  const corrected: BadgeOccasion = { ...herbstcup, places: herbstcup.places.map((p) => (p.pubkey === anna ? { ...p, place: 2 } : p.pubkey === ben ? { ...p, place: 1 } : p)) }
  const plan = await currentPlan(organizer, corrected)
  assert.ok(plan)
  assert.deepEqual(pairs(plan.stale), pairs([{ badge: "tournament-winner", recipient: anna }, { badge: "tournament-finalist", recipient: ben }]))
  await withdrawAwards(organizer, plan.stale, "Ergebnis korrigiert")
  await outboxTried()
  assert.deepEqual(await issueAwards(organizer, corrected, texts), { given: 2, known: 4 })
  await outboxTried()
  const stop = registerIssuerCheck("tournament", { mayIssue: async () => true })
  try {
    const annas = await validAwards(relays[0].events, anna)
    assert.deepEqual(annas.map((a) => a.blueline?.badge).sort(), ["tournament-finalist", "tournament-participant"])
    const bens = await validAwards(relays[0].events, ben)
    assert.deepEqual(bens.map((a) => a.blueline?.badge).sort(), ["tournament-participant", "tournament-winner"])
  } finally {
    stop()
  }
})

test("a recognition: its own badge with the issuer's words as evidence, valid for its recipient", async () => {
  await importLocalKey(organizerKey)
  const award = await giveRecognition(organizer, carla, { name: "Helferin des Abends", description: "Hat den Clubabend möglich gemacht.", note: "Carla hat den ganzen Abend die Boards betreut." })
  await outboxTried()
  const [shown] = await validAwards(relays[1].events, carla)
  assert.equal(shown.award.id, award.id)
  assert.equal(shown.name, "Helferin des Abends")
  assert.equal(shown.blueline?.scope, "recognition")
  const evidence = relays[1].events.find((e) => e.id === shown.blueline?.evidence)
  assert.ok(evidence && evidence.kind === 1180 && JSON.parse(evidence.content).note.startsWith("Carla"))
})
