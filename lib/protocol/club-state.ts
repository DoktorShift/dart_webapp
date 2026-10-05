import type { ClubRole, SeasonRules } from "./club.ts"
import { CLUB_PLAIN_TYPES, MAX_CLUB_MEMBERS } from "./club.ts"
import type { InviteKind } from "./invite.ts"
import { verifyInviteProof } from "./invite.ts"
import type { AnyRecord, BlueLineRecord } from "./records.ts"
import type { FoundingProblem, Pin, Problem, ReplayLog, ReplayOptions } from "./replay.ts"
import { applied, copyLog, foundingProblem, handoverChain, pinRule, prepare, reject, settle, staleOr } from "./replay.ts"

// Club state from the founding and all changes (docs/protocol/families/club.md and
// permissions.md). Each change is checked against its author's role at that point of the
// replay; a change that fails is kept in `rejected` with the reason and changes nothing, one
// that builds on data this reader cannot open waits in `unapplied`.
//
// Joining (docs/decisions/0002 §6): a group link admits a joiner with a valid proof at once,
// unless the club has a member limit; a personal invite and a request without invite only
// become membership through acceptance. Capacity and order are therefore decided by an owner
// or admin, never by a created_at the joiner chose. Whoever reads the invite checks the proof
// (in a public club everyone); a reader who cannot sees a waiting request, and an owner's or
// admin's record that treats the person as a member accepts it for that reader.
//
// Ends of authority (replay.ts): the ownership chain is replayed on its own first, and the
// club.updates of an owner who handed over or an admin who was demoted count only up to what
// the end of their role names.

export interface ClubMember {
  pubkey: string
  role: ClubRole
  since: number
  // "group": this reader checked the group link proof itself; "accepted": an owner or admin
  // accepted the request (for a reader who cannot open the invite, also a group link joiner).
  via: "founder" | "group" | "accepted"
  // The base a role change or removal names as `prev`: the join (also after an acceptance),
  // then the last role change. The same for every reader, however they came to see the member.
  head: string
}

export interface ClubInvite {
  // The club.invite event id.
  id: string
  kind: InviteKind
  // Public key of the invite key: checks join proofs (invite.ts).
  key: string
  by: string
  at: number
  expires: number
  label?: string
  revoked: boolean
  // Group link: everyone it admitted. Personal invite: the one accepted use.
  uses: { pubkey: string; event: string; at: number }[]
}

export interface JoinRequest {
  event: string
  pubkey: string
  at: number
  invite?: string
  // "none": asked without invite. "ok": the invite proof checked out (personal invite, or a
  // group link of a club with a member limit). "unverified": this reader cannot open the invite
  // (yet), so the proof is unchecked; an owner or admin decides as for any request.
  check: "none" | "ok" | "unverified"
}

export interface ClubSeason {
  id: string
  name: string
  starts: number
  ends?: number
  ended: boolean
  versions: { version: number; rules: SeasonRules; event: string; at: number; reason?: string }[]
}

export interface ClubResultDecision {
  season: string
  match: string
  result: string
  count: boolean
  reason?: string
  event: string
  by: string
  at: number
}

export interface ClubDate {
  id: string
  title: string
  starts: number
  ends?: number
  place?: string
  note?: string
  cancelled: boolean
  by: string
  at: number
  head: string
}

export interface ClubState {
  id: string
  founder: string
  owner: string
  info: { name: string; about?: string; picture?: string; visibility: "closed" | "public"; capacity?: number; archived: boolean }
  members: Record<string, ClubMember>
  invites: Record<string, ClubInvite>
  // Waiting requests by pubkey.
  requests: Record<string, JoinRequest>
  former: Record<string, { how: "left" | "removed"; event: string; at: number; by: string; reason?: string }>
  offer: { event: string; to: string; at: number } | null
  seasons: Record<string, ClubSeason>
  // Season → match id → the decision that counts.
  results: Record<string, Record<string, ClubResultDecision>>
  dates: Record<string, ClubDate>
  // Key shares (club.keys): who gave members access to earlier records, and how many.
  shares: { event: string; by: string; at: number; count: number }[]
  // Role of every key over time, oldest first (null = no longer a member), for checks in other
  // objects such as tournaments run by the club (clubRoleAt).
  history: { pubkey: string; role: ClubRole | null; at: number; event: string }[]
  heads: { info: string; owner: string }
  log: ReplayLog
}

