import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { clubRoleAt, mayIssueClubBadge, reduceClub } from "../lib/protocol/club-state.ts"
import { buildRecord } from "../lib/protocol/records.ts"
import type { ContentOf, RecordType } from "../lib/protocol/records.ts"
import { createdAtAfter } from "../lib/protocol/tags.ts"
import { drawOrder, seedCommitment } from "../lib/protocol/tournament.ts"
import { mayIssueTournamentBadge, reduceTournament } from "../lib/protocol/tournament-state.ts"

// Helpers other modules build on: role history for badges and club tournaments, who issues a
// tournament's badges, and the created_at rule for decisions on top of other records.

const NOW = 1760000000
const person = () => {
  const secret = generateSecretKey()
  return { secret, pubkey: getPublicKey(secret) }
}
const owner = person()
const alice = person()
const organizer = person()
const other = person()

function signed<T extends RecordType>(who: { secret: Uint8Array }, type: T, content: ContentOf<T>, at: number, root?: string) {
  return finalizeEvent(buildRecord(type, content, { created_at: NOW + at, root }), who.secret)
}

test("club role history answers 'which role at that time' for badges and club tournaments", () => {
  const found = signed(owner, "club.found", { name: "Dartfreunde Nord", visibility: "public" }, 0)
  const ask = signed(alice, "club.join", {}, 10, found.id)
  const accept = signed(owner, "club.accept", { request: ask.id, member: alice.pubkey }, 20, found.id)
  const admin = signed(owner, "club.role", { member: alice.pubkey, role: "admin", prev: accept.id }, 30, found.id)
  const removed = signed(owner, "club.remove", { member: alice.pubkey, prev: admin.id }, 40, found.id)
  const result = reduceClub([found, ask, accept, admin, removed], found.id, { now: NOW + 100 })
  assert.ok(result.state)
  const s = result.state
  assert.equal(clubRoleAt(s, alice.pubkey, NOW + 15), null)
  assert.equal(clubRoleAt(s, alice.pubkey, NOW + 25), "member")
  assert.equal(clubRoleAt(s, alice.pubkey, NOW + 35), "admin")
  assert.equal(clubRoleAt(s, alice.pubkey, NOW + 45), null)
  assert.equal(mayIssueClubBadge(s, alice.pubkey, NOW + 35), true)
  assert.equal(mayIssueClubBadge(s, alice.pubkey, NOW + 25), false)
  assert.equal(mayIssueClubBadge(s, owner.pubkey, NOW + 45), true)
})

test("a tournament's badges come from the organizer who finished it", () => {
  const seed = "5".repeat(32)
  const found = signed(
    organizer,
    "tournament.found",
    {
      name: "Herbstcup",
      engine: 1,
      format: "single",
      rules: { type: "x01", modeId: "501", startScore: 501, doubleIn: false, doubleOut: true, cutThroat: false, bullFinish: false, legsToWin: 2, setsToWin: 1, startRule: "alternate" },
      capacity: 4,
      admission: "manual",
      waitlist: false,
      checkIn: false,
      approval: "organizer",
      seedCommit: seedCommitment(seed),
    },
    0,
  )
  const root = found.id
  const g1 = signed(organizer, "tournament.guest", { guest: "1".repeat(32), alias: "Gast 1" }, 10, root)
  const g2 = signed(organizer, "tournament.guest", { guest: "2".repeat(32), alias: "Gast 2" }, 11, root)
  const draw = signed(organizer, "tournament.draw", { seed, seeded: [], order: drawOrder(seed, ["1".repeat(32), "2".repeat(32)]), prev: root }, 20, root)
  const running = signed(organizer, "tournament.phase", { phase: "running", prev: draw.id }, 30, root)
  const offer = signed(organizer, "tournament.handover.offer", { to: other.pubkey, prev: root }, 40, root)
  const finished = signed(organizer, "tournament.phase", { phase: "finished", prev: running.id }, 50, root)
  const accept = signed(other, "tournament.handover.accept", { offer: offer.id }, 60, root)

  const before = reduceTournament([found, g1, g2, draw, running], root, { now: NOW + 100 })
  assert.ok(before.state)
  assert.equal(before.state.phase, "running")
  assert.equal(mayIssueTournamentBadge(before.state, organizer.pubkey), false)
  // Finished by the organizer; an offer accepted after the end changes nothing.
  const after = reduceTournament([found, g1, g2, draw, running, offer, finished, accept], root, { now: NOW + 100 })
  assert.ok(after.state)
  assert.equal(after.state.phase, "finished")
  assert.equal(mayIssueTournamentBadge(after.state, organizer.pubkey), true)
  assert.equal(mayIssueTournamentBadge(after.state, other.pubkey), false)
  assert.equal(after.state.log.rejected.find((r) => r.id === accept.id)?.reason, "phase_invalid")
})

test("decisions are dated after what they build on, even when the writer's clock lags", () => {
  assert.equal(createdAtAfter(NOW, NOW - 50), NOW)
  assert.equal(createdAtAfter(NOW, NOW + 30, NOW + 10), NOW + 31)
  assert.equal(createdAtAfter(NOW), NOW)
})
