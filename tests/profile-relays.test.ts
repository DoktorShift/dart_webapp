import { test } from "node:test"
import assert from "node:assert/strict"
import { generalRelays, profileRelays } from "../lib/nostr/relays.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { addRelay, editableRelays, newRelayList, ownReadRelays, publishTargets, relayListTemplate, relaySettings, removeRelay } from "../lib/profile/relay-list.ts"

// NIP-65 (kind 10002) and blocked relays (10006): where a profile's events go, and editing the
// list without losing what other apps wrote (PLAN.md "Start Relays und NIP 65", P3a.03).

const list = (kind: number, tags: string[][], created_at = 1_790_000_000): NostrEvent => ({
  id: "e".repeat(64),
  pubkey: "a".repeat(64),
  created_at,
  kind,
  tags,
  content: "",
  sig: "f".repeat(128),
})

test("a new profile lists the four general relays for reading and writing, never purplepag.es", () => {
  const entries = newRelayList()
  assert.deepEqual(
    entries.map((e) => e.url),
    ["wss://nos.lol", "wss://relay.primal.net", "wss://nostr-01.yakihonne.com", "wss://nostr.oxtr.dev"],
  )
  assert.ok(entries.every((e) => e.read && e.write))
  const template = relayListTemplate(entries)
  assert.equal(template.kind, 10002)
  assert.deepEqual(template.tags, entries.map((e) => ["r", e.url]))
})

test("profile kinds go to the five profile relays, everything else to the general ones, plus own write relays", () => {
  const settings = relaySettings(list(10002, [["r", "wss://mine.example"], ["r", "wss://readonly.example", "read"]]))
  assert.deepEqual(publishTargets(0, settings), [...profileRelays(), "wss://mine.example"])
  assert.deepEqual(publishTargets(10002, settings), [...profileRelays(), "wss://mine.example"])
  assert.deepEqual(publishTargets(31180, settings), [...generalRelays(), "wss://mine.example"])
  assert.deepEqual(publishTargets(30000, settings), [...generalRelays(), "wss://mine.example"])
  assert.ok(profileRelays().includes("wss://purplepag.es"))
  assert.ok(!publishTargets(30000, settings).includes("wss://purplepag.es"))
})

test("blocked relays (kind 10006) are never written to or read from", () => {
  const settings = relaySettings(list(10002, [["r", "wss://mine.example"]]), list(10006, [["relay", "wss://nos.lol"], ["relay", "wss://mine.example/"]]))
  assert.deepEqual(settings.blocked, ["wss://nos.lol", "wss://mine.example"])
  for (const kind of [0, 10002, 31180]) {
    assert.ok(!publishTargets(kind, settings).includes("wss://nos.lol"))
    assert.ok(!publishTargets(kind, settings).includes("wss://mine.example"))
  }
  assert.ok(!ownReadRelays(settings).includes("wss://nos.lol"))
})

test("editing keeps unknown tags and entries this app can't use; same relay twice becomes one", () => {
  const base = list(10002, [
    ["r", "wss://nos.lol", "read"],
    ["r", "wss://nos.lol/", "write"],
    ["r", "ws://192.168.1.20:7777"],
    ["r", "wss://odd.example", "sometimes"],
    ["client", "other-app"],
  ])
  const entries = editableRelays(base)
  assert.deepEqual(entries, [{ url: "wss://nos.lol", read: true, write: true }])
  const added = addRelay(entries, "relay.example.org")
  assert.deepEqual(added, [...entries, { url: "wss://relay.example.org", read: true, write: true }])
  const template = relayListTemplate(added!, base)
  assert.deepEqual(template.tags, [
    ["r", "wss://nos.lol"],
    ["r", "wss://relay.example.org"],
    ["r", "ws://192.168.1.20:7777"],
    ["r", "wss://odd.example", "sometimes"],
    ["client", "other-app"],
  ])
  assert.ok(template.created_at > base.created_at)
  const removed = relayListTemplate(removeRelay(added!, "wss://nos.lol"), base)
  assert.deepEqual(removed.tags.filter((t) => t[0] === "r").map((t) => t[1]), ["wss://relay.example.org", "ws://192.168.1.20:7777", "wss://odd.example"])
})

test("only real relay addresses can be added, and adding one twice changes nothing", () => {
  const entries = newRelayList()
  assert.equal(addRelay(entries, "http://relay.example"), null)
  assert.equal(addRelay(entries, "ws://relay.example"), null)
  assert.equal(addRelay(entries, "not a relay"), null)
  assert.deepEqual(addRelay(entries, "wss://NOS.lol/"), entries)
})

test("without a relay list of its own, a profile is edited from the app's relays", () => {
  assert.deepEqual(editableRelays(null), newRelayList())
  assert.equal(relaySettings(null).listed, false)
  assert.deepEqual(ownReadRelays(relaySettings(null)), [...profileRelays(), ...generalRelays().filter((u) => !profileRelays().includes(u))])
})
