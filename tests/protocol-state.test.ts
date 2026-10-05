import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { MAX_CLUB_MEMBERS } from "../lib/protocol/club.ts"
import { clubRoleAt, mayIssueClubBadge, reduceClub } from "../lib/protocol/club-state.ts"
import { inviteKey, inviteProof, newInviteToken } from "../lib/protocol/invite.ts"
import { MAX_OFFER_SECONDS } from "../lib/protocol/kinds.ts"
import { ProtocolError } from "../lib/protocol/reasons.ts"
import { buildRecord, parseRecord } from "../lib/protocol/records.ts"
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
  // A member's base stays their join after an acceptance: the same for every reader.
  const admin = signed(owner, "club.role", { member: alice.pubkey, role: "admin", prev: ask.id }, 30, found.id)
  const removed = signed(owner, "club.remove", { member: alice.pubkey, prev: admin.id, info: found.id }, 40, found.id)
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

test("a closed club stays within the members every sealed record can be wrapped for", () => {
  const token = newInviteToken()
  const found = signed(owner, "club.found", { name: "Dartfreunde Nord", visibility: "public" }, 0)
  const invite = signed(owner, "club.invite", { kind: "group", key: inviteKey(token), expires: NOW + 86400 }, 1, found.id)
  const people = Array.from({ length: MAX_CLUB_MEMBERS }, person)
  const joins = people.map((p, i) => signed(p, "club.join", { invite: invite.id, proof: inviteProof(token, p.pubkey) }, 10 + i, found.id))
  // A public club has no limit of its own: 101 members.
  const close = signed(owner, "club.update", { prev: found.id, visibility: "closed" }, 200, found.id)
  const crowded = reduceClub([found, invite, ...joins, close], found.id, { now: NOW + 1000 })
  assert.ok(crowded.state)
  assert.equal(Object.keys(crowded.state.members).length, MAX_CLUB_MEMBERS + 1)
  // Closing it now would leave members no sealed record can reach.
  assert.equal(crowded.state.log.rejected.find((r) => r.id === close.id)?.reason, "club_full")
  assert.equal(crowded.state.info.visibility, "public")
  // Once one has left, it closes; from then on the group link admits no one past the limit.
  const leave = signed(people[0], "club.leave", {}, 150, found.id)
  const late = person()
  const lateJoin = signed(late, "club.join", { invite: invite.id, proof: inviteProof(token, late.pubkey) }, 300, found.id)
  const closed = reduceClub([found, invite, ...joins, leave, close, lateJoin], found.id, { now: NOW + 1000 })
  assert.ok(closed.state)
  assert.equal(closed.state.info.visibility, "closed")
  assert.equal(Object.keys(closed.state.members).length, MAX_CLUB_MEMBERS)
  assert.equal(closed.state.requests[late.pubkey]?.check, "ok")
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
  const offer = signed(organizer, "tournament.handover.offer", { to: other.pubkey, prev: root, expires: NOW + 40 + 3600, core: running.id }, 40, root)
  const finished = signed(organizer, "tournament.phase", { phase: "finished", prev: running.id }, 50, root)
  const accept = signed(other, "tournament.handover.accept", { offer: offer.id, core: finished.id }, 60, root)

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

test("Ü1: a hand-over offer is open after its date, for at most seven days", () => {
  const root = "a".repeat(64)
  const offer = (expires: number): ContentOf<"tournament.handover.offer"> => ({ to: other.pubkey, prev: root, expires, core: root })
  const refused = (expires: number) => {
    try {
      buildRecord("tournament.handover.offer", offer(expires), { created_at: NOW, root })
      return "built"
    } catch (e) {
      return e instanceof ProtocolError ? e.reason : String(e)
    }
  }
  assert.equal(refused(NOW + 1), "built")
  assert.equal(refused(NOW + MAX_OFFER_SECONDS), "built")
  assert.equal(refused(NOW), "invalid_content")
  assert.equal(refused(NOW + MAX_OFFER_SECONDS + 1), "invalid_content")
  // A careless client signs one anyway: readers refuse it like any invalid content.
  const ok = buildRecord("club.owner.offer", { to: other.pubkey, prev: root, expires: NOW + 60, info: root, member: root }, { created_at: NOW, root })
  const tooLong = finalizeEvent({ ...ok, content: JSON.stringify({ ...JSON.parse(ok.content), expires: NOW + MAX_OFFER_SECONDS + 1 }) }, owner.secret)
  const r = parseRecord(tooLong, { now: NOW })
  assert.equal(r.status === "invalid" && r.reason, "invalid_content")
})

test("demotion: the pin covers the admin's records since their appointment, never earlier ones", () => {
  const found = signed(owner, "club.found", { name: "Dartfreunde Nord", visibility: "public" }, 0)
  const root = found.id
  const ask = signed(alice, "club.join", {}, 1, root)
  const accept = signed(owner, "club.accept", { request: ask.id, member: alice.pubkey }, 2, root)
  // First term as admin: a rename, kept by the first demotion's pin.
  const admin1 = signed(owner, "club.role", { member: alice.pubkey, role: "admin", prev: ask.id }, 10, root)
  const rename1 = signed(alice, "club.update", { prev: root, name: "DF Nord" }, 11, root)
  const demote1 = signed(owner, "club.role", { member: alice.pubkey, role: "member", prev: admin1.id, info: rename1.id }, 12, root)
  // Second term: an owner's pin naming the founding cuts only what Alice did in that term.
  const admin2 = signed(owner, "club.role", { member: alice.pubkey, role: "admin", prev: demote1.id }, 20, root)
  const about2 = signed(alice, "club.update", { prev: rename1.id, about: "Dienstags" }, 21, root)
  const demote2 = signed(owner, "club.role", { member: alice.pubkey, role: "member", prev: admin2.id, info: root }, 22, root)
  const result = reduceClub([found, ask, accept, admin1, rename1, demote1, admin2, about2, demote2], root, { now: NOW + 100 })
  assert.ok(result.state)
  assert.equal(result.state.info.name, "DF Nord")
  assert.equal(result.state.info.about, undefined)
  assert.deepEqual(
    result.state.log.rejected.map((r) => [r.id, r.reason]),
    [[about2.id, "superseded"]],
  )
})
