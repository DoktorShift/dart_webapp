import { after, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { FakeNetwork } from "./support/fake-relay.ts"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { applyBadgeSection, buildBadgeSection } from "../lib/badges/export.ts"
import { validAwards } from "../lib/badges/awards.ts"
import { currentSelection } from "../lib/badges/selection.ts"
import { keepBadgeEvents, storedBadgeEvents } from "../lib/badges/store.ts"
import { relayClient } from "../lib/nostr/client.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { badgeAwardTemplate, badgeD, badgeDefinitionTemplate, profileBadgesTemplate } from "../lib/protocol/badges.ts"
import { importLocalKey, signOut } from "../lib/profile/session.ts"
import { registerExportSection } from "../lib/storage/export-sections.ts"
import { buildExport, importData } from "../lib/storage/data.ts"

// Badges go into the device's data file and come back from it (PLAN.md: "Badge-Daten, Auswahl,
// Aussteller und Nachweise gehören zum Export"), with every signature checked on the way in.

process.env.NEXT_PUBLIC_BLUELINE_RELAYS = "wss://one.example"
const network = new FakeNetwork()
network.add("wss://one.example")
Object.assign(globalThis, { WebSocket: network.WebSocket })

const playerKey = generateSecretKey()
const player = getPublicKey(playerKey)
const issuerKey = generateSecretKey()
const issuer = getPublicKey(issuerKey)
const d = badgeD({ badge: "tournament-winner", version: 1, scope: "tournament", scopeId: "1".repeat(64) })
const definition = finalizeEvent(badgeDefinitionTemplate({ badge: "tournament-winner", version: 1, scope: "tournament", scopeId: "1".repeat(64), name: "Turniersieg", description: "Gewonnen." }, 1_790_000_000), issuerKey) as NostrEvent
const award = finalizeEvent(badgeAwardTemplate({ issuer, d, recipient: player, evidence: "2".repeat(64), occasion: "1".repeat(64) }, 1_790_000_001), issuerKey) as NostrEvent
const list = finalizeEvent(profileBadgesTemplate([{ address: `30009:${issuer}:${d}`, award: award.id }], 1_790_000_002), playerKey) as NostrEvent

// What the badges area registers at start (components/badges/register.ts).
const stop = registerExportSection("badges", { build: buildBadgeSection, apply: applyBadgeSection })

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
})

after(() => {
  stop()
  relayClient().close()
})

test("the file carries every badge event of the device, and a fresh device takes them back in", async () => {
  await importLocalKey(playerKey)
  await keepBadgeEvents(player, [definition, award, list])
  const file = await buildExport()
  assert.deepEqual(
    (file.sections.badges as NostrEvent[]).map((e) => e.id).sort(),
    [definition.id, award.id, list.id].sort(),
  )

  await signOut({ keepLocalData: false })
  await resetStorage()
  await importLocalKey(playerKey)
  assert.deepEqual(await storedBadgeEvents(player), [])
  const result = await importData(JSON.stringify(file))
  assert.equal(result.ok, true)
  const stored = await storedBadgeEvents(player)
  assert.deepEqual(stored.map((e) => e.id).sort(), [definition.id, award.id, list.id].sort())
  assert.equal(currentSelection(stored, player).badges.length, 1)
  // Imported twice: still each once.
  await importData(JSON.stringify(file))
  assert.equal((await storedBadgeEvents(player)).length, 3)
})

test("a file with a forged or edited event brings only what is signed; nothing else of the import is lost", async () => {
  await importLocalKey(playerKey)
  const forged = { ...award, pubkey: player }
  const edited = { ...definition, tags: [...definition.tags, ["name", "Weltmeister"]] }
  const file = { ...(await buildExport()), sections: { badges: [forged, edited, award, definition, "junk", null] } }
  assert.equal((await importData(JSON.stringify(file))).ok, true)
  const stored = await storedBadgeEvents(player)
  assert.deepEqual(stored.map((e) => e.id).sort(), [award.id, definition.id].sort())
  assert.equal((await validAwards(stored, player)).length, 0, "a tournament badge shows only once its area confirms the issuer")
})
