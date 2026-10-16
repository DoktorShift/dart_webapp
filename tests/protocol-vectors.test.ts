import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createHmac, hkdfSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { decodeBolt11, getPublicKey, nip44, verifyEvent } from "nostr-core"
import { schnorr } from "@noble/curves/secp256k1"
import type { NostrEvent } from "nostr-core"
import { replay } from "../lib/game/engine.ts"
import { checkBadgeAward, dedupeAwards } from "../lib/protocol/badges.ts"
import { checkClaim, checkJoin, decodeBoardLink, parseBoardEvent } from "../lib/protocol/board.ts"
import { decodeHandoffLink, parseHandoffEvent } from "../lib/protocol/handoff.ts"
import { assembleChunks, chunkData } from "../lib/protocol/chunks.ts"
import type { ClubRole } from "../lib/protocol/club.ts"
import { clubRoleAt, reduceClub } from "../lib/protocol/club-state.ts"
import { inviteKey, inviteProof, previewKey, readInvitePreview, verifyInviteProof } from "../lib/protocol/invite.ts"
import { decodeLinkPayload, parseLinkFragment } from "../lib/protocol/links.ts"
import { reduceMatch } from "../lib/protocol/match-state.ts"
import type { PairingSession } from "../lib/protocol/pairing.ts"
import {
  applyPairingMessage,
  checkAnnounce,
  confirmPairingHere,
  decodePairingCode,
  decodePairingLink,
  encodePairingCode,
  newPairingSession,
  packageSent,
  pairingCheckCode,
  pairingCodeKeys,
  parsePairingEvent,
} from "../lib/protocol/pairing.ts"
import { checkPaymentRequest } from "../lib/protocol/payment.ts"
import { dataKeySlot, decodeEnvelope, parsePrivateEvent, recordSlot } from "../lib/protocol/private.ts"
import type { ReplayLog } from "../lib/protocol/replay.ts"
import { openEnvelope, openSealedEvents, parseEnvelope, wrapsFor } from "../lib/protocol/seal.ts"
import type { SignedEvent } from "../lib/protocol/tags.ts"
import { decodeThrows, encodeThrows } from "../lib/protocol/throws.ts"
import { parseRecord, type BlueLineRecord } from "../lib/protocol/records.ts"
import { reduceTournament, waitingList } from "../lib/protocol/tournament-state.ts"
import { buildSchemas, buildVectors, serialize } from "./support/make-vectors.ts"

// The vectors in docs/protocol/vectors/ carry hand-written expectations; this file runs the
// implementation against them. Where a value follows from a documented rule (HMAC, HKDF,
// hashes), it is recomputed here with node:crypto as an independent implementation.

type Keys = Record<string, { secret: string; pubkey: string }>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Vector = any

const load = (name: string): Vector => JSON.parse(readFileSync(new URL(`../docs/protocol/vectors/${name}.json`, import.meta.url), "utf8"))
const hexBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"))
const decrypt = (secretHex: string, otherPubkey: string, payload: string) => nip44.decrypt(payload, nip44.getConversationKey(hexBytes(secretHex), otherPubkey))

// A key name from the vector's key table, or a raw id (guest ids, slots).
const idOf = (keys: Keys, name: string) => keys[name]?.pubkey ?? name

// What the case's reader can open: sealed records through their own wraps and key shares
// (openSealedEvents with NIP-44 by nostr-core), private matches with the link key. Every
// plaintext must be exactly the one the generator sealed.
async function opener(file: Vector, c: Vector): Promise<((e: SignedEvent) => string | null) | undefined> {
  if (c.linkKey) {
    const secret = file.keys[c.linkKey].secret
    return (event: SignedEvent) => {
      const plaintext = decrypt(secret, event.pubkey, event.content)
      assert.equal(plaintext, c.plaintexts[event.id], `plaintext of ${event.id}`)
      return plaintext
    }
  }
  if (!c.reader) return undefined
  const reader = file.keys[c.reader]
  const opened = await openSealedEvents(c.events, { reader: reader.pubkey, unwrap: async (author, payload) => decrypt(reader.secret, author, payload) })
  for (const [id, plaintext] of opened.plaintexts) assert.equal(plaintext, c.plaintexts[id], `${c.name}: plaintext of ${id}`)
  return (event: SignedEvent) => opened.plaintexts.get(event.id) ?? null
}

function checkLog(log: ReplayLog, c: Vector) {
  assert.deepEqual(
    log.applied.map((a) => a.id),
    c.expect.applied,
    `${c.name}: applied`,
  )
  const pairs = (xs: { id: string; reason?: string; why?: string }[]) => xs.map((x) => `${x.id} ${x.reason ?? x.why}`).sort()
  assert.deepEqual(pairs(log.rejected), pairs(c.expect.rejected ?? []), `${c.name}: rejected`)
  assert.deepEqual(pairs(log.unapplied), pairs(c.expect.unapplied ?? []), `${c.name}: unapplied`)
}

