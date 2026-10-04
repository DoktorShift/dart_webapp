import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createHmac, hkdfSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { decodeBolt11, nip44, verifyEvent } from "nostr-core"
import type { NostrEvent } from "nostr-core"
import { replay } from "../lib/game/engine.ts"
import { checkBadgeAward, dedupeAwards } from "../lib/protocol/badges.ts"
import { checkJoin, decodeBoardLink, parseBoardEvent } from "../lib/protocol/board.ts"
import { assembleChunks, chunkData } from "../lib/protocol/chunks.ts"
import { reduceClub } from "../lib/protocol/club-state.ts"
import { inviteProof, verifyInviteProof } from "../lib/protocol/invite.ts"
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
import type { SignedEvent } from "../lib/protocol/tags.ts"
import { decodeThrows, encodeThrows } from "../lib/protocol/throws.ts"
import { reduceTournament } from "../lib/protocol/tournament-state.ts"
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

function opener(file: Vector, c: Vector) {
  if (!c.open || !c.groupKey) return undefined
  const secret = file.keys[c.groupKey].secret
  return (event: SignedEvent) => {
    const plaintext = decrypt(secret, event.pubkey, event.content)
    assert.equal(plaintext, c.plaintexts[event.id], `plaintext of ${event.id}`)
    return plaintext
  }
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

test("every signed vector event verifies with nostr-core", () => {
  let count = 0
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (typeof v !== "object" || v === null) return
    const e = v as Record<string, unknown>
    if (typeof e.sig === "string" && typeof e.id === "string" && typeof e.pubkey === "string") {
      assert.ok(verifyEvent({ ...(e as NostrEvent) }), `signature of ${e.id}`)
      count++
    }
    Object.values(e).forEach(walk)
  }
  for (const name of ["club", "tournament", "match", "badges", "pairing", "board-join", "private-records"]) walk(load(name))
  assert.ok(count > 150, `${count} events`)
})

test("vector key tables match their derivation", () => {
  for (const name of ["club", "tournament", "match", "badges", "pairing", "board-join"]) {
    for (const [label, k] of Object.entries(load(name).keys as Keys)) {
      assert.equal(k.secret, createHash("sha256").update(`blueline-vector:${label}`).digest("hex"))
    }
  }
})

test("club vectors", () => {
  const file = load("club")
  const keys: Keys = file.keys
  for (const c of file.cases) {
    const result = reduceClub(c.events, c.root, { now: c.now, open: opener(file, c) })
    if (c.expect.problem) {
      assert.equal(result.state, null, c.name)
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
    if (want.inviteUses) for (const [invite, n] of Object.entries(want.inviteUses)) assert.equal(s.invites[invite].uses.length, n, `${c.name}: uses`)
    if (want.requests) assert.deepEqual(Object.keys(s.requests).sort(), (want.requests as string[]).map((n) => idOf(keys, n)).sort(), `${c.name}: requests`)
    if (want.former) for (const [n, how] of Object.entries(want.former)) assert.equal(s.former[idOf(keys, n)]?.how, how, `${c.name}: former`)
    if (want.keyEpoch !== undefined) assert.equal(s.key.epoch, want.keyEpoch, `${c.name}: epoch`)
    if (want.key) assert.equal(s.key.pubkey, want.key, `${c.name}: key`)
    if (want.name) assert.equal(s.info.name, want.name, `${c.name}: name`)
    if (want.seasons)
      for (const [id, season] of Object.entries(want.seasons as Record<string, { versions: number; ended: boolean }>)) {
        assert.equal(s.seasons[id].versions.length, season.versions, `${c.name}: season versions`)
        assert.equal(s.seasons[id].ended, season.ended, `${c.name}: season ended`)
      }
  }
})

test("club vectors: invite proofs follow the documented HMAC", () => {
  for (const v of load("invite").cases) {
    const independent = createHmac("sha256", Buffer.from(v.token, "hex")).update(`blueline-invite-v1:${v.pubkey}`).digest("hex")
    assert.equal(v.proof, independent)
    assert.equal(inviteProof(v.token, v.pubkey), independent)
    assert.ok(verifyInviteProof(v.token, v.pubkey, v.proof))
    assert.ok(!verifyInviteProof(v.token, v.pubkey, independent.replace(/^./, (ch: string) => (ch === "0" ? "1" : "0"))))
  }
})

test("tournament vectors", () => {
  const file = load("tournament")
  const keys: Keys = file.keys
  for (const c of file.cases) {
    const dependents = c.dependents ? (slot: string) => c.dependents[slot] ?? [] : undefined
    const result = reduceTournament(c.events, c.root, { now: c.now, dependents })
    assert.ok(result.state, `${c.name}: state`)
    const s = result.state
    checkLog(s.log, c)
    const want = c.expect.state ?? {}
    if (want.phase) assert.equal(s.phase, want.phase, `${c.name}: phase`)
    if (want.organizer) assert.equal(s.organizer, idOf(keys, want.organizer), `${c.name}: organizer`)
    if (want.participants)
      for (const [n, status] of Object.entries(want.participants)) assert.equal(s.participants[idOf(keys, n)]?.status, status, `${c.name}: ${n}`)
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
    if (want.slots)
      for (const [slot, w] of Object.entries(want.slots as Record<string, { winner?: string; corrected?: boolean; affected?: boolean }>)) {
        if (w.winner !== undefined) assert.equal(s.slots[slot].approved?.winner, w.winner, `${c.name}: ${slot} winner`)
        if (w.corrected !== undefined) assert.equal(s.slots[slot].approved?.corrected, w.corrected, `${c.name}: ${slot} corrected`)
        if (w.affected !== undefined) assert.equal(s.slots[slot].affected, w.affected, `${c.name}: ${slot} affected`)
      }
    // The draw order follows from the seed by the documented rule (recomputed independently).
    if (c.seed) {
      const order = [...c.field].sort((a: string, b: string) => {
        const ka = createHash("sha256").update(`blueline-draw-v1:${c.seed}:${a}`).digest("hex")
        const kb = createHash("sha256").update(`blueline-draw-v1:${c.seed}:${b}`).digest("hex")
        return ka < kb ? -1 : 1
      })
      assert.deepEqual(s.draw?.order, order)
      assert.equal(s.settings.seedCommit, createHash("sha256").update(`blueline-seed-v1:${c.seed}`).digest("hex"))
    }
  }
})

test("match vectors", () => {
  const file = load("match")
  const keys: Keys = file.keys
  for (const c of file.cases) {
    const result = reduceMatch(c.events, c.root, { now: c.now, open: opener(file, c) })
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
  assert.equal(parseLinkFragment(`#board=${v.links.board}`).type, "board")
  const clubLink = decodeLinkPayload("club", v.links.club)
  assert.deepEqual(clubLink.relays, ["ws://localhost:10547"])
  assert.equal(clubLink.secret, v.keys.club.secret)
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
  }
})
