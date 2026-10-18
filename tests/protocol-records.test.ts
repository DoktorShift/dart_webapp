import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { KIND_RECORD, MAX_EVENT_BYTES } from "../lib/protocol/kinds.ts"
import { MAX_SHARED_KEYS } from "../lib/protocol/club.ts"
import { buildRecord, encryptForLinkKey, maxSharedKeys, parseRecord, sealRecord } from "../lib/protocol/records.ts"
import type { ContentOf } from "../lib/protocol/records.ts"
import { ProtocolError } from "../lib/protocol/reasons.ts"
import { signedEventBytes } from "../lib/protocol/tags.ts"
import { otherProfileTags, profileBadgesTemplate, readProfileBadges } from "../lib/protocol/badges.ts"
import { MAX_SEAL_READERS } from "../lib/protocol/seal.ts"

const sk = generateSecretKey()
const otherKey = getPublicKey(generateSecretKey())
const NOW = 1760000000
const ROOT = "a".repeat(64)
const sign = (t: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(t, sk)
const found: ContentOf<"club.found"> = { name: "Dartfreunde Nord", visibility: "public" }
// Shape-valid stand-ins for NIP-44 payloads; the cipher is tested in protocol-seal.test.ts.
const fakeWrap = (i: number) => `A${String(i).padStart(3, "0")}${"B".repeat(172)}`
const seal = (n = 1) => ({ key: new Uint8Array(32).fill(7), nonce: new Uint8Array(24).fill(9), wraps: Array.from({ length: n }, (_, i) => ({ reader: getPublicKey(generateSecretKey()), payload: fakeWrap(i) })) })

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
  assert.equal(t.kind, 1180)
  assert.equal(t.kind, KIND_RECORD)
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
  assert.ok(r.status === "ok" && r.record.encryption === "none" && r.record.linkKey === null)
})

test("builders refuse what readers would refuse", () => {
  assert.equal(reason(() => buildRecord("club.found", { ...found, name: "" }, { created_at: NOW })), "invalid_content")
  assert.equal(reason(() => buildRecord("club.found", found, { created_at: NOW, root: ROOT })), "invalid_tags")
  assert.equal(reason(() => buildRecord("club.leave", {}, { created_at: NOW })), "invalid_tags")
  assert.equal(reason(() => buildRecord("club.role", { member: "x", role: "admin", prev: ROOT }, { created_at: NOW, root: ROOT })), "invalid_content")
  assert.equal(reason(() => buildRecord("club.join", { invite: "b".repeat(64) }, { created_at: NOW, root: ROOT })), "invalid_content")
  assert.equal(reason(() => buildRecord("club.update", { prev: ROOT }, { created_at: NOW, root: ROOT })), "invalid_content")
  assert.equal(reason(() => buildRecord("club.date", { date: "c".repeat(32), title: "Clubabend", starts: NOW + 10, ends: NOW, prev: ROOT }, { created_at: NOW, root: ROOT })), "invalid_content")
  const keys = Array.from({ length: 151 }, () => ["b".repeat(64), "c".repeat(64)])
  assert.equal(reason(() => buildRecord("club.keys", { keys }, { created_at: NOW, root: ROOT })), "invalid_content")
})