test("vectors and schemas on disk are exactly what the generator writes", () => {
  for (const [name, file] of Object.entries(buildVectors())) {
    assert.equal(readFileSync(new URL(`../docs/protocol/vectors/${name}.json`, import.meta.url), "utf8"), serialize(file), `vectors/${name}.json is stale: run node tests/support/make-vectors.ts`)
  }
  for (const [name, schema] of Object.entries(buildSchemas())) {
    assert.equal(readFileSync(new URL(`../docs/protocol/schemas/${name}.schema.json`, import.meta.url), "utf8"), serialize(schema), `schemas/${name}.schema.json is stale`)
  }
})

test("every signed vector event verifies with nostr-core and uses the BlueLine kinds", () => {
  let count = 0
  const kinds = new Set<number>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (typeof v !== "object" || v === null) return
    const e = v as Record<string, unknown>
    if (typeof e.sig === "string" && typeof e.id === "string" && typeof e.pubkey === "string") {
      assert.ok(verifyEvent({ ...(e as NostrEvent) }), `signature of ${e.id}`)
      kinds.add(e.kind as number)
      count++
    }
    Object.values(e).forEach(walk)
  }
  for (const name of ["club", "tournament", "match", "badges", "pairing", "board-join", "private-records", "seal"]) walk(load(name))
  assert.ok(count > 250, `${count} events`)
  assert.deepEqual([...kinds].sort((a, b) => a - b), [8, 1180, 21180, 30009, 30078, 31180])
})

test("vector key tables match their derivation", () => {
  for (const name of ["club", "tournament", "match", "badges", "pairing", "board-join", "seal"]) {
    for (const [label, k] of Object.entries(load(name).keys as Keys)) {
      assert.equal(k.secret, createHash("sha256").update(`blueline-vector:${label}`).digest("hex"))
    }
  }
})

test("club vectors", async () => {
  const file = load("club")
  const keys: Keys = file.keys
  for (const c of file.cases) {
    const result = reduceClub(c.events, c.root, { now: c.now, open: await opener(file, c) })
    if (c.expect.problem) {
      assert.equal(result.state, null, c.name)
      assert.equal((result as { problem: string }).problem, c.expect.problem, c.name)
      continue
    }
    assert.ok(result.state, `${c.name}: state`)
    const s = result.state
    checkLog(s.log, c)
    const want = c.expect.state ?? {}
    if (want.owner) assert.equal(s.owner, idOf(keys, want.owner), `${c.name}: owner`)
    if (want.members) {
      const expected = Object.fromEntries(Object.entries(want.members as Record<string, string>).map(([n, role]) => [idOf(keys, n), role]))
      assert.deepEqual(Object.fromEntries(Object.entries(s.members).map(([pk, m]) => [pk, m.role])), expected, `${c.name}: members`)
    }
    if (want.memberCount !== undefined) assert.equal(Object.keys(s.members).length, want.memberCount, `${c.name}: member count`)
    if (want.via) for (const [n, via] of Object.entries(want.via)) assert.equal(s.members[idOf(keys, n)]?.via, via, `${c.name}: via`)
    if (want.inviteUses) for (const [label, n] of Object.entries(want.inviteUses)) assert.equal(s.invites[c.labels[label]].uses.length, n, `${c.name}: uses`)
    if (want.requests)
      assert.deepEqual(
        Object.fromEntries(Object.values(s.requests).map((r) => [r.pubkey, r.check])),
        Object.fromEntries(Object.entries(want.requests as Record<string, string>).map(([n, check]) => [idOf(keys, n), check])),
        `${c.name}: requests`,
      )
    if (want.former) for (const [n, how] of Object.entries(want.former)) assert.equal(s.former[idOf(keys, n)]?.how, how, `${c.name}: former`)
    if (want.name) assert.equal(s.info.name, want.name, `${c.name}: name`)
    if (want.visibility) assert.equal(s.info.visibility, want.visibility, `${c.name}: visibility`)
    if (want.shares !== undefined) assert.equal(s.shares.length, want.shares, `${c.name}: shares`)
    if (want.seasons)
      for (const [id, season] of Object.entries(want.seasons as Record<string, { versions: number; ended: boolean }>)) {
        assert.equal(s.seasons[id].versions.length, season.versions, `${c.name}: season versions`)
        assert.equal(s.seasons[id].ended, season.ended, `${c.name}: season ended`)
      }
    if (want.results)
      for (const [season, matches] of Object.entries(want.results as Record<string, Record<string, boolean>>))
        for (const [match, count] of Object.entries(matches)) assert.equal(s.results[season][match].count, count, `${c.name}: result`)
    if (want.dates)
      for (const [id, d] of Object.entries(want.dates as Record<string, { starts: number; cancelled: boolean }>)) {
        assert.equal(s.dates[id].starts, d.starts, `${c.name}: date`)
        assert.equal(s.dates[id].cancelled, d.cancelled, `${c.name}: date cancelled`)
      }
    // Every member's role in the history matches the final state.
    for (const [pk, m] of Object.entries(s.members)) assert.equal(clubRoleAt(s, pk, c.now), m.role, `${c.name}: history of ${pk}`)
    for (const pk of Object.keys(s.former)) assert.equal(clubRoleAt(s, pk, c.now), null, `${c.name}: history of former ${pk}`)
    // A tournament founded for the club counts when its founder's role, as this reader sees the
    // club, allows it (tournament-state.ts clubRole).
    if (c.tournament) {
      const t = reduceTournament(c.tournament.events, c.tournament.root, { now: c.now, clubRole: (pk, at) => clubRoleAt(s, pk, at) })
      assert.ok(t.state, `${c.name}: club tournament`)
      assert.equal(t.state.organizer, idOf(keys, c.tournament.organizer), `${c.name}: club tournament organizer`)
      assert.deepEqual(t.state.club, { id: c.root, verified: true }, `${c.name}: club tournament club`)
    }
  }
})

