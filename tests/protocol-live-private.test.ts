import { test } from "node:test"
import assert from "node:assert/strict"
import { xchacha20poly1305 } from "@noble/ciphers/chacha"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { applyThrow, newMatchState, replay, tagThrow } from "../lib/game/engine.ts"
import type { Throw } from "../lib/game/types.ts"
import { MAX_EVENT_BYTES } from "../lib/protocol/kinds.ts"
import { liveContent, liveThrows, MAX_LIVE_THROWS_BYTES } from "../lib/protocol/live.ts"
import { agreementToConfig, configToRules, ENGINE_VERSION } from "../lib/protocol/match.ts"
import {
  checkPrivateRecord,
  decodeEnvelope,
  encodeEnvelope,
  joinRecord,
  partId,
  privateTemplate,
  recordAad,
  recordSlot,
  splitRecord,
} from "../lib/protocol/private.ts"
import { buildRecord, parseRecord, sealTemplate } from "../lib/protocol/records.ts"
import { signedEventBytes } from "../lib/protocol/tags.ts"
import { decodeThrows } from "../lib/protocol/throws.ts"
import { drawOrder, seedCommitment } from "../lib/protocol/tournament.ts"
import { config, dart, play } from "./helpers.ts"

const NOW = 1760000000
const host = generateSecretKey()

