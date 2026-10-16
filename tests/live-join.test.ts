import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import "./storage-helpers.ts"
import { replay } from "../lib/game/engine.ts"
import type { SavedMatch } from "../lib/game/types.ts"
import { agreementFor, resultFor } from "../lib/live/content.ts"
import { holdsSeat, ownVerdict, type JoinedMatch } from "../lib/live/join.ts"
import { MAX_SESSION_SECONDS } from "../lib/protocol/match.ts"
import { reduceMatch, type MatchStateP } from "../lib/protocol/match-state.ts"
import { buildRecord, type ContentOf, type RecordType } from "../lib/protocol/records.ts"
import type { SignedEvent } from "../lib/protocol/tags.ts"
import { config, dart, play } from "./helpers.ts"

// Whose verdict a seat's verdict is, as the phone decides it (ownVerdict): its own key's, for
// as long as the result it names stands, whatever happens to the seat afterwards.

const T0 = 1_800_000_000
const authority = generateSecretKey()
const session = generateSecretKey()
const mia = generateSecretKey()
const lea = generateSecretKey()

const c = config({ startScore: 40, players: [{ id: "a", name: "Mia" }, { id: "b", name: "Jonas" }] })
const game: SavedMatch = { id: "m", config: c, throws: play(c, [dart(20, 2)]), startedAt: "2027-01-15T19:00:00.000Z", acknowledgedLegs: 0, status: "playing" }

const founding = finalizeEvent(
  buildRecord("match.session", { sv: 1, session: getPublicKey(session), from: T0, until: T0 + MAX_SESSION_SECONDS, agreement: { ...agreementFor(c), visibility: "public" } }, { created_at: T0 }),
  authority,
) as SignedEvent
const record = <T extends RecordType>(by: Uint8Array, type: T, content: ContentOf<T>, at: number) => finalizeEvent(buildRecord(type, content, { created_at: T0 + at, root: founding.id }), by) as SignedEvent

const seated = (who: Uint8Array | null, at: number) => record(authority, "match.seat", { seat: 0, player: who && { pubkey: getPublicKey(who), profile: true } }, at)
const result = record(session, "match.result", resultFor(game, replay(c, game.throws), { sv: 1, auth: founding, finishedAt: T0 + 10 }).content, 10)
const confirm = (who: Uint8Array, at: number) => record(who, "match.confirm", { result: result.id, verdict: "confirm", seat: 0 }, at)

const state = (...events: SignedEvent[]): MatchStateP => {
  const reduced = reduceMatch([founding, ...events], founding.id, { now: T0 + 1000 })
  assert.ok(reduced.state)
  return reduced.state
}
const phoneOf = (who: Uint8Array): JoinedMatch => ({ match: founding.id, relays: [], seat: 0, profile: getPublicKey(who), key: null, guest: null, archived: null })

test("a verdict is the phone's own by the key that gave it, and stays so when the board frees the seat", () => {
  const confirmed = state(seated(mia, 1), result, confirm(mia, 11))
  assert.equal(ownVerdict(phoneOf(mia), confirmed)?.verdict, "confirm")
  assert.equal(ownVerdict(phoneOf(lea), confirmed), null)

  const freed = state(seated(mia, 1), result, confirm(mia, 11), seated(null, 12))
  assert.equal(holdsSeat(phoneOf(mia), freed), false)
  assert.equal(ownVerdict(phoneOf(mia), freed)?.verdict, "confirm", "the result the player confirmed has not changed")
})

test("the seat's next holder's verdict replaces it, and a correction drops it", () => {
  const taken = state(seated(mia, 1), result, confirm(mia, 11), seated(null, 12), seated(lea, 13), confirm(lea, 14))
  assert.equal(ownVerdict(phoneOf(mia), taken), null)
  assert.equal(ownVerdict(phoneOf(lea), taken)?.verdict, "confirm")

  const correction = record(session, "match.result", { ...resultFor(game, replay(c, game.throws), { sv: 1, auth: founding, finishedAt: T0 + 20 }).content, replaces: result.id, reason: "Corrected" }, 20)
  const corrected = state(seated(mia, 1), result, confirm(mia, 11), correction)
  assert.ok(corrected.result && corrected.result.event !== result.id)
  assert.equal(ownVerdict(phoneOf(mia), corrected), null)
})
