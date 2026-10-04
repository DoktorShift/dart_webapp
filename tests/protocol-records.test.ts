import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { MAX_EVENT_BYTES } from "../lib/protocol/kinds.ts"
import { buildRecord, parseRecord, sealTemplate } from "../lib/protocol/records.ts"
import type { ContentOf } from "../lib/protocol/records.ts"
import { ProtocolError } from "../lib/protocol/reasons.ts"
import { signedEventBytes } from "../lib/protocol/tags.ts"

const sk = generateSecretKey()
const clubKey = getPublicKey(generateSecretKey())
const NOW = 1760000000
const ROOT = "a".repeat(64)
const sign = (t: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(t, sk)
const found: ContentOf<"club.found"> = { name: "Dartfreunde Nord", visibility: "public", key: clubKey }

const reason = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    return e instanceof ProtocolError ? e.reason : String(e)
  }
  return "no error"
}

const parsed = (event: unknown, opts: { now?: number; plaintext?: string } = {}) => {
  const r = parseRecord(event, { now: NOW, ...opts })
  return r.status === "invalid" ? r.reason : r.status
}

test("a founding carries the labels, version and alt text, and no root", () => {
  const t = buildRecord("club.found", found, { created_at: NOW })
  assert.equal(t.kind, 1501)
  assert.deepEqual(t.tags, [
    ["L", "blueline"],
    ["l", "club.found", "blueline"],
    ["v", "1"],
    ["alt", "BlueLine Darts club.found"],
  ])
  const e = sign(t)
  const r = parseRecord(e, { now: NOW })
  assert.equal(r.status, "ok")
  assert.ok(r.status === "ok" && r.record.type === "club.found" && r.record.root === e.id && r.record.content.name === "Dartfreunde Nord")
})

test("builders refuse what readers would refuse", () => {
  assert.equal(reason(() => buildRecord("club.found", { ...found, name: "" }, { created_at: NOW })), "invalid_content")
  assert.equal(reason(() => buildRecord("club.found", found, { created_at: NOW, root: ROOT })), "invalid_tags")
  assert.equal(reason(() => buildRecord("club.leave", {}, { created_at: NOW })), "invalid_tags")
  assert.equal(reason(() => buildRecord("club.role", { member: "x", role: "admin", prev: ROOT }, { created_at: NOW, root: ROOT })), "invalid_content")
  assert.equal(reason(() => buildRecord("club.join", { invite: "b".repeat(32) }, { created_at: NOW, root: ROOT })), "invalid_content")
  const wraps = Array.from({ length: 200 }, () => "w".repeat(1000))
  assert.equal(reason(() => buildRecord("club.key", { epoch: 1, key: clubKey, wraps }, { created_at: NOW, root: ROOT })), "too_large")
  assert.equal(reason(() => buildRecord("club.update", { prev: ROOT }, { created_at: NOW, root: ROOT })), "invalid_content")
})