test("club vectors: no invite token, label in the clear or reader's pubkey reaches a relay", () => {
  const file = load("club")
  const tokens = load("invite").cases.map((v: { token: string }) => v.token)
  let invites = 0
  for (const c of file.cases) {
    for (const e of c.events as SignedEvent[]) {
      for (const token of tokens) assert.ok(!JSON.stringify(e).includes(token), `${c.name}: token in ${e.id}`)
      const sealed = e.tags.some((t) => t[0] === "enc")
      if (e.tags.some((t) => t[0] === "l" && t[1] === "club.invite")) {
        invites++
        const content = JSON.parse(sealed ? c.plaintexts[e.id] : e.content)
        assert.equal(content.token, undefined, `${c.name}: invite ${e.id} carries a token`)
        assert.match(content.key, /^[0-9a-f]{64}$/)
        if (!sealed) assert.equal(content.label, undefined, `${c.name}: label in the clear`)
      }
      if (!sealed) continue
      for (const name of Object.keys(file.keys)) assert.ok(!e.content.includes(file.keys[name].pubkey), `${c.name}: ${name} named in a sealed envelope`)
    }
  }
  assert.ok(invites > 20)
})

test("invite vectors: invite keys, proofs and preview keys follow the documented derivations", () => {
  const cases = load("invite").cases
  for (const v of cases) {
    // HKDF and the message hash with node:crypto, the curve with nostr-core's own primitive.
    const secret = Buffer.from(hkdfSync("sha256", Buffer.from(v.token, "hex"), "blueline-invite-v1", "proof", 32))
    assert.equal(v.inviteKey, getPublicKey(Uint8Array.from(secret)))
    assert.equal(inviteKey(v.token), v.inviteKey)
    const message = createHash("sha256").update(`blueline-invite-v1:${v.pubkey}`).digest()
    assert.ok(schnorr.verify(hexBytes(v.proof), Uint8Array.from(message), hexBytes(v.inviteKey)))
    assert.equal(inviteProof(v.token, v.pubkey, new Uint8Array(32)), v.proof)
    assert.ok(verifyInviteProof(v.inviteKey, v.pubkey, v.proof))
    // Any auxiliary randomness gives another, equally valid proof.
    assert.ok(verifyInviteProof(v.inviteKey, v.pubkey, inviteProof(v.token, v.pubkey)))
    assert.ok(!verifyInviteProof(v.inviteKey, v.pubkey, v.proof.replace(/^./, (ch: string) => (ch === "0" ? "1" : "0"))))
    const hkdf = Buffer.from(hkdfSync("sha256", Buffer.from(v.token, "hex"), "blueline-invite-v1", "preview", 32)).toString("hex")
    assert.equal(v.previewKey, hkdf)
    assert.equal(Buffer.from(previewKey(v.token)).toString("hex"), hkdf)
  }
  // A proof is bound to its joiner and to its link.
  const [a, b, c] = cases
  assert.ok(!verifyInviteProof(a.inviteKey, b.pubkey, a.proof))
  assert.ok(!verifyInviteProof(c.inviteKey, a.pubkey, a.proof))
})

