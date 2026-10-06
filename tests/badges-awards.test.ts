import { after, test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import type { EventTemplate, NostrEvent } from "../lib/nostr/types.ts"
import { registerIssuerCheck, validAwards } from "../lib/badges/awards.ts"
import { currentSelection, reordered, selectionTemplate, withBadge, withoutBadges } from "../lib/badges/selection.ts"
import { deletionTemplate } from "../lib/badges/store.ts"
import { badgeAwardTemplate, badgeD, badgeDefinitionTemplate, readProfileBadges } from "../lib/protocol/badges.ts"

// Received badges are checked before anything is shown, and the profile's list keeps what other
// apps put there (PLAN.md "Auszeichnungen", A23, A24).

const [organizer, player, mallory, otherApp] = [generateSecretKey(), generateSecretKey(), generateSecretKey(), generateSecretKey()]
const pub = (secret: Uint8Array) => getPublicKey(secret)
const sign = (template: EventTemplate, secret: Uint8Array) => finalizeEvent(template, secret) as NostrEvent
const T = 1_790_000_000
const TOURNAMENT = "1".repeat(64)
const RESULT = "2".repeat(64)

const d = badgeD({ badge: "tournament-winner", version: 1, scope: "tournament", scopeId: TOURNAMENT })
const definition = sign(badgeDefinitionTemplate({ badge: "tournament-winner", version: 1, scope: "tournament", scopeId: TOURNAMENT, name: "Turniersieg", description: "Hat den Herbstcup gewonnen." }, T), organizer)
const award = (secret: Uint8Array, at = T + 10, issuer = pub(organizer)) =>
  sign(badgeAwardTemplate({ issuer, d, recipient: pub(player), evidence: RESULT, occasion: TOURNAMENT }, at), secret)

let stopCheck: () => void = () => {}
after(() => stopCheck())

test("a club or tournament badge shows only once its area confirms the issuer", async () => {
  const given = award(organizer)
  // Nobody can tell yet who may award this tournament's badges: not shown.
  assert.deepEqual(await validAwards([definition, given], pub(player)), [])
  stopCheck = registerIssuerCheck("tournament", {
    mayIssue: async (id, issuer) => id === TOURNAMENT && issuer === pub(organizer),
    evidenceValid: async (_id, evidence) => (evidence === RESULT ? true : undefined),
  })
  const [shown] = await validAwards([definition, given], pub(player))
  assert.equal(shown.award.id, given.id)
  assert.equal(shown.name, "Turniersieg")
  assert.deepEqual(shown.blueline, { scope: "tournament", scopeId: TOURNAMENT, badge: "tournament-winner", version: 1, evidence: RESULT, occasion: TOURNAMENT })
  assert.equal(shown.voided, false)
})

test("forged awards are not shown", async () => {
  // Mallory signs an award pointing at the organizer's badge (nostr-core 1.0.4 would accept it).
  const forged = award(mallory)
  // A real award with a changed recipient: its signature no longer fits.
  const tampered = { ...award(organizer), tags: [...award(organizer).tags.filter((t) => t[0] !== "p"), ["p", pub(mallory)]] }
  // Mallory's own definition under the same d, and an award for it: issuer not confirmed.
  const own = sign({ kind: definition.kind, created_at: T, content: "", tags: definition.tags }, mallory)
  const fromMallory = sign(badgeAwardTemplate({ issuer: pub(mallory), d, recipient: pub(player), evidence: RESULT, occasion: TOURNAMENT }, T + 11), mallory)
  assert.deepEqual(await validAwards([definition, forged, own, fromMallory], pub(player)), [])
  assert.deepEqual(await validAwards([definition, tampered], pub(mallory)), [])
  // An award to someone else is not this player's.
  assert.deepEqual(await validAwards([definition, award(organizer)], pub(mallory)), [])
})

test("the same badge for the same occasion counts once, however often it arrives", async () => {
  const first = award(organizer, T + 10)
  const resent = award(organizer, T + 20)
  const shown = await validAwards([resent, definition, first, first, definition, resent], pub(player))
  assert.deepEqual(shown.map((a) => a.award.id), [first.id])
})

test("a deletion request of the issuer takes the award back; anyone else's does nothing", async () => {
  const given = award(organizer)
  const byMallory = sign(deletionTemplate([given], "", T + 30), mallory)
  assert.equal((await validAwards([definition, given, byMallory], pub(player))).length, 1)
  const byIssuer = sign(deletionTemplate([given], "Ergebnis korrigiert", T + 30), organizer)
  assert.deepEqual(await validAwards([definition, given, byIssuer], pub(player)), [])
})

test("a voided result is marked, not hidden", async () => {
  stopCheck()
  stopCheck = registerIssuerCheck("tournament", { mayIssue: async () => true, evidenceValid: async () => false })
  const [shown] = await validAwards([definition, award(organizer)], pub(player))
  assert.equal(shown.voided, true)
})

test("another app's badge passes the generic checks and is shown as theirs", async () => {
  const theirs = sign({ kind: 30009, created_at: T, content: "", tags: [["d", "early-adopter"], ["name", "Early Adopter"], ["image", "https://img.example/badge.png"]] }, otherApp)
  const given = sign({ kind: 8, created_at: T + 1, content: "", tags: [["a", `30009:${pub(otherApp)}:early-adopter`], ["p", pub(player)], ["p", pub(mallory)]] }, otherApp)
  const [shown] = await validAwards([theirs, given], pub(player))
  assert.equal(shown.blueline, null)
  assert.equal(shown.name, "Early Adopter")
  assert.equal(shown.image, "https://img.example/badge.png")
  assert.equal(shown.issuer, pub(otherApp))
})

test("the former profile list is read and written as the current one, keeping what other apps put there", () => {
  const foreignAward = "3".repeat(64)
  const blueAward = "4".repeat(64)
  const otherAddress = `30009:${pub(otherApp)}:early-adopter`
  const ours = `30009:${pub(player)}:${badgeD({ badge: "first-180", version: 1, scope: "self" })}`
  // Written by another app in the former format: a badge with relay hints, an "a" without its
  // "e", a badge set and a tag nobody knows.
  const legacy = sign(
    {
      kind: 30008,
      created_at: T,
      content: "",
      tags: [["d", "profile_badges"], ["a", otherAddress, "wss://their.example"], ["e", foreignAward, "wss://their.example"], ["a", `30008:${pub(otherApp)}:set`], ["client", "other"]],
    },
    player,
  )
  const selection = currentSelection([legacy], pub(player))
  assert.deepEqual(selection.badges, [{ address: otherAddress, award: foreignAward, addressRelay: "wss://their.example", awardRelay: "wss://their.example" }])
  const shown = sign(selectionTemplate(selection, withBadge(selection, { address: ours, award: blueAward })), player)
  assert.equal(shown.kind, 10008)
  assert.ok(shown.created_at > legacy.created_at)
  assert.deepEqual(shown.tags, [
    ["a", ours],
    ["e", blueAward],
    ["a", otherAddress, "wss://their.example"],
    ["e", foreignAward, "wss://their.example"],
    ["a", `30008:${pub(otherApp)}:set`],
    ["client", "other"],
  ])
  // Once there is a current list, it is the one that counts.
  const next = currentSelection([legacy, shown], pub(player))
  assert.equal(next.base?.id, shown.id)
  // Hiding ours leaves everything else as it was.
  const hidden = sign(selectionTemplate(next, withoutBadges(next, [blueAward])), player)
  assert.deepEqual(readProfileBadges(hidden), selection.badges)
  assert.deepEqual(hidden.tags.slice(2), [["a", `30008:${pub(otherApp)}:set`], ["client", "other"]])
})

test("arranging moves only the badges arranged; other entries keep their places", () => {
  const [a, b, c, x] = ["a", "b", "c", "f"].map((ch) => ({ address: `30009:${"9".repeat(64)}:${ch}`, award: ch.repeat(64) }))
  const selection = { badges: [a, x, b, c], other: [], base: null }
  assert.deepEqual(reordered(selection, [c.award, a.award, b.award]), [c, x, a, b])
  // Unknown ids are ignored.
  assert.deepEqual(reordered(selection, ["0".repeat(64), b.award, a.award]), [b, x, a, c])
})
