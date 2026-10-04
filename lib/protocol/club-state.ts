import type { ClubRole, SeasonRules } from "./club.ts"
import { verifyInviteProof } from "./invite.ts"
import type { AnyRecord, BlueLineRecord } from "./records.ts"
import type { FoundingProblem, ReplayLog, ReplayOptions } from "./replay.ts"
import { applied, foundingProblem, prepare, reject } from "./replay.ts"

// Club state from the founding and all changes (docs/protocol/families/club.md and
// permissions.md). Each change is checked against its author's role at that point of the
// replay; a change that fails is kept in `rejected` with the reason and changes nothing.

export interface ClubMember {
  pubkey: string
  role: ClubRole
  since: number
  via: "founder" | "invite" | "request"
  // Last change of this member (join, acceptance, role): the base a role change or removal
  // must name as `prev`.
  head: string
}

export interface ClubInvite {
  id: string
  event: string
  by: string
  at: number
  expires: number
  maxUses: number
  uses: { pubkey: string; event: string; at: number }[]
  revoked: boolean
}

export interface JoinRequest {
  event: string
  pubkey: string
  at: number
  message?: string
  // The invite named by a join this reader could not check (invite unknown or unreadable).
  invite?: string
}

export interface ClubSeason {
  id: string
  name: string
  starts: number
  ends?: number
  ended: boolean
  versions: { version: number; rules: SeasonRules; event: string; at: number; reason?: string }[]
}

export interface ClubState {
  id: string
  founder: string
  owner: string
  info: { name: string; about?: string; picture?: string; visibility: "closed" | "public"; capacity?: number; archived: boolean }
  // Current club key and every key the club had (epoch 0 = founding).
  key: { epoch: number; pubkey: string }
  keys: { epoch: number; pubkey: string; event: string; at: number }[]
  members: Record<string, ClubMember>
  invites: Record<string, ClubInvite>
  requests: Record<string, JoinRequest>
  former: Record<string, { how: "left" | "removed"; event: string; at: number; by: string; reason?: string }>
  offer: { event: string; to: string; at: number } | null
  seasons: Record<string, ClubSeason>
  heads: { info: string; owner: string }
  log: ReplayLog
}

export type ClubResult = { state: ClubState } | { state: null; problem: FoundingProblem }

const MANAGERS: readonly ClubRole[] = ["owner", "admin"]

export function reduceClub(events: readonly unknown[], clubId: string, opts: ReplayOptions = {}): ClubResult {
  const { records, log, founding } = prepare(events, clubId, opts)
  if (!founding || founding.type !== "club.found") return { state: null, problem: founding ? "invalid" : foundingProblem(log, clubId) }

  const f = founding.content
  const s: ClubState = {
    id: clubId,
    founder: founding.pubkey,
    owner: founding.pubkey,
    info: { name: f.name, about: f.about, picture: f.picture, visibility: f.visibility, capacity: f.capacity, archived: false },
    key: { epoch: 0, pubkey: f.key },
    keys: [{ epoch: 0, pubkey: f.key, event: founding.id, at: founding.created_at }],
    members: { [founding.pubkey]: { pubkey: founding.pubkey, role: "owner", since: founding.created_at, via: "founder", head: founding.id } },
    invites: {},
    requests: {},
    former: {},
    offer: null,
    seasons: {},
    heads: { info: founding.id, owner: founding.id },
    log,
  }
  applied(log, founding)
  // Invite tokens stay beside the state: they are link secrets and must never end up in a
  // view model, export or log by accident.
  const tokens: Record<string, string> = {}

  for (const r of records) {
    if (r === founding) continue
    if (r.created_at < founding.created_at) {
      reject(log, r, "before_founding", "dated before the club was founded")
      continue
    }
    const problem = apply(s, r, tokens)
    if (problem) reject(log, r, problem[0], problem[1])
    else applied(log, r)
  }
  return { state: s }
}

type Problem = [Parameters<typeof reject>[2], string] | null

const roleOf = (s: ClubState, pubkey: string): ClubRole | null => s.members[pubkey]?.role ?? null
const memberCount = (s: ClubState) => Object.keys(s.members).length
const full = (s: ClubState) => s.info.capacity !== undefined && memberCount(s) >= s.info.capacity

function addMember(s: ClubState, r: AnyRecord, pubkey: string, via: ClubMember["via"]) {
  s.members[pubkey] = { pubkey, role: "member", since: r.created_at, via, head: r.id }
  delete s.requests[pubkey]
  delete s.former[pubkey]
}

function dropMember(s: ClubState, r: AnyRecord, pubkey: string, how: "left" | "removed", reason?: string) {
  delete s.members[pubkey]
  s.former[pubkey] = { how, event: r.id, at: r.created_at, by: r.pubkey, ...(reason ? { reason } : {}) }
  if (s.offer?.to === pubkey) s.offer = null
}

