import { test } from "node:test"
import assert from "node:assert/strict"
import { countOperators, defaultRelays, generalRelays, isPublished, mergeRelays, normalizeRelayUrl, operatorOf, profileRelays } from "../lib/nostr/relays.ts"

test("catalog: profile relays are the five of decision 0002, general relays the first four", () => {
  delete process.env.NEXT_PUBLIC_BLUELINE_RELAYS
  assert.deepEqual(profileRelays(), ["wss://nos.lol", "wss://relay.primal.net", "wss://nostr-01.yakihonne.com", "wss://nostr.oxtr.dev", "wss://purplepag.es"])
  assert.deepEqual(generalRelays(), ["wss://nos.lol", "wss://relay.primal.net", "wss://nostr-01.yakihonne.com", "wss://nostr.oxtr.dev"])
  assert.ok(!generalRelays().includes("wss://purplepag.es"))
})

test("catalog: the build variable replaces every default relay in both roles", () => {
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = " ws://localhost:10547 , ws://127.0.0.1:10548/,wss://not a url, ws://localhost:10547"
  try {
    assert.deepEqual(defaultRelays("profile"), ["ws://localhost:10547", "ws://127.0.0.1:10548"])
    assert.deepEqual(defaultRelays("general"), ["ws://localhost:10547", "ws://127.0.0.1:10548"])
  } finally {
    delete process.env.NEXT_PUBLIC_BLUELINE_RELAYS
  }
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = "nonsense://x"
  try {
    assert.equal(generalRelays().length, 4)
  } finally {
    delete process.env.NEXT_PUBLIC_BLUELINE_RELAYS
  }
})

test("relay addresses: one spelling per relay; only wss, and ws only for this machine", () => {
  assert.equal(normalizeRelayUrl("wss://Nos.LOL/"), "wss://nos.lol")
  assert.equal(normalizeRelayUrl("nos.lol"), "wss://nos.lol")
  assert.equal(normalizeRelayUrl("wss://relay.example:443//inbox/"), "wss://relay.example/inbox")
  assert.equal(normalizeRelayUrl("wss://relay.example:7777"), "wss://relay.example:7777")
  assert.equal(normalizeRelayUrl("ws://localhost:10547"), "ws://localhost:10547")
  assert.equal(normalizeRelayUrl("ws://relay.example"), null)
  assert.equal(normalizeRelayUrl("https://relay.example"), null)
  assert.equal(normalizeRelayUrl("wss://user:pass@relay.example"), null)
  assert.equal(normalizeRelayUrl("wss://relay.example/?a=1#x"), "wss://relay.example")
  assert.equal(normalizeRelayUrl(""), null)
  assert.equal(normalizeRelayUrl("not a url at all"), null)
})

test("operators: nos.lol and nostr.mom are one operator; unknown relays group by domain", () => {
  assert.equal(operatorOf("wss://nos.lol"), operatorOf("wss://nostr.mom"))
  assert.equal(countOperators(["wss://nos.lol", "wss://nostr.mom"]), 1)
  assert.equal(countOperators(["wss://nos.lol", "wss://relay.primal.net"]), 2)
  assert.equal(operatorOf("wss://a.relay.example"), operatorOf("wss://b.relay.example"))
  assert.notEqual(operatorOf("ws://localhost:1"), operatorOf("ws://localhost:2"))
})

test("published: two confirmations from different operators, not two from one", () => {
  assert.equal(isPublished(["wss://nos.lol"]), false)
  assert.equal(isPublished(["wss://nos.lol", "wss://nostr.mom"]), false)
  assert.equal(isPublished(["wss://nos.lol", "wss://nostr.oxtr.dev"]), true)
  assert.equal(isPublished([]), false)
})

test("merge: duplicates and invalid entries drop out, first spelling's order stays", () => {
  assert.deepEqual(mergeRelays(["wss://nos.lol/", "bad"], ["wss://NOS.lol", "wss://relay.damus.io"]), ["wss://nos.lol", "wss://relay.damus.io"])
})