test("seal vectors: hints, wraps, content key and preview", () => {
  const v = load("seal")
  const s = v.sealed
  const env = parseEnvelope(s.event.content)
  assert.deepEqual(s.envelope, JSON.parse(s.event.content))
  assert.equal(Buffer.from(env.nonce).toString("hex"), s.nonce)
  for (const r of s.readers) {
    const hint = createHash("sha256")
      .update(Buffer.concat([Buffer.from("blueline-seal-hint-v1"), Buffer.from(s.nonce, "hex"), Buffer.from(r.pubkey, "hex")]))
      .digest()
      .subarray(0, 4)
      .toString("hex")
    assert.equal(r.hint, hint)
    const [payload] = wrapsFor(env, r.pubkey)
    assert.equal(decrypt(v.keys[r.name].secret, s.event.pubkey, payload), s.contentKey, `${r.name} unwraps the content key`)
  }
  assert.equal(openEnvelope(env, s.type, hexBytes(s.contentKey)), s.plaintext)
  const inviteEnv = parseEnvelope(v.invite.event.content)
  assert.deepEqual(readInvitePreview(inviteEnv, v.invite.token), v.invite.preview)
  assert.equal(Buffer.from(previewKey(v.invite.token)).toString("hex"), v.invite.previewKey)
})

test("tournament vectors", () => {
  const file = load("tournament")
  const keys: Keys = file.keys
  for (const c of file.cases) {
    const dependents = c.dependents ? (slot: string) => c.dependents[slot] ?? [] : undefined
    const roles = c.clubRoles ? new Map(Object.entries(c.clubRoles as Record<string, ClubRole>).map(([n, role]) => [idOf(keys, n), role])) : null
    const clubRole = roles ? (pubkey: string) => roles.get(pubkey) ?? null : undefined
    const result = reduceTournament(c.events, c.root, { now: c.now, dependents, clubRole })
    if (c.expect.problem) {
      assert.equal(result.state, null, c.name)
      assert.equal((result as { problem: string }).problem, c.expect.problem, c.name)
      continue
    }
    assert.ok(result.state, `${c.name}: state`)
    const s = result.state
    checkLog(s.log, c)
    const want = c.expect.state ?? {}
    if (want.phase) assert.equal(s.phase, want.phase, `${c.name}: phase`)
    if (want.organizer) assert.equal(s.organizer, idOf(keys, want.organizer), `${c.name}: organizer`)
    if (want.club) assert.deepEqual(s.club, want.club, `${c.name}: club`)
    if (want.participants)
      for (const [n, status] of Object.entries(want.participants)) assert.equal(s.participants[idOf(keys, n)]?.status, status, `${c.name}: ${n}`)
    if (want.late)
      assert.deepEqual(
        Object.values(s.participants)
          .filter((p) => p.late)
          .map((p) => p.id),
        want.late.map((n: string) => idOf(keys, n)),
        `${c.name}: late`,
      )
    if (want.waitlist)
      assert.deepEqual(
        waitingList(s).map((p) => p.id),
        want.waitlist.map((n: string) => idOf(keys, n)),
        `${c.name}: waiting list`,
      )
    if (want.named)
      assert.deepEqual(
        Object.values(s.participants)
          .filter((p) => p.named)
          .map((p) => p.id),
        want.named,
        `${c.name}: named guests`,
      )
    if (want.linked) for (const [g, n] of Object.entries(want.linked as Record<string, string>)) assert.equal(s.participants[g].player, idOf(keys, n), `${c.name}: link`)
    if (want.order) assert.deepEqual(s.draw?.order, want.order, `${c.name}: order`)
    if (want.checkedIn)
      assert.deepEqual(
        Object.values(s.participants)
          .filter((p) => p.checkedIn)
          .map((p) => p.id)
          .sort(),
        [...want.checkedIn].sort(),
        `${c.name}: checked in`,
      )
    if (want.place) assert.equal(s.settings.place, want.place)
    if (want.name) assert.equal(s.settings.name, want.name, `${c.name}: name`)
    if (want.slots)
      for (const [slot, w] of Object.entries(want.slots as Record<string, { winner?: string; corrected?: boolean; affected?: boolean; walkover?: string }>)) {
        if (w.winner !== undefined) assert.equal(s.slots[slot].approved?.winner, w.winner, `${c.name}: ${slot} winner`)
        if (w.corrected !== undefined) assert.equal(s.slots[slot].approved?.corrected, w.corrected, `${c.name}: ${slot} corrected`)
        if (w.walkover !== undefined) assert.equal(s.slots[slot].approved?.walkover, w.walkover, `${c.name}: ${slot} walkover`)
        if (w.affected !== undefined) assert.equal(s.slots[slot].affected, w.affected, `${c.name}: ${slot} affected`)
      }
    // The draw order follows from the seed by the engine's rule (recomputed independently).
    if (c.seed) {
      const key = (id: string) => createHash("sha256").update(`blueline-draw-v1\n${c.seed}\n${id}`).digest("hex")
      assert.deepEqual(
        s.draw?.order,
        [...c.field].sort((a: string, b: string) => (key(a) < key(b) ? -1 : 1)),
      )
      assert.equal(s.settings.seedCommit, createHash("sha256").update(`blueline-seed-v1\n${c.seed}`).digest("hex"))
    }
  }
})