export type ClubResult = { state: ClubState } | { state: null; problem: FoundingProblem }

const ARCHIVED_BLOCKS: readonly string[] = ["club.invite", "club.join", "club.accept", "club.season", "club.season.rules", "club.result", "club.date"]
const OWNER_CHAIN = { offer: "club.owner.offer", cancel: "club.owner.cancel", accept: "club.owner.accept" }

type Prepared = ReturnType<typeof prepare>

export function reduceClub(events: readonly unknown[], clubId: string, opts: ReplayOptions = {}): ClubResult {
  const prepared = prepare(events, clubId, opts)
  const { records, log, founding } = prepared
  if (!founding || founding.type !== "club.found") return { state: null, problem: founding ? "invalid" : foundingProblem(log, clubId) }
  if (founding.content.visibility === "closed" && founding.encryption !== "seal") {
    reject(log, founding, "sealing_required", "a closed club is sealed from its founding on")
    return { state: null, problem: "invalid" }
  }
  // The ownership chain on its own first; each hand-over pins what the new owner saw of the
  // club's details and of their own membership. Demotions of admins show up while replaying
  // the club and pin that admin's club.updates: then the club is replayed once more with them.
  const owners = handoverChain(records, founding, OWNER_CHAIN)
  const pins: Pin[] = owners.ends.flatMap(({ from, accept }) => {
    const c = (accept as BlueLineRecord<"club.owner.accept">).content
    return [
      { from, end: accept, subject: "info", head: c.info },
      { from, end: accept, subject: `member:${accept.pubkey}`, head: c.member },
    ]
  })
  const first = replay(prepared, founding, owners.superseded, pins)
  if (first.demotions.length === 0) return { state: first.state }
  return { state: replay(prepared, founding, owners.superseded, [...pins, ...first.demotions]).state }
}

// The subjects whose heads the end of a role pins, and the predecessor a record names.
const pinSubject = (r: AnyRecord): string | null => {
  if (r.type === "club.update") return "info"
  if (r.type === "club.role" || r.type === "club.remove") return `member:${r.content.member}`
  return null
}
const prevOf = (r: AnyRecord) => (r.content as { prev: string }).prev

function replay(prepared: Prepared, founding: BlueLineRecord<"club.found">, superseded: ReadonlySet<string>, pins: readonly Pin[]) {
  const { records, datedAt, unreadable } = prepared
  const log = copyLog(prepared.log)
  const f = founding.content
  const s: ClubState = {
    id: founding.id,
    founder: founding.pubkey,
    owner: founding.pubkey,
    info: { name: f.name, about: f.about, picture: f.picture, visibility: f.visibility, capacity: f.capacity, archived: false },
    members: { [founding.pubkey]: { pubkey: founding.pubkey, role: "owner", since: founding.created_at, via: "founder", head: founding.id } },
    invites: {},
    requests: {},
    former: {},
    offer: null,
    seasons: {},
    results: {},
    dates: {},
    shares: [],
    history: [{ pubkey: founding.pubkey, role: "owner", at: founding.created_at, event: founding.id }],
    heads: { info: founding.id, owner: founding.id },
    log,
  }
  applied(log, founding)
  const ctx: Context = { datedAt, unreadable, parsed: new Set(records.map((r) => r.id)), demotions: [] }
  const pinned = pinRule(pins, records, founding.id, pinSubject, prevOf)

  for (const r of records) {
    if (r === founding) continue
    if (r.created_at < founding.created_at) reject(log, r, "before_founding", "dated before the club was founded")
    else if (superseded.has(r.id)) reject(log, r, "superseded", "the offer it competes with was accepted; dated before that acceptance")
    else settle(log, r, pinned(r) ?? apply(s, r, ctx))
  }
  return { state: s, demotions: ctx.demotions }
}

// The role `pubkey` held in the club at `at` (unix seconds), from the replayed history.
export function clubRoleAt(state: ClubState, pubkey: string, at: number): ClubRole | null {
  let role: ClubRole | null = null
  for (const h of state.history) if (h.pubkey === pubkey && h.at <= at) role = h.role
  return role
}