function authEvent() {
  const c = config({ startScore: 501, legsToWin: 5, setsToWin: 4, players: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Spieler ${i + 1}` })) })
  const agreement = { engine: ENGINE_VERSION, rules: configToRules(c), seats: c.players.map((p) => ({ alias: p.name })), visibility: "public" as const }
  const session = finalizeEvent(buildRecord("match.session", { sv: 1, session: getPublicKey(host), from: NOW, until: NOW + 3600, agreement }, { created_at: NOW }), host)
  return { c, session }
}

// Six beginners, sets and legs: a match far longer than one snapshot's throw budget. Tagged
// the way the app tags throws, on one running state (play() replays per throw: too slow here).
function longMatch(c: ReturnType<typeof authEvent>["c"]) {
  const s = newMatchState(c)
  const log: Throw[] = []
  for (let i = 0; i < 15000; i++) {
    const t = tagThrow(s, dart(1 + (i % 5)))
    applyThrow(s, t)
    log.push(t)
  }
  return log
}

test("a snapshot of a short match carries the whole log and the engine's standing", () => {
  const { session } = authEvent()
  const c = config({ startScore: 301 })
  const log = play(c, [dart(20, 3), dart(20, 3), dart(20), dart(19), dart(19), dart(19)])
  const state = replay(c, log)
  const content = liveContent({ state, throws: log, sv: 1, n: 2, status: "playing", auth: session })
  assert.equal(content.from, 0)
  assert.deepEqual(decodeThrows(content.throws), JSON.parse(JSON.stringify(log)))
  assert.deepEqual(content.standing, { leg: 0, current: 0, scores: [161, 244], legs: [0, 0], winner: null })
  const t = buildRecord("match.live", content, { created_at: NOW, root: session.id, d: session.id })
  assert.ok(t.tags.some((x) => x[0] === "d" && x[1] === session.id))
  assert.throws(() => buildRecord("match.live", content, { created_at: NOW, root: session.id, d: "f".repeat(64) }), /d is its match id/)
})

test("a long match's snapshot stays inside the budget, also encrypted", () => {
  const { c, session } = authEvent()
  const log = longMatch(c)
  const state = replay(c, log)
  const { throws, from } = liveThrows(log, state.legIndex)
  assert.ok(from > 0, "only the end of the log fits")
  assert.ok(throws.length <= MAX_LIVE_THROWS_BYTES)
  assert.deepEqual(decodeThrows(throws), JSON.parse(JSON.stringify(log.slice(from))))
  const content = liveContent({ state, throws: log, sv: 1, n: 999, status: "playing", auth: session })
  const t = buildRecord("match.live", content, { created_at: NOW, root: session.id, d: session.id })
  assert.ok(signedEventBytes(t) <= MAX_EVENT_BYTES)
  // NIP-44 adds about a third; the sealed event still fits.
  const sealed = sealTemplate(t, getPublicKey(generateSecretKey()), "x".repeat(Math.ceil((t.content.length * 4) / 3) + 200))
  assert.ok(signedEventBytes(sealed) <= MAX_EVENT_BYTES)
  const e = finalizeEvent(t, host)
  assert.equal(parseRecord(e, { now: NOW }).status, "ok")
})

test("agreement and engine config convert both ways", () => {
  const { c } = authEvent()
  const back = agreementToConfig({ engine: 1, rules: configToRules(c), seats: c.players.map((p) => ({ alias: p.name })), visibility: "public" })
  assert.deepEqual({ ...back, players: back.players.map((p) => p.name) }, { ...c, doubleIn: false, startRule: "alternate", players: c.players.map((p) => p.name) })
})

test("private records: encrypted with the documented envelope, bound to their slot", () => {
  const key = new Uint8Array(32).fill(7)
  const record = checkPrivateRecord(JSON.stringify({ v: 1, type: "settings", id: "settings", rev: 3, device: "0123456789abcdef", at: NOW, data: { sound: true } }), "settings")
  const slot = recordSlot(key, record.id)
  const nonce = new Uint8Array(24).fill(1)
  const ciphertext = xchacha20poly1305(key, nonce, recordAad(slot)).encrypt(new TextEncoder().encode(JSON.stringify(record)))
  const event = finalizeEvent(privateTemplate(slot, encodeEnvelope(nonce, ciphertext), NOW), host)
  assert.deepEqual(event.tags, [["d", slot]])
  const env = decodeEnvelope(event.content)
  const plain = new TextDecoder().decode(xchacha20poly1305(key, env.nonce, recordAad(slot)).decrypt(env.ciphertext))
  assert.deepEqual(checkPrivateRecord(plain, "settings"), record)
  // Moved to another slot, the record does not decrypt.
  assert.throws(() => xchacha20poly1305(key, env.nonce, recordAad(recordSlot(key, "players"))).decrypt(env.ciphertext))
  assert.throws(() => checkPrivateRecord(plain, "players"), /another record's slot/)
  assert.throws(() => decodeEnvelope(Buffer.from([2, ...new Uint8Array(40)]).toString("base64")), /unknown_version/)
  assert.throws(() => checkPrivateRecord(JSON.stringify({ ...record, deleted: 1 })), /exactly one/)
})

test("private records: large data splits into chained parts and joins back", () => {
  const { c } = authEvent()
  const data = { config: c, throws: longMatch(c) }
  const { head, parts } = splitRecord({ v: 1, type: "match", id: "match:abc", rev: 1, device: "0123456789abcdef", at: NOW }, data)
  assert.ok(parts.length > 3)
  assert.ok(head.parts && !head.data)
  assert.deepEqual(joinRecord(head, [...parts].reverse()), JSON.parse(JSON.stringify(data)))
  assert.throws(() => joinRecord(head, parts.slice(1)), /missing/)
  const small = splitRecord({ v: 1, type: "settings", id: "settings", rev: 1, device: "0123456789abcdef", at: NOW }, { sound: false })
  assert.equal(small.parts.length, 0)
  assert.deepEqual(joinRecord(small.head, []), { sound: false })
  assert.notEqual(recordSlot(new Uint8Array(32), partId("match:abc", 1)), recordSlot(new Uint8Array(32), "match:abc"))
})

test("draw order: seeded players first, the rest by the seed, reproducible", () => {
  const seed = "9".repeat(64)
  const field = ["a".repeat(64), "b".repeat(64), "c".repeat(32), "d".repeat(64)]
  const once = drawOrder(seed, field)
  assert.deepEqual(drawOrder(seed, [...field].reverse()), once)
  assert.notDeepEqual(drawOrder("8".repeat(64), field), once)
  const seeded = drawOrder(seed, field, ["d".repeat(64), "x".repeat(64)])
  assert.equal(seeded[0], "d".repeat(64))
  assert.equal(seeded.length, 4)
  assert.equal(seedCommitment(seed).length, 64)
})