test("match vectors", async () => {
  const file = load("match")
  const keys: Keys = file.keys
  for (const c of file.cases) {
    const result = reduceMatch(c.events, c.root, { now: c.now, open: await opener(file, c) })
    if (c.expect.problem) {
      assert.equal(result.state, null, c.name)
      assert.equal((result as { problem: string }).problem, c.expect.problem, c.name)
      continue
    }
    assert.ok(result.state, `${c.name}: state`)
    const s = result.state
    checkLog(s.log, c)
    const want = c.expect.state ?? {}
    if (want.sv) assert.equal(s.current.sv, want.sv, `${c.name}: sv`)
    if (want.writer) assert.equal(s.current.session, idOf(keys, want.writer), `${c.name}: writer`)
    if (want.live !== undefined) assert.equal(s.live?.event ?? null, want.live === null ? null : c.labels[want.live], `${c.name}: live`)
    if (want.result) assert.equal(s.result?.event, c.labels[want.result], `${c.name}: result`)
    if (want.confirmations)
      assert.deepEqual(Object.fromEntries(Object.entries(s.confirmations).map(([seat, v]) => [seat, v.verdict])), want.confirmations, `${c.name}: confirmations`)
    if (want.stale !== undefined) assert.equal(s.stale.length, want.stale, `${c.name}: stale`)
    if (want.stake) assert.equal(s.agreement.stake?.msat, want.stake, `${c.name}: stake`)
    if (want.seats)
      assert.deepEqual(
        s.seats.map((x) => x && { pubkey: x.pubkey, profile: x.profile }),
        want.seats.map((x: { key: string; profile: boolean } | null) => x && { pubkey: keys[x.key].pubkey, profile: x.profile }),
        `${c.name}: seats`,
      )
    if (want.log) {
      const text = assembleChunks(s.logs[want.log.head], { head: want.log.head, total: want.log.pieces })
      assert.equal(text, want.log.text)
      assert.ok(decodeThrows(text).length > 100)
    }
    // A snapshot's standing agrees with replaying its throws.
    if (s.live && s.live.content.from === 0) {
      const config = {
        modeId: "501",
        modeName: "501",
        type: "x01" as const,
        startScore: 501,
        doubleOut: true,
        cutThroat: false,
        bullFinish: false,
        legsToWin: 1,
        players: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      }
      assert.deepEqual(replay(config, decodeThrows(s.live.content.throws)).scores, s.live.content.standing.scores, `${c.name}: standing`)
    }
  }
})

test("payment request vectors", () => {
  const file = load("payment-request")
  for (const c of file.cases) {
    // The vector's decoded invoice is what nostr-core decodes from the BOLT-11 spec example.
    const decoded = decodeBolt11(JSON.parse(c.rumor.content).invoice)
    assert.deepEqual({ amountMsat: decoded.amountMsat, paymentHash: decoded.paymentHash, expiresAt: decoded.expiresAt }, c.invoice)
    assert.equal(c.rumor.kind, 1180)
    const result = checkPaymentRequest(c.rumor, { sealPubkey: c.sealPubkey, match: c.match, agreement: c.agreement, payer: c.payer, invoice: c.invoice, now: c.now })
    if (c.expect.ok) assert.ok(result.ok, `${c.name}: ${JSON.stringify(result)}`)
    else assert.equal(result.ok ? "ok" : result.reason, c.expect.reason, c.name)
  }
})

test("badge vectors", () => {
  const file = load("badges")
  const ctx = {
    mayIssue: (scope: string, id: string, issuer: string) => file.context.mayIssue.some((m: string[]) => m[0] === scope && m[1] === id && m[2] === issuer),
    evidenceValid: (id: string) => (file.context.voided.includes(id) ? false : undefined),
  }
  for (const c of file.cases) {
    const result = checkBadgeAward(c.award, c.definition, ctx)
    if (c.expect.ok) {
      assert.ok(result.ok, `${c.name}: ${JSON.stringify(result)}`)
      assert.equal(result.self, c.expect.self, c.name)
    } else assert.equal(result.ok ? "ok" : result.reason, c.expect.reason, c.name)
    if (c.evidence) {
      // The evidence record: the issuer's own, about this very badge, and the one the award names.
      const parsed = parseRecord(c.evidence, { now: c.evidence.created_at })
      assert.equal(parsed.status, "ok", c.name)
      const record = (parsed as { record: BlueLineRecord<"badge.evidence"> }).record
      assert.equal(record.pubkey, c.award.pubkey, c.name)
      assert.equal(`30009:${record.pubkey}:${record.content.badge}`, c.award.tags.find((t: string[]) => t[0] === "a")[1], c.name)
      assert.equal(c.award.tags.find((t: string[]) => t[0] === "e")[1], c.evidence.id, c.name)
    }
    if (c.duplicateOf) {
      const original = file.cases.find((x: Vector) => x.award.id === c.duplicateOf)
      const checked = [original, c].map((x: Vector) => ({ award: x.award, ...(checkBadgeAward(x.award, x.definition, ctx) as { key: string }) }))
      assert.equal(checked[0].key, checked[1].key)
      assert.deepEqual(
        dedupeAwards(checked).map((x) => x.award.id),
        [c.duplicateOf],
      )
    }
  }
})