test("a stake is only written into a private match, and a private match only encrypted", () => {
  const agreement: NonNullable<ContentOf<"match.session">["agreement"]> = {
    engine: 1,
    rules: { type: "x01", modeId: "501", startScore: 501, doubleIn: false, doubleOut: true, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate" },
    seats: [{ alias: "Mia" }, { alias: "Gast 2" }],
    visibility: "public",
  }
  const session = { sv: 1, session: clubKey, from: NOW, until: NOW + 3600, agreement: { ...agreement, stake: { msat: 1000 } } }
  assert.equal(reason(() => buildRecord("match.session", session, { created_at: NOW })), "stake_requires_private")
  const priv = buildRecord("match.session", { ...session, agreement: { ...session.agreement, visibility: "private" as const } }, { created_at: NOW })
  // Signed without sealing: readers refuse the private agreement in the clear.
  assert.equal(parsed(sign(priv)), "invalid_content")
  const sealed = sign(sealTemplate(priv, clubKey, "ciphertext"))
  assert.equal(parsed(sealed), "sealed")
  assert.equal(parsed(sealed, { plaintext: priv.content }), "ok")
})

test("the live snapshot's d is its match id", () => {
  assert.equal(reason(() => buildRecord("match.live", {} as never, { created_at: NOW, root: ROOT })), "invalid_content")
})

test("readers say exactly why an event is not a usable BlueLine record", () => {
  const ok = buildRecord("club.leave", {}, { created_at: NOW, root: ROOT })
  assert.equal(parsed(sign(ok)), "ok")
  assert.equal(parsed({ ...sign(ok), sig: "zz" }), "invalid_event")
  assert.equal(parsed(sign({ ...ok, kind: 1 })), "wrong_kind")
  assert.equal(parsed(sign({ ...ok, tags: ok.tags.filter((t) => t[0] !== "L") })), "not_blueline")
  assert.equal(parsed(sign({ ...ok, tags: [...ok.tags, ["l", "club.join", "blueline"]] })), "not_blueline")
  assert.equal(parsed(sign({ ...ok, tags: ok.tags.map((t) => (t[0] === "v" ? ["v", "2"] : t)) })), "unknown")
  assert.equal(parsed(sign({ ...ok, tags: ok.tags.map((t) => (t[0] === "l" ? ["l", "club.party", "blueline"] : t)) })), "unknown")
  assert.equal(parsed(sign({ ...ok, tags: [...ok.tags, ["x", "y".repeat(1025)]] })), "tag_too_long")
  assert.equal(parsed(sign({ ...ok, created_at: NOW + 901 })), "future_timestamp")
  assert.equal(parsed(sign({ ...ok, created_at: NOW + 900 })), "ok")
  assert.equal(parsed(sign({ ...ok, tags: [...ok.tags, ["e", "b".repeat(64)]] })), "invalid_tags")
  assert.equal(parsed(sign({ ...ok, tags: ok.tags.filter((t) => t[0] !== "e") })), "invalid_tags")
  assert.equal(parsed(sign({ ...ok, content: "not json" })), "invalid_content")
  assert.equal(parsed(sign({ ...ok, content: "[]" })), "invalid_content")
  assert.equal(parsed(sign({ ...ok, tags: [...ok.tags, ["enc", "nip44"]] })), "invalid_tags")
  assert.equal(parsed(sign({ ...ok, content: "x".repeat(MAX_EVENT_BYTES) })), "too_large")
})

test("unknown fields of a known version are ignored, not fatal", () => {
  const t = buildRecord("club.leave", {}, { created_at: NOW, root: ROOT })
  const r = parseRecord(sign({ ...t, content: JSON.stringify({ message: "Tschüss", mood: "gut" }) }), { now: NOW })
  assert.ok(r.status === "ok" && r.record.type === "club.leave")
  assert.deepEqual(r.status === "ok" && r.record.content, { message: "Tschüss" })
})

test("encryption rules per type", () => {
  const invite = buildRecord("club.invite", { invite: "c".repeat(32), token: "d".repeat(32), maxUses: 3, expires: NOW + 60 }, { created_at: NOW, root: ROOT })
  // An invite in the clear would publish its token.
  assert.equal(parsed(sign(invite)), "invalid_content")
  const key = buildRecord("club.key", { epoch: 1, key: clubKey, wraps: [] }, { created_at: NOW, root: ROOT })
  assert.equal(reason(() => sealTemplate(key, clubKey, "x")), "invalid_tags")
  assert.equal(parsed(sign({ ...key, tags: [...key.tags, ["enc", "nip44", clubKey]] })), "invalid_tags")
  assert.equal(reason(() => sealTemplate(invite, "nope", "x")), "invalid_tags")
  assert.equal(reason(() => sealTemplate({ ...invite, content: "x".repeat(20481) }, clubKey, "x")), "too_large")
})

test("payment requests never travel as plain records", () => {
  const t = {
    kind: 1501,
    created_at: NOW,
    tags: [
      ["L", "blueline"],
      ["l", "payment.request", "blueline"],
      ["v", "1"],
      ["e", ROOT],
    ],
    content: "{}",
  }
  assert.equal(parsed(sign(t)), "wrong_kind")
})

test("size is measured as the signed event a relay receives", () => {
  const t = buildRecord("club.leave", {}, { created_at: NOW, root: ROOT })
  assert.equal(signedEventBytes(t), JSON.stringify(sign(t)).length)
})