test("a stake is only written into a private match, and a private match only encrypted", () => {
  const agreement: NonNullable<ContentOf<"match.session">["agreement"]> = {
    engine: 1,
    rules: { type: "x01", modeId: "501", startScore: 501, doubleIn: false, doubleOut: true, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate" },
    seats: [{ alias: "Mia" }, { alias: "Gast 2" }],
    visibility: "public",
  }
  const session = { sv: 1, session: otherKey, from: NOW, until: NOW + 3600, agreement: { ...agreement, stake: { msat: 1000 } } }
  assert.equal(reason(() => buildRecord("match.session", session, { created_at: NOW })), "stake_requires_private")
  const priv = buildRecord("match.session", { ...session, agreement: { ...session.agreement, visibility: "private" as const } }, { created_at: NOW })
  // Signed without encryption: readers refuse the private agreement in the clear.
  assert.equal(parsed(sign(priv)), "stake_requires_private")
  const noStake = buildRecord("match.session", { ...session, agreement: { ...agreement, visibility: "private" as const } }, { created_at: NOW })
  assert.equal(parsed(sign(noStake)), "sealing_required")
  const encrypted = sign(encryptForLinkKey(priv, otherKey, "ciphertext"))
  assert.equal(parsed(encrypted), "sealed")
  assert.equal(parsed(encrypted, { plaintext: priv.content }), "ok")
  // Matches are never sealed per reader; clubs never use a link key.
  assert.equal(reason(() => sealRecord(priv, seal())), "invalid_tags")
})

test("the live snapshot's d is its match id", () => {
  assert.equal(reason(() => buildRecord("match.live", {} as never, { created_at: NOW, root: ROOT })), "invalid_content")
})

test("readers say exactly why an event is not a usable BlueLine record", () => {
  const ok = buildRecord("club.leave", {}, { created_at: NOW, root: ROOT })
  assert.equal(parsed(sign(ok)), "ok")
  assert.equal(parsed({ ...sign(ok), sig: "zz" }), "invalid_event")
  assert.equal(parsed(sign({ ...ok, kind: 1 })), "wrong_kind")
  assert.equal(parsed(sign({ ...ok, kind: 1501 })), "wrong_kind")
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
  assert.equal(parsed(sign({ ...ok, tags: [...ok.tags, ["enc", "seal"], ["enc", "seal"]] })), "invalid_tags")
  assert.equal(parsed(sign({ ...ok, content: "x".repeat(MAX_EVENT_BYTES) })), "too_large")
})

test("unknown fields of a known version are ignored, not fatal", () => {
  const t = buildRecord("club.leave", {}, { created_at: NOW, root: ROOT })
  const r = parseRecord(sign({ ...t, content: JSON.stringify({ message: "Tschüss", mood: "gut" }) }), { now: NOW })
  assert.ok(r.status === "ok" && r.record.type === "club.leave")
  assert.deepEqual(r.status === "ok" && r.record.content, {})
})

test("encryption rules per type", () => {
  const invite = buildRecord("club.invite", { kind: "group", key: otherKey, expires: NOW + 60 }, { created_at: NOW, root: ROOT })
  // An invite names only the public invite key, never the token: a public club's invite travels
  // in the clear so everyone can check joins. A key share would publish its keys: always sealed.
  assert.equal(parsed(sign(invite)), "ok")
  const keys = buildRecord("club.keys", { keys: [["b".repeat(64), "c".repeat(64)]] }, { created_at: NOW, root: ROOT })
  assert.equal(parsed(sign(keys)), "sealing_required")
  // A join comes from someone who cannot know the readers: never sealed.
  const join = buildRecord("club.join", {}, { created_at: NOW, root: ROOT })
  assert.equal(reason(() => sealRecord(join, seal())), "invalid_tags")
  assert.equal(parsed(sign({ ...join, tags: [...join.tags, ["enc", "seal"]] })), "invalid_tags")
  // Clubs never use a link key.
  assert.equal(reason(() => encryptForLinkKey(invite, otherKey, "x")), "invalid_tags")
  assert.equal(parsed(sign({ ...keys, tags: [...keys.tags, ["enc", "nip44", otherKey]] })), "invalid_tags")
  // Only an invite carries a preview, and an invite always does.
  assert.equal(reason(() => sealRecord(keys, { ...seal(), preview: { key: new Uint8Array(32), nonce: new Uint8Array(24), content: { name: "X", host: otherKey, kind: "group", expires: NOW } } })), "invalid_content")
  assert.equal(reason(() => sealRecord(invite, seal())), "invalid_content")
  assert.equal(reason(() => sealRecord({ ...keys, content: "x".repeat(20481) }, seal())), "too_large")
  // Every wrap costs room: a hundred readers fit, a sealed record for more does not exist.
  assert.equal(reason(() => sealRecord(keys, seal(101))), "too_large")
  assert.equal(parsed(sign(sealRecord(keys, seal(100)))), "sealed")
  assert.equal(reason(() => sealRecord(sealRecord(keys, seal()), seal())), "invalid_tags")
})

test("a sealed record parses without its key and says so; damaged envelopes are refused", () => {
  const season = buildRecord("club.season.end", { season: "e".repeat(32) }, { created_at: NOW, root: ROOT })
  const sealed = sealRecord(season, seal(2))
  const r = parseRecord(sign(sealed), { now: NOW })
  assert.ok(r.status === "sealed" && r.form === "seal" && r.type === "club.season.end")
  assert.equal(parsed(sign(sealed), { plaintext: season.content }), "ok")
  const envelope = JSON.parse(sealed.content)
  assert.equal(parsed(sign({ ...sealed, content: JSON.stringify({ ...envelope, v: 2 }) })), "unknown")
  assert.equal(parsed(sign({ ...sealed, content: JSON.stringify({ ...envelope, k: [] }) })), "invalid_content")
  assert.equal(parsed(sign({ ...sealed, content: JSON.stringify({ ...envelope, n: "AAAA" }) })), "invalid_content")
  assert.equal(parsed(sign({ ...sealed, content: JSON.stringify({ ...envelope, k: [["zz", fakeWrap(1)]] }) })), "invalid_content")
  assert.equal(parsed(sign({ ...sealed, content: JSON.stringify({ ...envelope, p: { n: envelope.n, c: envelope.c } }) })), "invalid_content")
  assert.equal(parsed(sign({ ...sealed, content: "{}" })), "invalid_content")
})

test("payment requests never travel as plain records", () => {
  const t = {
    kind: KIND_RECORD,
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

test("profile badge choice: written as 10008, the former 30008 still read", () => {
  const address = `30009:${otherKey}:blueline:self:first-180:v1`
  const award = "e".repeat(64)
  const t = profileBadgesTemplate([{ address, award }], NOW)
  assert.equal(t.kind, 10008)
  assert.deepEqual(readProfileBadges(sign(t)), [{ address, award }])
  const legacy = sign({ kind: 30008, created_at: NOW, content: "", tags: [["d", "profile_badges"], ["a", address], ["e", award], ["a", "nonsense"], ["e", award]] })
  assert.deepEqual(readProfileBadges(legacy), [{ address, award }])
  assert.equal(readProfileBadges(sign({ kind: 30008, created_at: NOW, content: "", tags: [["d", "other"]] })), null)
  assert.equal(reason(() => profileBadgesTemplate([{ address: "x", award }], NOW)), "invalid_content")
})

test("profile badge choice: reading and writing back keeps another app's relay hints and tags", () => {
  const ours = `30009:${otherKey}:blueline:self:first-180:v1`
  const theirs = `30009:${"c".repeat(64)}:bravery`
  const award = "e".repeat(64)
  const otherAward = "f".repeat(64)
  const written = sign({
    kind: 10008,
    created_at: NOW,
    content: "",
    tags: [
      ["a", theirs, "wss://relay.example"],
      ["e", otherAward, "wss://relay.example"],
      ["a", "30023:not-a-badge"],
      ["e", award],
      ["client", "other app"],
      ["a", ours],
    ],
  })
  const badges = readProfileBadges(written)
  assert.deepEqual(badges, [{ address: theirs, award: otherAward, addressRelay: "wss://relay.example", awardRelay: "wss://relay.example" }])
  const other = otherProfileTags(written)
  assert.deepEqual(other, [["a", "30023:not-a-badge"], ["e", award], ["client", "other app"], ["a", ours]])
  // Adding ours and writing back loses nothing of theirs.
  const back = sign(profileBadgesTemplate([...(badges ?? []), { address: ours, award }], NOW + 1, other ?? []))
  assert.deepEqual(readProfileBadges(back), [...(badges ?? []), { address: ours, award }])
  assert.deepEqual(otherProfileTags(back), other)
  assert.deepEqual(back.tags.slice(0, 2), written.tags.slice(0, 2))
  // The former list's d tag belongs to its kind and is not carried over.
  const legacy = sign({ kind: 30008, created_at: NOW, content: "", tags: [["d", "profile_badges"], ["a", ours], ["e", award]] })
  assert.deepEqual(otherProfileTags(legacy), [])
  assert.equal(otherProfileTags(sign({ kind: 1, created_at: NOW, content: "", tags: [] })), null)
})

test("a key share fits as many keys as its readers leave room for", () => {
  assert.equal(maxSharedKeys(1), MAX_SHARED_KEYS)
  assert.equal(maxSharedKeys(20), MAX_SHARED_KEYS)
  const fit = maxSharedKeys(MAX_SEAL_READERS)
  assert.ok(fit > 60 && fit < 75, `${fit} keys for ${MAX_SEAL_READERS} readers`)
  // Exactly that many seal for a hundred readers, even with a 64-character relay hint on the
  // root tag; one more does not.
  const relay = `wss://${"relay".repeat(11)}.de`
  assert.equal(relay.length, 64)
  const keys = (n: number) => buildRecord("club.keys", { keys: Array.from({ length: n }, () => ["b".repeat(64), "c".repeat(64)]) }, { created_at: NOW, root: ROOT, relay })
  assert.equal(parsed(sign(sealRecord(keys(fit), seal(MAX_SEAL_READERS)))), "sealed")
  assert.equal(reason(() => sealRecord(keys(fit + 1), seal(MAX_SEAL_READERS))), "too_large")
  // Fewer readers, more keys.
  assert.ok(maxSharedKeys(50) > fit && maxSharedKeys(50) < MAX_SHARED_KEYS)
  assert.throws(() => maxSharedKeys(MAX_SEAL_READERS + 1), RangeError)
})