// Who may award the club's badges (badges.ts mayIssue): its owner or an admin at the time of
// the award.
export const mayIssueClubBadge = (state: ClubState, pubkey: string, at: number) => {
  const role = clubRoleAt(state, pubkey, at)
  return role === "owner" || role === "admin"
}

interface Context {
  datedAt: Map<string, number>
  unreadable: ReadonlySet<string>
  parsed: Set<string>
  // Admins whose role ended in this replay: their club.updates are pinned (replay.ts).
  demotions: Pin[]
}

const roleOf = (s: ClubState, pubkey: string): ClubRole | null => s.members[pubkey]?.role ?? null
const memberCount = (s: ClubState) => Object.keys(s.members).length
// A closed club seals every record for all members (seal.ts), so it never grows past
// MAX_CLUB_MEMBERS; its own capacity may be lower. A public club has a limit only when it sets one.
const limitOf = (s: ClubState) => s.info.capacity ?? (s.info.visibility === "closed" ? MAX_CLUB_MEMBERS : undefined)
const full = (s: ClubState) => {
  const limit = limitOf(s)
  return limit !== undefined && memberCount(s) >= limit
}

function setRole(s: ClubState, r: AnyRecord, pubkey: string, role: ClubRole | null) {
  s.history.push({ pubkey, role, at: r.created_at, event: r.id })
}

function addMember(s: ClubState, r: AnyRecord, pubkey: string, via: ClubMember["via"], head: string) {
  s.members[pubkey] = { pubkey, role: "member", since: r.created_at, via, head }
  delete s.requests[pubkey]
  delete s.former[pubkey]
  setRole(s, r, pubkey, "member")
}

function dropMember(s: ClubState, r: AnyRecord, pubkey: string, how: "left" | "removed", reason?: string) {
  delete s.members[pubkey]
  s.former[pubkey] = { how, event: r.id, at: r.created_at, by: r.pubkey, ...(reason ? { reason } : {}) }
  if (s.offer?.to === pubkey) s.offer = null
  setRole(s, r, pubkey, null)
}

// Accepts a waiting request: with club.accept, or with a record of an owner or admin that
// treats the person as a member (pending() below). Same checks either way.
function admit(s: ClubState, r: AnyRecord, request: JoinRequest): Problem {
  const invite = request.invite ? s.invites[request.invite] : undefined
  if (invite?.kind === "personal") {
    if (invite.uses.length > 0) return ["invite_exhausted", "the personal invite was used"]
    if (invite.revoked) return ["invite_revoked", "the invite was ended"]
  }
  if (full(s)) return ["club_full", "the club is full"]
  addMember(s, r, request.pubkey, "accepted", request.event)
  invite?.uses.push({ pubkey: request.pubkey, event: r.id, at: r.created_at })
  return null
}

// The waiting request of someone who is not a member, when a role change or removal names
// their join as its base: for a reader who cannot open the invite of a group link joiner, that
// record of an owner or admin is the confirmation.
const pending = (s: ClubState, pubkey: string, prev: string): JoinRequest | undefined =>
  !s.members[pubkey] && s.requests[pubkey]?.event === prev ? s.requests[pubkey] : undefined

const ADMIN_PIN_MISSING: Problem = ["invalid_content", "ending an admin's role names the last club change its author saw (info)"]

