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

test("a club's tournament depends on the club's history only for counting as the club's", () => {
  const club = signed(owner, "club.found", { name: "Dartfreunde Nord", visibility: "public" }, 0)
  const ask = signed(alice, "club.join", {}, 1, club.id)
  const accept = signed(owner, "club.accept", { request: ask.id, member: alice.pubkey }, 2, club.id)
  const director = signed(owner, "club.role", { member: alice.pubkey, role: "director", prev: ask.id }, 3, club.id)
  const seed = "6".repeat(32)
  const cup = { name: "Clubcup", engine: 1, format: "single", rules: { type: "x01", modeId: "501", startScore: 501, doubleIn: false, doubleOut: true, cutThroat: false, bullFinish: false, legsToWin: 2, setsToWin: 1, startRule: "alternate" }, capacity: 4, admission: "manual", waitlist: false, checkIn: false, approval: "organizer", club: club.id, seedCommit: seedCommitment(seed) } as const
  const read = (clubEvents: unknown[], tournamentEvents: unknown[], root: string) => {
    const c = reduceClub(clubEvents, club.id, { now: NOW + 100 })
    assert.ok(c.state)
    const clubState = c.state
    const t = reduceTournament(tournamentEvents, root, { now: NOW + 100, clubRole: (pubkey, at) => clubRoleAt(clubState, pubkey, at) })
    assert.ok(t.state)
    return t.state
  }

  // The owner founds the club's tournament and hands it to Alice, a director, who draws.
  const found = signed(owner, "tournament.found", cup, 10)
  const root = found.id
  const offer = signed(owner, "tournament.handover.offer", { to: alice.pubkey, prev: root, expires: NOW + 20 + 3600, core: root }, 20, root)
  const take = signed(alice, "tournament.handover.accept", { offer: offer.id, core: root }, 30, root)
  const g1 = signed(alice, "tournament.guest", { guest: "1".repeat(32), alias: "Gast 1" }, 40, root)
  const g2 = signed(alice, "tournament.guest", { guest: "2".repeat(32), alias: "Gast 2" }, 41, root)
  const draw = signed(alice, "tournament.draw", { seed, seeded: [], order: drawOrder(seed, ["1".repeat(32), "2".repeat(32)]), prev: root }, 50, root)
  const tournament = [found, offer, take, g1, g2, draw]
  const before = read([club, ask, accept, director], tournament, root)
  assert.equal(before.organizer, alice.pubkey)
  assert.equal(before.phase, "drawn")
  // Weeks later the owner dates Alice's demotion in the club back between offer and acceptance:
  // the completed hand-over and Alice's draw stand.
  const demoted = signed(owner, "club.role", { member: alice.pubkey, role: "member", prev: director.id }, 25, club.id)
  const after = read([club, ask, accept, director, demoted], tournament, root)
  assert.equal(after.organizer, alice.pubkey)
  assert.equal(after.phase, "drawn")
  assert.deepEqual(after.club, { id: club.id, verified: true })

  // A tournament Alice founded as director: a demotion dated before its founding takes away
  // only that it counts for the club.
  const own = signed(alice, "tournament.found", cup, 10)
  assert.deepEqual(read([club, ask, accept, director], [own], own.id).club, { id: club.id, verified: true })
  const backdated = signed(owner, "club.role", { member: alice.pubkey, role: "member", prev: director.id }, 5, club.id)
  const detached = read([club, ask, accept, director, backdated], [own], own.id)
  assert.deepEqual(detached.club, { id: club.id, verified: false })
  assert.equal(detached.organizer, alice.pubkey)
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

test("members name club games and answer dates; outsiders, repeats and keys in the clear count for nothing", () => {
  const found = signed(owner, "club.found", { name: "Dartfreunde Nord", visibility: "public" }, 0)
  const ask = signed(alice, "club.join", {}, 10, found.id)
  const accept = signed(owner, "club.accept", { request: ask.id, member: alice.pubkey }, 20, found.id)
  const match = "ab".repeat(32)
  const game = signed(alice, "club.game", { match }, 30, found.id)
  const again = signed(owner, "club.game", { match }, 31, found.id)
  const stranger = signed(other, "club.game", { match: "cd".repeat(32) }, 32, found.id)
  const leaked = signed(owner, "club.game", { match: "ef".repeat(32), key: "11".repeat(32) }, 33, found.id)
  const day = "0a".repeat(16)
  const early = signed(alice, "club.rsvp", { date: day, answer: "yes" }, 35, found.id)
  const date = signed(owner, "club.date", { date: day, title: "Clubabend", starts: NOW + 86400, prev: found.id }, 40, found.id)
  const yes = signed(alice, "club.rsvp", { date: day, answer: "yes" }, 50, found.id)
  const no = signed(alice, "club.rsvp", { date: day, answer: "no" }, 60, found.id)
  const moved = signed(owner, "club.date", { date: day, title: "Clubabend", starts: NOW + 90000, prev: date.id }, 70, found.id)
  const outsider = signed(other, "club.rsvp", { date: day, answer: "yes" }, 80, found.id)
  const result = reduceClub([found, ask, accept, game, again, stranger, leaked, early, date, yes, no, moved, outsider], found.id, { now: NOW + 100 })
  assert.ok(result.state)
  const s = result.state
  assert.deepEqual(Object.keys(s.games), [match])
  assert.equal(s.games[match].by, alice.pubkey)
  const reason = (id: string) => s.log.rejected.find((r) => r.id === id)?.reason
  assert.equal(reason(again.id), "duplicate")
  assert.equal(reason(stranger.id), "not_member")
  assert.equal(reason(leaked.id), "invalid_content")
  assert.equal(reason(outsider.id), "not_member")
  // An answer to a date this reader doesn't have yet waits; the newest answer counts and stays
  // when the date moves.
  assert.equal(s.log.unapplied.find((u) => u.id === early.id)?.why, "waiting")
  assert.equal(s.dates[day].starts, NOW + 90000)
  assert.deepEqual(s.dates[day].answers[alice.pubkey], { answer: "no", at: NOW + 60, event: no.id })

  const archive = signed(owner, "club.update", { prev: found.id, archived: true }, 90, found.id)
  const late = signed(alice, "club.game", { match: "12".repeat(32) }, 95, found.id)
  const archived = reduceClub([found, ask, accept, archive, late], found.id, { now: NOW + 100 })
  assert.equal(archived.state?.log.rejected.find((r) => r.id === late.id)?.reason, "club_archived")
})
