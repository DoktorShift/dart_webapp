import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { boardPlaintext, boardTemplate, checkJoin, parseBoardEvent } from "../lib/protocol/board.ts"
import type { PairingSession } from "../lib/protocol/pairing.ts"
import {
  applyPairingMessage,
  confirmPairingHere,
  decodePairingCode,
  encodePairingCode,
  newPairingSecret,
  newPairingSession,
  packageHash,
  pairingPlaintext,
  pairingTemplate,
  parsePairingEvent,
} from "../lib/protocol/pairing.ts"

const NOW = 1760000000
const SID = "ab".repeat(16)
const me = generateSecretKey()
const peer = getPublicKey(generateSecretKey())

test("pairing codes: 60 bits in 12 characters, both ways, for any secret", () => {
  for (let i = 0; i < 200; i++) {
    const secret = newPairingSecret()
    assert.ok(secret[0] <= 0x0f)
    const code = encodePairingCode(secret)
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    assert.deepEqual(decodePairingCode(code), secret)
  }
  assert.equal(encodePairingCode(new Uint8Array(8)), "0000-0000-0000")
  assert.equal(encodePairingCode(Uint8Array.from([0x0f, 255, 255, 255, 255, 255, 255, 255])), "ZZZZ-ZZZZ-ZZZZ")
  assert.deepEqual(decodePairingCode("oooo-iiii-llll"), decodePairingCode("0000-1111-1111"))
  for (const bad of ["", "0000-0000-000", "0000-0000-00000", "0000-0000-000U", "0000-0000-000!"]) assert.equal(decodePairingCode(bad), null, bad)
  assert.throws(() => encodePairingCode(Uint8Array.from([0x10, 0, 0, 0, 0, 0, 0, 0])))
})

const sessionNew = (extra: Partial<Parameters<typeof newPairingSession>[0]> = {}) =>
  newPairingSession({ role: "new", sid: SID, self: getPublicKey(me), expires: NOW + 600, now: NOW, ...extra })

test("a pairing lasts at most ten minutes", () => {
  assert.throws(() => sessionNew({ expires: NOW + 601 }))
  assert.throws(() => sessionNew({ expires: NOW }))
})

test("pairing steps refuse anything out of order or from elsewhere", () => {
  let s: PairingSession = sessionNew()
  assert.equal(applyPairingMessage(s, peer, { t: "hello", sid: "cd".repeat(16), device: "X" }, NOW).error?.reason, "session_mismatch")
  // Before any device answered, an abort comes from whoever read the announce: it ends nothing.
  const outsider = applyPairingMessage(s, peer, { t: "abort", sid: SID, reason: "declined" }, NOW)
  assert.equal(outsider.error?.reason, "out_of_order")
  assert.deepEqual(outsider.session, s)
  assert.equal(applyPairingMessage(s, peer, { t: "accept", sid: SID, device: "X" }, NOW).error?.reason, "out_of_order")
  assert.equal(confirmPairingHere(s, NOW).error?.reason, "out_of_order")
  s = applyPairingMessage(s, peer, { t: "hello", sid: SID, device: "iPhone" }, NOW).session
  assert.equal(s.step, "confirm")
  // The same hello again changes nothing.
  assert.deepEqual(applyPairingMessage(s, peer, { t: "hello", sid: SID, device: "iPhone" }, NOW).session, s)
  assert.equal(applyPairingMessage(s, getPublicKey(generateSecretKey()), { t: "abort", sid: SID, reason: "declined" }, NOW).error?.reason, "session_taken")
  assert.equal(applyPairingMessage(s, peer, { t: "abort", sid: SID, reason: "declined" }, NOW).session.step, "aborted")
  assert.equal(confirmPairingHere(s, NOW + 601).session.step, "expired")

  let old: PairingSession = newPairingSession({ role: "existing", sid: SID, self: peer, peer: getPublicKey(me), expires: NOW + 600, now: NOW })
  old = confirmPairingHere(old, NOW).session
  assert.equal(old.step, "confirm", "both sides confirm before anything travels")
  old = applyPairingMessage(old, getPublicKey(me), { t: "accept", sid: SID, device: "iPad" }, NOW).session
  assert.equal(old.step, "transfer")
  assert.equal(applyPairingMessage(old, getPublicKey(me), { t: "ack", sid: SID, hash: "0".repeat(64) }, NOW).error?.reason, "out_of_order")
  const data = { v: 1, key: "…" }
  old = { ...old, packageHash: packageHash(data) }
  assert.equal(applyPairingMessage(old, getPublicKey(me), { t: "ack", sid: SID, hash: "0".repeat(64) }, NOW).error?.reason, "mac_invalid")
  const done = applyPairingMessage(old, getPublicKey(me), { t: "ack", sid: SID, hash: packageHash(data) }, NOW).session
  assert.equal(done.step, "done")
  assert.equal(applyPairingMessage(done, getPublicKey(me), { t: "ack", sid: SID, hash: packageHash(data) }, NOW).error?.reason, "out_of_order")
})