test("pairing vectors: code, keys and check code follow the documented derivations", () => {
  const v = load("pairing")
  const secret = hexBytes(v.code.secret)
  assert.equal(encodePairingCode(secret), v.code.code)
  assert.deepEqual(decodePairingCode(v.code.code), secret)
  assert.deepEqual(decodePairingCode(v.code.code.toLowerCase().replace(/-/g, " ")), secret)
  assert.equal(decodePairingCode("ABCD-EFGH-JKU0"), null)
  const keys = pairingCodeKeys(secret)
  assert.deepEqual(keys, { lookup: v.code.lookup, auth: v.code.auth })
  assert.equal(Buffer.from(hkdfSync("sha256", secret, "blueline-pair-v1", "lookup", 16)).toString("hex"), v.code.lookup)
  assert.equal(Buffer.from(hkdfSync("sha256", secret, "blueline-pair-v1", "auth", 32)).toString("hex"), v.code.auth)

  const cc = v.checkCode
  const digest = createHash("sha256")
    .update(Buffer.concat([Buffer.from("blueline-pair-sas-v1"), Buffer.from([0]), Buffer.from(cc.newDevice, "hex"), Buffer.from(cc.existingDevice, "hex"), Buffer.from(cc.sid, "hex")]))
    .digest()
  const n = digest.readUIntBE(0, 5) % 100_000_000
  const digits = String(n).padStart(8, "0")
  assert.equal(cc.code, `${digits.slice(0, 4)} ${digits.slice(4)}`)
  assert.equal(pairingCheckCode(cc.newDevice, cc.existingDevice, cc.sid), cc.code)
  assert.notEqual(pairingCheckCode(cc.existingDevice, cc.newDevice, cc.sid), cc.code)
})

test("pairing vectors: a board code is never taken for a pairing code, nor the other way round", () => {
  const v = load("pairing")
  assert.equal(decodePairingLink(v.links.pair).pubkey, v.checkCode.newDevice)
  assert.throws(() => decodePairingLink(v.links.board), /wrong_flow/)
  assert.throws(() => decodeBoardLink(v.links.pair), /wrong_flow/)
  assert.throws(() => parseLinkFragment(`#pair=${v.links.board}`), /wrong_flow/)
  assert.throws(() => parseLinkFragment(`#board=${v.links.watch}`), /wrong_flow/)
  assert.throws(() => parseLinkFragment(`#pair=${v.links.club}`), /wrong_flow/)
  assert.equal(parseLinkFragment(`#board=${v.links.board}`).type, "board")
  const clubLink = decodeLinkPayload("club", v.links.club)
  assert.deepEqual(clubLink.relays, ["ws://localhost:10547"])
  assert.equal(clubLink.token?.length, 32)
  assert.equal(clubLink.invite?.length, 64)
  assert.equal(decodeLinkPayload("watch", v.links.watch).key, v.keys.matchkey.secret)
})