function apply(s: ClubState, r: AnyRecord, ctx: Context): Problem {
  const role = roleOf(s, r.pubkey)
  const manager = role === "owner" || role === "admin"
  const leader = manager || role === "director"
  const stale = (prev: string, detail: string) => staleOr(ctx.unreadable, prev, detail)
  if (s.info.archived && ARCHIVED_BLOCKS.includes(r.type)) return ["club_archived", "the club is archived"]
  if (s.info.visibility === "closed" && r.encryption !== "seal" && !CLUB_PLAIN_TYPES.includes(r.type)) return ["sealing_required", "a closed club's records are sealed for its members"]

  switch (r.type) {
    case "club.found":
      return ["wrong_root", "a second founding"]

    case "club.update": {
      const c = r.content
      if (!manager) return ["not_authorized", "only the owner or an admin edits the club"]
      if ((c.visibility !== undefined || c.archived !== undefined) && role !== "owner") return ["not_authorized", "only the owner changes visibility or archives"]
      if (c.prev !== s.heads.info) return stale(c.prev, "the club was changed meanwhile")
      if (c.visibility === "closed" && memberCount(s) > MAX_CLUB_MEMBERS) return ["club_full", `a closed club seals for at most ${MAX_CLUB_MEMBERS} members`]
      if (c.name !== undefined) s.info.name = c.name
      if (c.about !== undefined) s.info.about = c.about
      if (c.picture !== undefined) s.info.picture = c.picture ?? undefined
      if (c.visibility !== undefined) s.info.visibility = c.visibility
      if (c.capacity !== undefined) s.info.capacity = c.capacity ?? undefined
      if (c.archived !== undefined) s.info.archived = c.archived
      s.heads.info = r.id
      return null
    }

    case "club.invite": {
      const c = r.content
      if (!manager) return ["not_authorized", "only the owner or an admin invites"]
      if (c.expires <= r.created_at) return ["invite_expired", "expires before it is made"]
      // A label may name the invited person: never in the clear (docs/protocol/privacy.md).
      if (c.label !== undefined && r.encryption !== "seal") return ["invalid_content", "an invite's label only travels sealed"]
      s.invites[r.id] = { id: r.id, kind: c.kind, key: c.key, by: r.pubkey, at: r.created_at, expires: c.expires, ...(c.label ? { label: c.label } : {}), revoked: false, uses: [] }
      return null
    }

    case "club.invite.revoke": {
      if (!manager) return ["not_authorized", "only the owner or an admin ends invites"]
      const invite = s.invites[r.content.invite]
      if (!invite) return ctx.parsed.has(r.content.invite) ? ["invite_unknown", "no such invite"] : ["waiting", "names an invite this reader cannot open or has not loaded"]
      if (invite.revoked) return ["invite_revoked", "already ended"]
      invite.revoked = true
      return null
    }

    case "club.join":
      return join(s, r, ctx)

    case "club.accept": {
      const c = r.content
      if (!manager) return ["not_authorized", "only the owner or an admin accepts"]
      if (s.members[c.member]) return ["already_member", "already a member"]
      const request = s.requests[c.member]
      if (!request || request.event !== c.request) return ["request_unknown", "no such waiting request"]
      return admit(s, r, request)
    }

    case "club.decline": {
      if (!manager) return ["not_authorized", "only the owner or an admin declines"]
      const entry = Object.values(s.requests).find((q) => q.event === r.content.request)
      if (!entry) return ["request_unknown", "no such waiting request"]
      delete s.requests[entry.pubkey]
      return null
    }

    case "club.leave":
      if (!role) {
        // Someone who is not a member withdraws their waiting request.
        if (!s.requests[r.pubkey]) return ["not_member", "not a member and nothing waiting"]
        delete s.requests[r.pubkey]
        return null
      }
      if (role === "owner") return ["owner_cannot_leave", "the owner hands over the club first"]
      dropMember(s, r, r.pubkey, "left")
      return null

    case "club.remove": {
      const c = r.content
      if (!manager) return ["not_authorized", "only the owner or an admin removes members"]
      const waiting = pending(s, c.member, c.prev)
      const target = s.members[c.member] ?? (waiting ? { role: "member" as ClubRole, head: waiting.event } : undefined)
      if (!target) return ["not_member", "not a member"]
      if (target.role === "owner" || (target.role === "admin" && role !== "owner")) return ["not_authorized", "this member outranks the author"]
      if (c.prev !== target.head) return stale(c.prev, "the member was changed meanwhile")
      if (target.role === "admin" && c.info === undefined) return ADMIN_PIN_MISSING
      if (waiting) {
        const problem = admit(s, r, waiting)
        if (problem) return problem
      }
      dropMember(s, r, c.member, "removed", c.reason)
      if (target.role === "admin") ctx.demotions.push({ from: c.member, end: r, subject: "info", head: c.info as string })
      return null
    }

    case "club.role": {
      const c = r.content
      if (!manager) return ["not_authorized", "only the owner or an admin gives roles"]
      const waiting = pending(s, c.member, c.prev)
      const target = s.members[c.member] ?? (waiting ? { role: "member" as ClubRole, head: waiting.event } : undefined)
      if (!target) return ["not_member", "not a member"]
      if (target.role === "owner") return ["not_authorized", "ownership changes only by handover"]
      if (role === "admin" && (target.role === "admin" || c.role === "admin")) return ["not_authorized", "only the owner appoints or changes admins"]
      if (c.prev !== target.head) return stale(c.prev, "the member was changed meanwhile")
      const demotes = target.role === "admin" && c.role !== "admin"
      if (demotes && c.info === undefined) return ADMIN_PIN_MISSING
      if (waiting) {
        const problem = admit(s, r, waiting)
        if (problem) return problem
      }
      const member = s.members[c.member]
      member.role = c.role
      member.head = r.id
      setRole(s, r, c.member, c.role)
      if (demotes) ctx.demotions.push({ from: c.member, end: r, subject: "info", head: c.info as string })
      return null
    }

    case "club.owner.offer": {
      const c = r.content
      if (role !== "owner") return ["not_authorized", "only the owner offers ownership"]
      if (c.prev !== s.heads.owner) return stale(c.prev, "ownership was changed meanwhile")
      // Offering ownership to someone with a waiting request accepts it, like a role change.
      const waiting = s.members[c.to] ? undefined : s.requests[c.to]
      if ((!s.members[c.to] && !waiting) || c.to === r.pubkey) return ["not_member", "ownership goes to another member"]
      if (waiting) {
        const problem = admit(s, r, waiting)
        if (problem) return problem
      }
      s.offer = { event: r.id, to: c.to, at: r.created_at }
      s.heads.owner = r.id
      return null
    }

    case "club.owner.cancel":
      if (role !== "owner") return ["not_authorized", "only the owner withdraws the offer"]
      if (!s.offer || s.offer.event !== r.content.offer) return ["no_open_offer", "no such open offer"]
      s.offer = null
      s.heads.owner = r.id
      return null

    case "club.owner.accept": {
      if (!s.offer || s.offer.event !== r.content.offer) return ["no_open_offer", "no such open offer"]
      if (r.pubkey !== s.offer.to) return ["not_authorized", "the offer is for someone else"]
      const next = s.members[r.pubkey]
      if (!next) return ["not_member", "no longer a member"]
      const previous = s.members[s.owner]
      if (previous) {
        previous.role = "admin"
        previous.head = r.id
        setRole(s, r, previous.pubkey, "admin")
      }
      next.role = "owner"
      next.head = r.id
      setRole(s, r, r.pubkey, "owner")
      s.owner = r.pubkey
      s.offer = null
      s.heads.owner = r.id
      return null
    }

    case "club.keys":
      // Changes no state: the keys only open records whose own signature and authority are
      // checked like any other (seal.ts openSealedEvents).
      if (!manager) return ["not_authorized", "only the owner or an admin shares access"]
      s.shares.push({ event: r.id, by: r.pubkey, at: r.created_at, count: r.content.keys.length })
      return null

    case "club.season": {
      const c = r.content
      if (!manager) return ["not_authorized", "only the owner or an admin sets up seasons"]
      if (s.seasons[c.season]) return ["season_exists", "season id already used"]
      s.seasons[c.season] = {
        id: c.season,
        name: c.name,
        starts: c.starts,
        ...(c.ends !== undefined ? { ends: c.ends } : {}),
        ended: false,
        versions: [{ version: 1, rules: c.rules, event: r.id, at: r.created_at }],
      }
      return null
    }

    case "club.season.rules": {
      const c = r.content
      const season = s.seasons[c.season]
      if (!manager) return ["not_authorized", "only the owner or an admin changes season rules"]
      if (!season) return ["season_unknown", "no such season"]
      if (season.ended) return ["season_ended", "the season has ended"]
      if (c.version !== season.versions.length + 1) return ["season_version_mismatch", `expected version ${season.versions.length + 1}`]
      if (r.created_at >= season.starts && !c.reason) return ["rules_change_needs_reason", "a change after the start needs a visible reason"]
      season.versions.push({ version: c.version, rules: c.rules, event: r.id, at: r.created_at, ...(c.reason ? { reason: c.reason } : {}) })
      return null
    }

    case "club.season.end": {
      const season = s.seasons[r.content.season]
      if (!manager) return ["not_authorized", "only the owner or an admin ends seasons"]
      if (!season) return ["season_unknown", "no such season"]
      if (season.ended) return ["season_ended", "the season has ended"]
      season.ended = true
      return null
    }

    case "club.result": {
      const c = r.content
      if (!leader) return ["not_authorized", "only the owner, an admin or a director decides results"]
      const season = s.seasons[c.season]
      if (!season) return ["season_unknown", "no such season"]
      if (season.ended) return ["season_ended", "the season has ended"]
      const before = s.results[c.season]?.[c.match]
      if (c.prev !== (before?.event ?? s.id)) return stale(c.prev, "the result was decided meanwhile")
      ;(s.results[c.season] ??= {})[c.match] = {
        season: c.season,
        match: c.match,
        result: c.result,
        count: c.count,
        ...(c.reason ? { reason: c.reason } : {}),
        event: r.id,
        by: r.pubkey,
        at: r.created_at,
      }
      return null
    }

    case "club.date": {
      const c = r.content
      if (!leader) return ["not_authorized", "only the owner, an admin or a director plans dates"]
      const before = s.dates[c.date]
      if (c.prev !== (before?.head ?? s.id)) return stale(c.prev, "the date was changed meanwhile")
      s.dates[c.date] = {
        id: c.date,
        title: c.title,
        starts: c.starts,
        ...(c.ends !== undefined ? { ends: c.ends } : {}),
        ...(c.place ? { place: c.place } : {}),
        ...(c.note ? { note: c.note } : {}),
        cancelled: c.cancelled === true,
        by: r.pubkey,
        at: r.created_at,
        head: r.id,
      }
      return null
    }

    default:
      return ["wrong_root", `${r.type} is not a club record`]
  }
}