test("pairing envelopes: announces carry the lookup tag only, messages a recipient only", () => {
  const announce = finalizeEvent(pairingTemplate({ message: { t: "announce", sid: SID, exp: NOW + 300, mac: "0".repeat(64) }, created_at: NOW, lookup: "f".repeat(32) }), me)
  assert.ok(parsePairingEvent(announce, { now: NOW }).ok)
  const withRecipient = finalizeEvent({ ...announce, tags: [...announce.tags, ["p", peer]] }, me)
  assert.equal(parsePairingEvent(withRecipient, { now: NOW, plaintext: announce.content }).ok, false)
  const hello = finalizeEvent(pairingTemplate({ message: { t: "hello", sid: SID, device: "iPhone" }, created_at: NOW, recipient: peer, ciphertext: "cipher" }), me)
  const plain = pairingPlaintext({ t: "hello", sid: SID, device: "iPhone" })
  assert.ok(parsePairingEvent(hello, { now: NOW, plaintext: plain }).ok)
  const why = (e: unknown, plaintext: string | null, now = NOW) => {
    const r = parsePairingEvent(e, { now, plaintext })
    return r.ok ? "ok" : r.reason
  }
  assert.equal(why(hello, null), "invalid_content")
  assert.equal(why(hello, plain, NOW + 601), "expired_message")
  assert.equal(why(hello, plain, NOW - 901), "future_timestamp")
  assert.equal(why(hello, JSON.stringify({ t: "hello", sid: SID, device: "iPhone", nsec: "x" })), "invalid_content")
  assert.equal(why(hello, JSON.stringify({ t: "party", sid: SID })), "invalid_content")
  assert.equal(why(hello, JSON.stringify({ t: "seat", sid: SID, seat: 0 })), "wrong_flow")
  // Signatures are lib/nostr's job; here only the shape counts.
  assert.equal(why({ ...hello, sig: "nope" }, plain), "invalid_event")
  assert.equal(why(finalizeEvent({ ...hello, kind: 21500 }, me), plain), "wrong_kind")
  assert.throws(() => pairingTemplate({ message: { t: "hello", sid: SID, device: "iPhone" }, created_at: NOW }))
})

test("board join: seats, strictness and the other flow", () => {
  const board = getPublicKey(generateSecretKey())
  const join = { t: "join" as const, sid: SID, seat: null, confirm: true }
  const e = finalizeEvent(boardTemplate({ recipient: board, ciphertext: "cipher", created_at: NOW }), me)
  const parsed = parseBoardEvent(e, { now: NOW, plaintext: boardPlaintext(join) })
  assert.ok(parsed.ok && parsed.message.t === "join")
  const ctx = { from: getPublicKey(me), sid: SID, expires: NOW + 3600, now: NOW }
  assert.deepEqual(checkJoin(join, { ...ctx, seats: [peer, null, null] }), { ok: true, seat: 1 })
  assert.deepEqual(checkJoin(join, { ...ctx, seats: [peer, getPublicKey(me)] }), { ok: true, seat: 1 }, "joining again keeps the seat")
  assert.equal((checkJoin(join, { ...ctx, seats: [peer, peer] }) as { reason: string }).reason, "no_free_seat")
  assert.equal((checkJoin(join, { ...ctx, now: NOW + 3601, seats: [null] }) as { reason: string }).reason, "expired_message")
  assert.equal((checkJoin({ ...join, sid: "cd".repeat(16) }, { ...ctx, seats: [null] }) as { reason: string }).reason, "session_mismatch")
  const pairingMsg = parseBoardEvent(e, { now: NOW, plaintext: JSON.stringify({ t: "hello", sid: SID, device: "x" }) })
  assert.equal(pairingMsg.ok ? "ok" : pairingMsg.reason, "wrong_flow")
  const pairEvent = finalizeEvent(pairingTemplate({ message: { t: "accept", sid: SID, device: "x" }, created_at: NOW, recipient: board, ciphertext: "c" }), me)
  const asBoard = parseBoardEvent(pairEvent, { now: NOW, plaintext: boardPlaintext(join) })
  assert.equal(asBoard.ok ? "ok" : asBoard.reason, "wrong_flow")
})