test("pairing vectors: the message sequence on both devices", () => {
  const v = load("pairing")
  const k: Keys = v.keys
  const now = v.now
  const at = (step: Vector, reader: string) => {
    const plaintext = step.event.tags.some((t: string[]) => t[0] === "p") ? decrypt(k[reader].secret, step.event.pubkey, step.event.content) : null
    if (plaintext !== null) assert.equal(plaintext, step.plaintext)
    const parsed = parsePairingEvent(step.event, { plaintext, now })
    assert.ok(parsed.ok, JSON.stringify(parsed))
    assert.equal(step.event.kind, 21180)
    return parsed
  }

  // Existing device found the announce under the code's lookup tag.
  const announce = parsePairingEvent(v.steps.announce.event, { now })
  assert.ok(announce.ok)
  assert.equal(announce.lookup, v.code.lookup)
  assert.deepEqual(checkAnnounce(announce.from, announce.message, v.code.auth, now), { ok: true, sid: v.sid, expires: now + 300 })
  assert.equal(checkAnnounce(announce.from, announce.message, "00".repeat(32), now).ok, false)

  // New device.
  let fresh: PairingSession = newPairingSession({ role: "new", sid: v.sid, self: k["new-device"].pubkey, expires: now + 300, now, auth: v.code.auth })
  const forged = at(v.steps.helloAttacker, "new-device")
  assert.equal(applyPairingMessage(fresh, forged.from, forged.message, now).error?.reason, "mac_invalid")
  const hello = at(v.steps.hello, "new-device")
  fresh = applyPairingMessage(fresh, hello.from, hello.message, now).session
  assert.equal(fresh.step, "confirm")
  assert.equal(applyPairingMessage(fresh, forged.from, forged.message, now).error?.reason, "session_taken")
  const pkg = at(v.steps.package, "new-device")
  assert.equal(applyPairingMessage(fresh, pkg.from, pkg.message, now).error?.reason, "out_of_order")
  fresh = confirmPairingHere(fresh, now).session
  fresh = applyPairingMessage(fresh, pkg.from, pkg.message, now).session
  assert.equal(fresh.step, "done")

  // Existing device.
  let old: PairingSession = newPairingSession({ role: "existing", sid: v.sid, self: k["old-device"].pubkey, peer: k["new-device"].pubkey, expires: now + 300, now, auth: v.code.auth })
  const accept = at(v.steps.accept, "old-device")
  old = applyPairingMessage(old, accept.from, accept.message, now).session
  assert.equal(old.step, "confirm")
  old = confirmPairingHere(old, now).session
  assert.equal(old.step, "transfer")
  old = packageSent(old, (pkg.message as { data: Record<string, unknown> }).data)
  const ack = at(v.steps.ack, "old-device")
  assert.equal(ack.message.t === "ack" && ack.message.hash, fresh.packageHash)
  old = applyPairingMessage(old, ack.from, ack.message, now).session
  assert.equal(old.step, "done")

  // After expiry nothing moves; a board message is not a pairing message.
  assert.equal(applyPairingMessage(newPairingSession({ role: "new", sid: v.sid, self: k["new-device"].pubkey, expires: now + 300, now }), hello.from, hello.message, now + 301).session.step, "expired")
  const boardPlain = decrypt(k["old-device"].secret, v.steps.boardJoin.event.pubkey, v.steps.boardJoin.event.content)
  const wrong = parsePairingEvent(v.steps.boardJoin.event, { plaintext: boardPlain, now })
  assert.equal(wrong.ok ? "ok" : wrong.reason, "wrong_flow")
})

test("board join vectors", () => {
  const v = load("board-join")
  const k: Keys = v.keys
  const open = (step: Vector, reader: string) => parseBoardEvent(step.event, { plaintext: decrypt(k[reader].secret, step.event.pubkey, step.event.content), now: v.now })
  const join = open(v.steps.join, "board1")
  assert.ok(join.ok && join.message.t === "join")
  assert.equal(join.from, k.p1.pubkey)
  assert.deepEqual(checkJoin(join.message, { from: join.from, sid: v.sid, expires: v.expires, now: v.now, seats: [null, null] }), { ok: true, seat: 0 })
  const seat = open(v.steps.seat, "p1")
  assert.ok(seat.ok && seat.message.t === "seat" && seat.message.seat === 0)
  const taken = open(v.steps.joinTaken, "board1")
  assert.ok(taken.ok && taken.message.t === "join")
  assert.equal((checkJoin(taken.message, { from: taken.from, sid: v.sid, expires: v.expires, now: v.now, seats: [k.p1.pubkey, null] }) as { reason: string }).reason, "session_taken")
  const smuggled = open(v.steps.smuggled, "board1")
  assert.equal(smuggled.ok ? "ok" : smuggled.reason, "invalid_content")
  const pkg = open(v.steps.packageToBoard, "board1")
  assert.equal(pkg.ok ? "ok" : pkg.reason, "wrong_flow")
  const handoffGame = open(v.steps.handoffGameToBoard, "board1")
  assert.equal(handoffGame.ok ? "ok" : handoffGame.reason, "wrong_flow")

  // Looking at the board: the phone's one-time key asks, the board answers with the seats.
  const look = open(v.steps.look, "board1")
  assert.ok(look.ok && look.message.t === "look" && look.from === k.phone2.pubkey)
  const table = open(v.steps.table, "phone2")
  assert.ok(table.ok && table.message.t === "table")
  assert.deepEqual(table.message.seats, [{ alias: "Mia", taken: true }, { alias: "Jonas", taken: false }])

  // A profile joins through its claim on the phone's key: the seat goes to the profile.
  const claimJoin = open(v.steps.claimJoin, "board1")
  assert.ok(claimJoin.ok && claimJoin.message.t === "join" && claimJoin.message.profile)
  const claim = claimJoin.message.profile
  assert.ok(verifyEvent(claim), "the claim is signed by the profile")
  const ctx = { board: k.board1.pubkey, sid: v.sid, now: v.now }
  assert.deepEqual(checkClaim(claim, { ...ctx, from: claimJoin.from }), { ok: true, pubkey: k.p2.pubkey })
  assert.deepEqual(checkJoin(claimJoin.message, { from: k.p2.pubkey, sid: v.sid, expires: v.expires, now: v.now, seats: [k.p1.pubkey, null] }), { ok: true, seat: 1 })
  // The same claim from another phone key, at another board, or for another code is worthless.
  const other = open(v.steps.claimForOtherPhone, "board1")
  assert.ok(other.ok && other.message.t === "join" && other.message.profile)
  assert.equal((checkClaim(other.message.profile, { ...ctx, from: other.from }) as { reason: string }).reason, "not_authorized")
  assert.equal((checkClaim(claim, { ...ctx, board: k.board2.pubkey, from: claimJoin.from }) as { reason: string }).reason, "session_mismatch")
  assert.equal((checkClaim(claim, { ...ctx, now: v.now + 3601, from: claimJoin.from }) as { reason: string }).reason, "expired_message")
  const seatWithKey = open(v.steps.seatWithKey, "phone2")
  assert.ok(seatWithKey.ok && seatWithKey.message.t === "seat")
  assert.equal(seatWithKey.message.key, k.matchkey.secret)

  // Handing the match to another device: its own code, its own messages.
  const h = v.handoff
  assert.equal(decodeHandoffLink(h.link).pubkey, k.board1.pubkey)
  assert.throws(() => decodeBoardLink(h.link), /wrong_flow/)
  assert.throws(() => decodeHandoffLink(load("pairing").links.board), /wrong_flow/)
  assert.equal(h.checkCode, pairingCheckCode(k.board2.pubkey, k.board1.pubkey, h.sid))
  const openHandoff = (step: Vector, reader: string) => parseHandoffEvent(step.event, { plaintext: decrypt(k[reader].secret, step.event.pubkey, step.event.content), now: v.now })
  const take = openHandoff(h.take, "board1")
  assert.ok(take.ok && take.message.t === "take" && take.from === k.board2.pubkey)
  const game = openHandoff(h.game, "board2")
  assert.ok(game.ok && game.message.t === "game")
  const done = openHandoff(h.done, "board1")
  assert.ok(done.ok && done.message.t === "done")
  assert.equal(done.message.hash, createHash("sha256").update(JSON.stringify(game.message.data)).digest("hex"))
  const joinAsHandoff = openHandoff(h.joinAsHandoff, "board1")
  assert.equal(joinAsHandoff.ok ? "ok" : joinAsHandoff.reason, "wrong_flow")
  // A handoff message never passes as a board message, nor the other way round.
  const asBoard = parseBoardEvent(h.take.event, { plaintext: h.take.plaintext, now: v.now })
  assert.equal(asBoard.ok ? "ok" : asBoard.reason, "wrong_flow")
})