function apply(s: ClubState, r: AnyRecord, tokens: Record<string, string>): Problem {
  const role = roleOf(s, r.pubkey)
  const manager = role !== null && MANAGERS.includes(role)
  const archivedBlocks = ["club.invite", "club.join", "club.accept", "club.season", "club.season.rules"]
  if (s.info.archived && archivedBlocks.includes(r.type)) return ["club_archived", "the club is archived"]

  switch (r.type) {
    case "club.found":
      return ["wrong_root", "a second founding"]

    case "club.update": {
      const c = r.content
      if (!manager) return ["not_authorized", "only the owner or an admin edits the club"]
      if ((c.visibility !== undefined || c.archived !== undefined) && role !== "owner") return ["not_authorized", "only the owner changes visibility or archives"]
      if (c.prev !== s.heads.info) return ["stale_predecessor", "the club was changed meanwhile"]
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
      if (s.invites[c.invite]) return ["invalid_content", "invite id already used"]
      s.invites[c.invite] = { id: c.invite, event: r.id, by: r.pubkey, at: r.created_at, expires: c.expires, maxUses: c.maxUses, uses: [], revoked: false }
      tokens[c.invite] = c.token
      return null
    }

    case "club.invite.revoke": {
      if (!manager) return ["not_authorized", "only the owner or an admin ends invites"]
      const invite = s.invites[r.content.invite]
      if (!invite) return ["invite_unknown", "no such invite"]
      invite.revoked = true
      return null
    }

    case "club.join":
      return join(s, r, tokens[r.content.invite ?? ""])

    case "club.accept": {
      const c = r.content
      if (!manager) return ["not_authorized", "only the owner or an admin accepts"]
      if (s.members[c.member]) return ["already_member", "already a member"]
      const request = s.requests[c.member]
      if (!request || request.event !== c.request) return ["request_unknown", "no such waiting request"]
      if (full(s)) return ["club_full", "the club is full"]
      addMember(s, r, c.member, "request")
      return null
    }

    case "club.decline": {
      if (!manager) return ["not_authorized", "only the owner or an admin declines"]
      const entry = Object.values(s.requests).find((q) => q.event === r.content.request)
      if (!entry) return ["request_unknown", "no such waiting request"]
      delete s.requests[entry.pubkey]
      return null
    }

    case "club.leave":
      if (!role) return ["not_member", "not a member"]
      if (role === "owner") return ["owner_cannot_leave", "the owner hands over the club first"]
      dropMember(s, r, r.pubkey, "left")
      return null

    case "club.remove": {
      const c = r.content
      const target = s.members[c.member]
      if (!manager) return ["not_authorized", "only the owner or an admin removes members"]
      if (!target) return ["not_member", "not a member"]
      if (target.role === "owner" || (target.role === "admin" && role !== "owner")) return ["not_authorized", "this member outranks the author"]
      if (c.prev !== target.head) return ["stale_predecessor", "the member was changed meanwhile"]
      dropMember(s, r, c.member, "removed", c.reason)
      return null
    }

    case "club.role": {
      const c = r.content
      const target = s.members[c.member]
      if (!manager) return ["not_authorized", "only the owner or an admin gives roles"]
      if (!target) return ["not_member", "not a member"]
      if (target.role === "owner") return ["not_authorized", "ownership changes only by handover"]
      if (role === "admin" && (target.role === "admin" || c.role === "admin")) return ["not_authorized", "only the owner appoints or changes admins"]
      if (c.prev !== target.head) return ["stale_predecessor", "the member was changed meanwhile"]
      target.role = c.role
      target.head = r.id
      return null
    }

    case "club.owner.offer": {
      const c = r.content
      if (role !== "owner") return ["not_authorized", "only the owner offers ownership"]
      if (c.prev !== s.heads.owner) return ["stale_predecessor", "ownership was changed meanwhile"]
      if (!s.members[c.to] || c.to === r.pubkey) return ["not_member", "ownership goes to another member"]
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
      }
      next.role = "owner"
      next.head = r.id
      s.owner = r.pubkey
      s.offer = null
      s.heads.owner = r.id
      return null
    }

    case "club.key": {
      const c = r.content
      if (role !== "owner") return ["not_authorized", "only the owner rotates the club key"]
      if (c.epoch !== s.key.epoch + 1) return ["epoch_mismatch", `expected epoch ${s.key.epoch + 1}`]
      s.key = { epoch: c.epoch, pubkey: c.key }
      s.keys.push({ epoch: c.epoch, pubkey: c.key, event: r.id, at: r.created_at })
      return null
    }

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

    default:
      return ["wrong_root", `${r.type} is not a club record`]
  }
}

function join(s: ClubState, r: BlueLineRecord<"club.join">, token: string | undefined): Problem {
  const c = r.content
  if (s.members[r.pubkey]) return ["already_member", "already a member"]
  if (!c.invite) {
    if (s.requests[r.pubkey]) return ["duplicate", "a request is already waiting"]
    s.requests[r.pubkey] = { event: r.id, pubkey: r.pubkey, at: r.created_at, ...(c.message ? { message: c.message } : {}) }
    return null
  }

  const invite = s.invites[c.invite]
  if (!invite || !token) {
    // Not checkable here (unknown or sealed invite): it waits like a request.
    if (s.requests[r.pubkey]) return ["duplicate", "a request is already waiting"]
    s.requests[r.pubkey] = { event: r.id, pubkey: r.pubkey, at: r.created_at, invite: c.invite, ...(c.message ? { message: c.message } : {}) }
    return null
  }
  if (!verifyInviteProof(token, r.pubkey, c.proof as string)) return ["invite_proof_invalid", "the proof is not for this key"]
  if (invite.revoked) return ["invite_revoked", "the invite was ended"]
  if (r.created_at > invite.expires) return ["invite_expired", "the invite has expired"]
  const gone = s.former[r.pubkey]
  if (gone?.how === "removed" && invite.at <= gone.at) return ["removed_requires_new_invite", "removed members need an invite made after their removal"]
  // A use is a person: the same key using the same invite again is a replay.
  if (invite.uses.some((u) => u.pubkey === r.pubkey) || invite.uses.length >= invite.maxUses) return ["invite_exhausted", "the invite is used up"]
  if (full(s)) return ["club_full", "the club is full"]
  invite.uses.push({ pubkey: r.pubkey, event: r.id, at: r.created_at })
  addMember(s, r, r.pubkey, "invite")
  return null
}
