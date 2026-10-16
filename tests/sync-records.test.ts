import { before, test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { decodeEnvelope, recordSlot } from "../lib/protocol/private.ts"
import { decideMatch, mergePlayers, type HistoryRecord, type Version } from "../lib/sync/history.ts"
import { nextCreatedAt, openRecords, sealRecord } from "../lib/sync/records.ts"
import { newPlayerRecord, type PlayerRecord } from "../lib/storage/players.ts"

// Private records (lib/sync/records.ts) in the documented format, and which version of a record
// wins between devices (lib/sync/history.ts).

let core: Core
let secret: Uint8Array
let pubkey: string
const key = new Uint8Array(32).fill(9)
const NOW = 1_790_000_000

before(async () => {
  core = await loadCore()
  secret = core.generateSecretKey()
  pubkey = core.getPublicKey(secret)
})

const sign = (templates: ReturnType<typeof sealRecord>): NostrEvent[] => templates.map((t) => core.finalizeEvent(t, secret))
const head = (id: string, rev = 1, device = "0123456789abcdef") => ({ type: "match", id, rev, device, at: NOW })

test("a record is the documented envelope in its opaque slot, readable only with the data key", () => {
  const [event] = sign(sealRecord(head("match:abc"), { winner: "Anna" }, key, NOW))
  const slot = recordSlot(key, "match:abc")
  // d = HMAC-SHA256(data key, "blueline-record-v1:" + id), and nothing but the d tag.
  assert.equal(slot, createHmac("sha256", key).update("blueline-record-v1:match:abc").digest("hex"))
  assert.deepEqual(event.tags, [["d", slot]])
  assert.equal(event.kind, 30078)
  assert.ok(!event.content.includes("Anna"))
  // Independently decrypted: XChaCha20-Poly1305, associated data = the slot.
  const { nonce, ciphertext } = decodeEnvelope(event.content)
  const plain = JSON.parse(new TextDecoder().decode(xchacha20poly1305(key, nonce, new TextEncoder().encode(slot)).decrypt(ciphertext)))
  assert.deepEqual(plain, { v: 1, type: "match", id: "match:abc", rev: 1, device: "0123456789abcdef", at: NOW, data: { winner: "Anna" } })

  const opened = openRecords([event], key, pubkey)
  assert.deepEqual(opened.versions.get("match:abc")?.data, { winner: "Anna" })
  // Another key, another author: nothing.
  assert.equal(openRecords([event], new Uint8Array(32).fill(1), pubkey).versions.size, 0)
  assert.equal(openRecords([event], key, "f".repeat(64)).versions.size, 0)
})

test("large data is split into chained parts, any order, and a missing part makes it unreadable", () => {
  const data = { players: Array.from({ length: 800 }, (_, i) => ({ id: `p${i}`, name: `Spieler mit einem recht langen Namen ${i}` })) }
  const events = sign(sealRecord({ ...head("players"), type: "players" }, data, key, NOW))
  assert.ok(events.length > 2)
  assert.ok(events.every((e) => JSON.stringify(e).length < 32_768))
  assert.deepEqual(openRecords([...events].reverse(), key, pubkey).versions.get("players")?.data, data)
  const missing = openRecords(events.slice(0, -1), key, pubkey)
  assert.equal(missing.versions.size, 0)
  assert.equal(missing.unreadable, 1)
})

test("the newest version wins: higher counter, then higher device; a deletion is a version", () => {
  const v1 = sign(sealRecord(head("match:x", 1), { n: 1 }, key, NOW))
  const v2a = sign(sealRecord(head("match:x", 2, "aaaaaaaaaaaaaaaa"), { n: 2 }, key, NOW + 1))
  const v2b = sign(sealRecord(head("match:x", 2, "bbbbbbbbbbbbbbbb"), null, key, NOW + 1))
  const opened = openRecords([...v2b, ...v1, ...v2a], key, pubkey).versions.get("match:x")!
  assert.equal(opened.record.device, "bbbbbbbbbbbbbbbb")
  assert.equal(opened.data, null)
  assert.equal(opened.record.deleted, 1)
})

test("a record moved to another record's slot is not taken", () => {
  const [event] = sign(sealRecord(head("match:a"), { n: 1 }, key, NOW))
  const moved = core.finalizeEvent({ kind: 30078, tags: [["d", recordSlot(key, "match:b")]], content: event.content, created_at: NOW }, secret)
  assert.equal(openRecords([moved], key, pubkey).versions.size, 0)
})

// ---- Decisions ------------------------------------------------------------------------------

const record = (hash: string, source = "local"): HistoryRecord => ({ type: "match", data: { id: "g", source }, hash })
const version = (rev: number, hash: string, device = "aaaaaaaaaaaaaaaa", deleted = false): Version => ({ rev, device, deleted, hash })

test("a game found on relays comes in, and a newer version replaces this device's", () => {
  assert.equal(decideMatch(undefined, undefined, version(1, "h1")), "take")
  assert.equal(decideMatch(record("h1"), version(1, "h1"), version(2, "h2")), "take")
  // Deleted elsewhere, unchanged here: deleted here too.
  assert.equal(decideMatch(record("h1"), version(1, "h1"), version(2, "", "b", true)), "take")
})

test("a change made here since the last sync wins and becomes the next version", () => {
  assert.equal(decideMatch(record("h1"), undefined, undefined), "write")
  assert.equal(decideMatch(record("h2"), version(1, "h1"), version(1, "h1")), "write")
  // Corrected here, deleted elsewhere: the correction stays.
  assert.equal(decideMatch(record("h2"), version(1, "h1"), version(2, "", "b", true)), "write")
  // Deleted here: a tombstone, even over a newer version from elsewhere.
  assert.equal(decideMatch("deleted", version(1, "h1"), undefined), "write")
  assert.equal(decideMatch("deleted", version(1, "h1"), version(2, "h2")), "write")
  assert.equal(decideMatch("deleted", undefined, version(1, "h1")), "write")
  // Already the same everywhere: nothing.
  assert.equal(decideMatch(record("h1"), version(1, "h1"), version(1, "h1")), "keep")
  assert.equal(decideMatch("deleted", version(2, "", "a", true), version(1, "h1")), "keep")
  // A deletion no relay and no earlier sync knows of: nothing to delete anywhere.
  assert.equal(decideMatch("deleted", undefined, undefined), "keep")
})

test("a game synced here and gone without a deletion was removed from this device only", () => {
  // No tombstone (the Rangliste was reset), and no newer version brings it back here.
  assert.equal(decideMatch(undefined, version(1, "h1"), undefined), "keep")
  assert.equal(decideMatch(undefined, version(1, "h1"), version(1, "h1")), "keep")
  assert.equal(decideMatch(undefined, version(1, "h1"), version(2, "h2")), "keep")
  assert.equal(decideMatch(undefined, version(1, "h1"), version(2, "", "b", true)), "keep")
  // Never here at all: a game from elsewhere comes in.
  assert.equal(decideMatch(undefined, undefined, version(1, "h1")), "take")
})

test("an old copy never brings back a deleted game, and imported totals never undo a deletion", () => {
  assert.equal(decideMatch(undefined, version(2, "", "a", true), version(1, "h1")), "keep")
  assert.equal(decideMatch(record("h1", "imported-v1"), version(2, "", "a", true), version(2, "", "a", true)), "keep")
  assert.equal(decideMatch(record("h1", "imported-v1"), undefined, version(2, "", "a", true)), "take")
})

test("the full game wins over imported totals of it", () => {
  assert.equal(decideMatch(record("totals", "imported-v1"), undefined, { ...version(1, "full"), source: "local" }), "take")
  assert.equal(decideMatch(record("full"), undefined, { ...version(1, "totals"), source: "imported-v1" }), "write")
})

test("players merge entry by entry: the more recent change, played last at the later date", () => {
  const anna = (updatedAt: string, name: string, lastPlayedAt?: string): PlayerRecord => ({ ...newPlayerRecord(name, "2026-09-01T10:00:00.000Z", `pl_${"a".repeat(32)}`), updatedAt, ...(lastPlayedAt ? { lastPlayedAt } : {}) })
  const ben = newPlayerRecord("Ben", "2026-09-02T10:00:00.000Z", `pl_${"b".repeat(32)}`)
  const merged = mergePlayers([anna("2026-10-01T10:00:00.000Z", "Anna S.", "2026-10-03T10:00:00.000Z")], [anna("2026-10-02T10:00:00.000Z", "Anna Schmidt", "2026-10-01T10:00:00.000Z"), ben])
  assert.deepEqual(
    merged.map((p) => [p.name, p.lastPlayedAt]),
    [
      ["Anna Schmidt", "2026-10-03T10:00:00.000Z"],
      ["Ben", undefined],
    ],
  )
  // Order of arrival doesn't matter.
  assert.deepEqual(mergePlayers([anna("2026-10-02T10:00:00.000Z", "Anna Schmidt"), ben], [anna("2026-10-01T10:00:00.000Z", "Anna S.")]).map((p) => p.name), ["Anna Schmidt", "Ben"])
})

test("a new version's created_at stays above the one relays hold, as far ahead as they accept", () => {
  assert.equal(nextCreatedAt(NOW - 60, NOW - 100, NOW), NOW - 60)
  assert.equal(nextCreatedAt(NOW - 60, NOW + 10, NOW), NOW + 11)
  assert.equal(nextCreatedAt(NOW, NOW + 899, NOW), NOW + 900)
  assert.equal(nextCreatedAt(NOW, NOW + 900, NOW), null)
})