function request(s: ClubState, r: AnyRecord, check: JoinRequest["check"], invite?: string) {
  s.requests[r.pubkey] = { event: r.id, pubkey: r.pubkey, at: r.created_at, check, ...(invite ? { invite } : {}) }
}

function join(s: ClubState, r: BlueLineRecord<"club.join">, ctx: Context): Problem {
  const c = r.content
  if (s.members[r.pubkey]) return ["already_member", "already a member"]
  if (s.requests[r.pubkey]) return ["duplicate", "a request is already waiting"]
  if (!c.invite) {
    request(s, r, "none")
    return null
  }

  const invite = s.invites[c.invite]
  if (!invite) {
    const at = ctx.datedAt.get(c.invite)
    if (at !== undefined && at >= r.created_at) return ["invite_unknown", "dated before the invite it names"]
    if (ctx.parsed.has(c.invite)) return ["invite_unknown", "the invite it names is not valid"]
    // This reader cannot open the invite (sealed for others, or not loaded yet).
    request(s, r, "unverified", c.invite)
    return null
  }
  if (!verifyInviteProof(invite.key, r.pubkey, c.proof as string)) return ["invite_proof_invalid", "the proof is not for this key"]
  if (invite.revoked) return ["invite_revoked", "the invite was ended"]
  if (r.created_at > invite.expires) return ["invite_expired", "the invite has expired"]
  const gone = s.former[r.pubkey]
  if (gone?.how === "removed" && invite.at <= gone.at) return ["removed_requires_new_invite", "removed members need an invite made after their removal"]

  if (invite.kind === "personal") {
    if (invite.uses.length > 0) return ["invite_exhausted", "the personal invite was used"]
    request(s, r, "ok", invite.id)
    return null
  }
  // A group link admits at once, unless a member limit makes it a question of order: then an
  // owner or admin decides (docs/decisions/0001, point 10). A closed club's own limit
  // (MAX_CLUB_MEMBERS) counts once it is reached.
  if (s.info.capacity !== undefined || full(s)) {
    request(s, r, "ok", invite.id)
    return null
  }
  invite.uses.push({ pubkey: r.pubkey, event: r.id, at: r.created_at })
  addMember(s, r, r.pubkey, "group", r.id)
  return null
}