test("private record vectors", () => {
  const v = load("private-records")
  for (const r of v.records) {
    assert.equal(recordSlot(v.dataKey, r.id), r.slot)
    assert.equal(createHmac("sha256", Buffer.from(v.dataKey, "hex")).update(`blueline-record-v1:${r.id}`).digest("hex"), r.slot)
  }
  assert.equal(dataKeySlot(v.dataKeySlot.pubkey), createHash("sha256").update(`blueline-data-key-v1:${v.dataKeySlot.pubkey}`).digest("hex"))
  assert.equal(dataKeySlot(v.dataKeySlot.pubkey), v.dataKeySlot.slot)
  const env = decodeEnvelope(v.envelope.content)
  assert.equal(Buffer.from(env.nonce).toString("hex"), v.envelope.nonce)
  assert.equal(Buffer.from(env.ciphertext).toString("hex"), v.envelope.ciphertext)
  assert.equal(Buffer.from(v.envelope.content, "base64")[0], 1)
  assert.ok(parsePrivateEvent(v.events.valid, v.keys.p1.pubkey).ok)
  const labelled = parsePrivateEvent(v.events.labelled, v.keys.p1.pubkey)
  assert.equal(labelled.ok ? "ok" : labelled.reason, "invalid_tags")
  const foreign = parsePrivateEvent(v.events.valid, v.keys.p1.pubkey.replace(/^./, "0"))
  assert.equal(foreign.ok ? "ok" : foreign.reason, "not_authorized")
})

test("chunk vectors follow the documented hash chain", () => {
  const v = load("chunks")
  const { chunks, head } = chunkData(v.data, v.budget)
  assert.deepEqual(chunks, v.chunks)
  let prev = "0".repeat(64)
  for (const c of v.chunks) {
    assert.equal(c.prev, prev)
    prev = createHash("sha256").update(prev + c.data, "utf8").digest("hex")
  }
  assert.equal(prev, head)
  assert.equal(assembleChunks([...v.chunks].reverse(), { head, total: v.chunks.length, bytes: v.bytes }), v.data)
})

test("throw vectors", () => {
  const v = load("throws")
  for (const c of v.cases) {
    assert.equal(encodeThrows(c.log), c.encoded)
    assert.deepEqual(decodeThrows(c.encoded), c.log)
    // The decoded log replays to the same game as the stored one.
    assert.deepEqual(replay(c.config, decodeThrows(c.encoded)).legResults, replay(c.config, c.log).legResults)
  }
  assert.ok(v.cases.some((c: Vector) => c.log.some((t: { edited?: boolean }) => t.edited)), "a corrected log is among the vectors")
})
