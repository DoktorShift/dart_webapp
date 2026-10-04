import type { ClubRole } from "./club.ts"
import type { Reason } from "./reasons.ts"
import type { AnyRecord, BlueLineRecord, ContentOf } from "./records.ts"
import type { FoundingProblem, ReplayLog, ReplayOptions } from "./replay.ts"
import { applied, foundingProblem, prepare, reject } from "./replay.ts"
import type { TournamentPhase } from "./tournament.ts"
import { drawOrder, seedCommitment, TOURNAMENT_ENGINE } from "./tournament.ts"

// Tournament state from the founding and all changes (docs/protocol/families/tournament.md).
// The organizer decides; boards submit results for the slots assigned to them; players ask for
// a place, check in, withdraw and claim guest places. Every change is checked against the
// author's role at that point of the replay.
//
// Players choose their own created_at, so nothing they write decides admission, capacity or
// order (docs/decisions/0001, point 10): a registration waits until the organizer admits it or
// puts it on the waiting list, and the draw fixes the field itself. A player's late check-in
// or withdrawal can therefore never make the organizer's draw invalid. Pairings are the
// tournament engine's: it reads `draw.order` and the approved results; `dependents` lets it
// mark slots a correction affects.

export type ParticipantStatus = "pending" | "registered" | "waitlist" | "withdrawn" | "removed"

export interface Participant {
  id: string
  kind: "player" | "guest"
  alias?: string
  // Guests: true when they agreed to be shown under this name (docs/protocol/privacy.md).
  named?: boolean
  status: ParticipantStatus
  // The organizer admitted this place at some point (stays true after a withdrawal).
  admitted: boolean
  checkedIn: boolean
  // When the player asked (their own clock; shown, never used for order).
  at: number
  // Registered after the announced registration deadline (by the player's clock).
  late?: boolean
  // When the organizer put the place on the waiting list: the list's order.
  waitlistAt?: number
  // The organizer's last decision about this place (or the first registration): the base the
  // next decision names as `prev`. Only organizer records move it.
  head: string
  // A guest place linked to the player who claimed it.
  player?: string
  claims?: string[]
  reason?: string
}

export interface Board {
  id: string
  name: string
  key: string
  active: boolean
  head: string
}

export interface Submission {
  event: string
  by: string
  at: number
  winner: string | null
  score: number[]
  walkover?: "noShow" | "retired"
  match?: string
  result?: string
}

export interface SlotState {
  slot: string
  board?: string
  head: string
  submissions: Submission[]
  approved: { event: string; winner: string | null; score: number[]; walkover?: "noShow" | "retired"; at: number; corrected: boolean; reason?: string } | null
  // A correction of an earlier result changed what this slot depends on.
  affected: boolean
}

export interface TournamentState {
  id: string
  founder: string
  organizer: string
  // The club that runs it; `verified` when the founder's club role was checked (clubRole).
  club?: { id: string; verified: boolean }
  settings: ContentOf<"tournament.found">
  phase: TournamentPhase
  participants: Record<string, Participant>
  seedCommit: string | null
  draw: { seed: string; seeded: string[]; order: string[]; event: string; at: number } | null
  draws: number
  boards: Record<string, Board>
  slots: Record<string, SlotState>
  offer: { event: string; to: string; at: number } | null
  heads: { core: string; organizer: string }
  log: ReplayLog
}

export type TournamentResult = { state: TournamentState } | { state: null; problem: FoundingProblem }

export interface TournamentOptions extends ReplayOptions {
  // Slots whose pairing depends on the given slot's result (from the tournament engine).
  dependents?: (slot: string, state: TournamentState) => string[]
  // For a club's tournament: the role a key held in that club at a time (club-state.ts
  // clubRoleAt). Founding and taking over the organization need owner, admin or director.
  clubRole?: (pubkey: string, at: number) => ClubRole | null
}

type Problem = [Reason, string] | null

const BEFORE_DRAW: readonly TournamentPhase[] = ["registration", "checkin"]
const PLAYING: readonly TournamentPhase[] = ["running", "paused"]
const NEXT_PHASE: Record<TournamentPhase, readonly TournamentPhase[]> = {
  registration: ["checkin", "cancelled"],
  checkin: ["cancelled"],
  drawn: ["running", "cancelled"],
  running: ["paused", "finished", "cancelled"],
  paused: ["running", "cancelled"],
  finished: [],
  cancelled: [],
}
const CLUB_LEADERS: readonly (ClubRole | null)[] = ["owner", "admin", "director"]

export function reduceTournament(events: readonly unknown[], tournamentId: string, opts: TournamentOptions = {}): TournamentResult {
  const { records, log, founding } = prepare(events, tournamentId, opts)
  if (!founding || founding.type !== "tournament.found")
    return { state: null, problem: founding ? "invalid" : foundingProblem(log, tournamentId) }
  const f = founding.content
  // Bracket rules of a newer engine are kept, never run with today's rules.
  if (f.engine !== TOURNAMENT_ENGINE) return { state: null, problem: "unknown_version" }
  if (f.club && opts.clubRole && !CLUB_LEADERS.includes(opts.clubRole(founding.pubkey, founding.created_at))) {
    reject(log, founding, "not_authorized", "only the club's owner, an admin or a director founds its tournaments")
    return { state: null, problem: "not_authorized" }
  }

  const s: TournamentState = {
    id: tournamentId,
    founder: founding.pubkey,
    organizer: founding.pubkey,
    ...(f.club ? { club: { id: f.club, verified: opts.clubRole !== undefined } } : {}),
    settings: { ...f },
    phase: "registration",
    participants: {},
    seedCommit: f.seedCommit ?? null,
    draw: null,
    draws: 0,
    boards: {},
    slots: {},
    offer: null,
    heads: { core: founding.id, organizer: founding.id },
    log,
  }
  applied(log, founding)

  for (const r of records) {
    if (r === founding) continue
    if (r.created_at < founding.created_at) {
      reject(log, r, "before_founding", "dated before the tournament was founded")
      continue
    }
    const problem = apply(s, r, opts)
    if (problem) reject(log, r, problem[0], problem[1])
    else applied(log, r)
  }
  return { state: s }
}

const admittedCount = (s: TournamentState) => Object.values(s.participants).filter((p) => p.status === "registered").length
const hasRoom = (s: TournamentState) => admittedCount(s) < s.settings.capacity
const headOf = (s: TournamentState, subject: { head: string } | undefined) => subject?.head ?? s.id

// The waiting list in the organizer's order.
export const waitingList = (s: TournamentState) =>
  Object.values(s.participants)
    .filter((p) => p.status === "waitlist")
    .sort((a, b) => (a.waitlistAt as number) - (b.waitlistAt as number) || (a.head < b.head ? -1 : 1))

function apply(s: TournamentState, r: AnyRecord, opts: TournamentOptions): Problem {
  const organizer = r.pubkey === s.organizer
  const closed = s.phase === "finished" || s.phase === "cancelled"
  // Guest places can still be linked to their players after the end.
  if (closed && r.type !== "tournament.claim" && r.type !== "tournament.link") return ["phase_invalid", `the tournament is ${s.phase}`]
  const notOrganizer: Problem = ["not_authorized", "only the organizer decides this"]

  switch (r.type) {
    case "tournament.found":
      return ["wrong_root", "a second founding"]

    case "tournament.update": {
      const { prev, picture, registrationCloses, ...rest } = r.content
      if (!organizer) return notOrganizer
      if (prev !== s.heads.core) return ["stale_predecessor", "the tournament was changed meanwhile"]
      if ((rest.rules !== undefined || rest.final !== undefined) && !BEFORE_DRAW.includes(s.phase)) return ["rules_locked", "rules are fixed once drawn"]
      if (rest.capacity !== undefined && rest.capacity < admittedCount(s)) return ["tournament_full", "more players are admitted than the new capacity"]
      Object.assign(s.settings, rest)
      if (picture !== undefined) {
        if (picture === null) delete s.settings.picture
        else s.settings.picture = picture
      }
      if (registrationCloses !== undefined) {
        if (registrationCloses === null) delete s.settings.registrationCloses
        else s.settings.registrationCloses = registrationCloses
      }
      s.heads.core = r.id
      return null
    }

    case "tournament.phase": {
      const c = r.content
      if (!organizer) return notOrganizer
      if (c.prev !== s.heads.core) return ["stale_predecessor", "the tournament was changed meanwhile"]
      if (!NEXT_PHASE[s.phase].includes(c.phase)) return ["phase_invalid", `${s.phase} cannot go to ${c.phase}`]
      if (c.phase === "checkin" && !s.settings.checkIn) return ["phase_invalid", "this tournament has no check-in"]
      s.phase = c.phase
      s.heads.core = r.id
      return null
    }

    case "tournament.seed": {
      const c = r.content
      if (!organizer) return notOrganizer
      if (c.prev !== s.heads.core) return ["stale_predecessor", "the tournament was changed meanwhile"]
      if (![...BEFORE_DRAW, "drawn"].includes(s.phase)) return ["phase_invalid", "the draw is over"]
      s.seedCommit = c.commit
      s.heads.core = r.id
      return null
    }

    case "tournament.draw":
      return draw(s, r)

    case "tournament.register": {
      if (!BEFORE_DRAW.includes(s.phase)) return ["registration_closed", "the field is drawn"]
      const existing = s.participants[r.pubkey]
      if (existing && existing.status !== "withdrawn") {
        return existing.status === "removed" ? ["not_authorized", "taken out by the organizer"] : ["already_registered", "already registered"]
      }
      const late = s.settings.registrationCloses !== undefined && r.created_at > s.settings.registrationCloses
      s.participants[r.pubkey] = {
        id: r.pubkey,
        kind: "player",
        ...(r.content.alias ? { alias: r.content.alias } : {}),
        status: "pending",
        admitted: existing?.admitted ?? false,
        checkedIn: false,
        at: r.created_at,
        ...(late ? { late: true } : {}),
        // A new registration after a withdrawal keeps the organizer's chain of decisions.
        head: existing?.head ?? r.id,
      }
      return null
    }

    case "tournament.withdraw": {
      const p = s.participants[r.pubkey]
      if (!p || p.status === "withdrawn" || p.status === "removed") return ["not_registered", "not taking part"]
      // The player's own records never move `head`: the organizer's decisions about this place
      // keep their base however the player dates a withdrawal.
      p.status = "withdrawn"
      p.checkedIn = false
      if (r.content.reason) p.reason = r.content.reason
      return null
    }

    case "tournament.admit": {
      const c = r.content
      const p = s.participants[c.participant]
      if (!organizer) return notOrganizer
      if (!BEFORE_DRAW.includes(s.phase)) return ["phase_invalid", "the field is fixed once drawn"]
      if (!p) return ["not_registered", "not registered"]
      if (c.prev !== p.head) return ["stale_predecessor", "the participant was changed meanwhile"]
      if (p.status === "registered") return ["already_registered", "already admitted"]
      if (p.status !== "pending" && p.status !== "waitlist") return ["not_registered", "only a waiting registration is admitted"]
      if (!hasRoom(s)) return ["tournament_full", "the tournament is full"]
      p.status = "registered"
      p.admitted = true
      delete p.waitlistAt
      p.head = r.id
      return null
    }

    case "tournament.waitlist": {
      const c = r.content
      const p = s.participants[c.participant]
      if (!organizer) return notOrganizer
      if (!s.settings.waitlist) return ["invalid_content", "this tournament has no waiting list"]
      if (!BEFORE_DRAW.includes(s.phase)) return ["phase_invalid", "the field is fixed once drawn"]
      if (!p) return ["not_registered", "not registered"]
      if (c.prev !== p.head) return ["stale_predecessor", "the participant was changed meanwhile"]
      if (p.status !== "registered" && p.status !== "pending") return ["not_registered", "only an admitted or waiting registration moves to the list"]
      p.status = "waitlist"
      p.waitlistAt = r.created_at
      p.checkedIn = false
      p.head = r.id
      return null
    }

    case "tournament.remove": {
      const c = r.content
      const p = s.participants[c.participant]
      if (!organizer) return notOrganizer
      if (!p || p.status === "removed") return ["not_registered", "not taking part"]
      if (c.prev !== p.head) return ["stale_predecessor", "the participant was changed meanwhile"]
      p.status = "removed"
      p.checkedIn = false
      p.reason = c.reason
      p.head = r.id
      return null
    }

    case "tournament.guest": {
      const c = r.content
      if (!organizer) return notOrganizer
      if (!BEFORE_DRAW.includes(s.phase)) return ["phase_invalid", "the field is fixed once drawn"]
      if (s.participants[c.guest]) return ["already_registered", "guest id already used"]
      if (!hasRoom(s)) return ["tournament_full", "the tournament is full"]
      s.participants[c.guest] = {
        id: c.guest,
        kind: "guest",
        alias: c.alias,
        ...(c.named ? { named: true } : {}),
        status: "registered",
        admitted: true,
        checkedIn: false,
        at: r.created_at,
        head: r.id,
      }
      return null
    }

    case "tournament.claim": {
      const p = s.participants[r.content.guest]
      if (!p || p.kind !== "guest") return ["guest_unknown", "no such guest place"]
      if (p.player) return ["not_authorized", "the place is already linked"]
      p.claims = [...new Set([...(p.claims ?? []), r.pubkey])]
      return null
    }

    case "tournament.link": {
      const c = r.content
      const p = s.participants[c.guest]
      if (!organizer) return notOrganizer
      if (!p || p.kind !== "guest") return ["guest_unknown", "no such guest place"]
      if (c.prev !== p.head) return ["stale_predecessor", "the participant was changed meanwhile"]
      if (!p.claims?.includes(c.player)) return ["not_authorized", "the player has not claimed this place"]
      if (Object.values(s.participants).some((q) => q.player === c.player || (q.id === c.player && q.status !== "withdrawn")))
        return ["already_registered", "the player already has a place"]
      p.player = c.player
      p.head = r.id
      return null
    }

    case "tournament.checkin": {
      const c = r.content
      if (s.phase !== "checkin") return ["phase_invalid", "check-in is not open"]
      const id = c.participant ?? r.pubkey
      const p = s.participants[id]
      if (c.participant !== undefined && !organizer) return notOrganizer
      if (!p || p.status !== "registered") return ["not_registered", "not admitted"]
      if (c.prev !== undefined && c.prev !== p.head) return ["stale_predecessor", "the participant was changed meanwhile"]
      p.checkedIn = true
      if (c.prev !== undefined) p.head = r.id
      return null
    }

    case "tournament.board": {
      const c = r.content
      if (!organizer) return notOrganizer
      if (c.prev !== headOf(s, s.boards[c.board])) return ["stale_predecessor", "the board was changed meanwhile"]
      s.boards[c.board] = { id: c.board, name: c.name, key: c.key, active: true, head: r.id }
      return null
    }

    case "tournament.board.revoke": {
      const c = r.content
      const board = s.boards[c.board]
      if (!organizer) return notOrganizer
      if (!board || !board.active) return ["board_unknown", "no such active board"]
      if (c.prev !== board.head) return ["stale_predecessor", "the board was changed meanwhile"]
      board.active = false
      board.head = r.id
      return null
    }

    case "tournament.assign": {
      const c = r.content
      if (!organizer) return notOrganizer
      if (!["drawn", ...PLAYING].includes(s.phase)) return ["phase_invalid", "boards are assigned after the draw"]
      if (!s.boards[c.board]?.active) return ["board_unknown", "no such active board"]
      const slot = slotOf(s, c.slot)
      if (c.prev !== slot.head) return ["stale_predecessor", "the slot was changed meanwhile"]
      if (slot.approved) return ["already_approved", "the slot has a result"]
      slot.board = c.board
      slot.head = r.id
      return null
    }

    case "tournament.result":
      return submit(s, r)

    case "tournament.approve": {
      const c = r.content
      const slot = s.slots[c.slot]
      if (!organizer) return notOrganizer
      const submission = slot?.submissions.find((x) => x.event === c.submission)
      if (!slot || !submission) return ["result_unknown", "no such submitted result"]
      if (slot.approved) return ["already_approved", "use a correction to change an approved result"]
      if (c.prev !== slot.head) return ["stale_predecessor", "the slot was changed meanwhile"]
      slot.approved = {
        event: r.id,
        winner: submission.winner,
        score: submission.score,
        ...(submission.walkover ? { walkover: submission.walkover } : {}),
        at: r.created_at,
        corrected: false,
      }
      slot.head = r.id
      return null
    }

    case "tournament.correct": {
      const c = r.content
      const slot = s.slots[c.slot]
      if (!organizer) return notOrganizer
      if (!slot?.approved) return ["result_unknown", "only an approved result is corrected"]
      if (c.prev !== slot.head) return ["stale_predecessor", "the slot was changed meanwhile"]
      if (c.winner !== null && !s.participants[c.winner]) return ["not_registered", "the winner is not in the tournament"]
      slot.approved = { event: r.id, winner: c.winner, score: c.score, at: r.created_at, corrected: true, reason: c.reason }
      slot.head = r.id
      // Matches built on the old result are marked, never silently re-paired.
      for (const dependent of opts.dependents?.(c.slot, s) ?? []) {
        const d = s.slots[dependent]
        if (d && (d.board !== undefined || d.approved || d.submissions.length > 0)) d.affected = true
      }
      return null
    }

    case "tournament.handover.offer": {
      const c = r.content
      if (!organizer) return notOrganizer
      if (c.prev !== s.heads.organizer) return ["stale_predecessor", "the organization was changed meanwhile"]
      if (c.to === r.pubkey) return ["invalid_content", "the organizer already organizes"]
      s.offer = { event: r.id, to: c.to, at: r.created_at }
      s.heads.organizer = r.id
      return null
    }

    case "tournament.handover.cancel":
      if (!organizer) return notOrganizer
      if (!s.offer || s.offer.event !== r.content.offer) return ["no_open_offer", "no such open offer"]
      s.offer = null
      s.heads.organizer = r.id
      return null

    case "tournament.handover.accept":
      if (!s.offer || s.offer.event !== r.content.offer) return ["no_open_offer", "no such open offer"]
      if (r.pubkey !== s.offer.to) return ["not_authorized", "the offer is for someone else"]
      if (s.club && opts.clubRole && !CLUB_LEADERS.includes(opts.clubRole(r.pubkey, r.created_at)))
        return ["not_authorized", "a club's tournament is organized by its owner, an admin or a director"]
      s.organizer = r.pubkey
      s.offer = null
      s.heads.organizer = r.id
      return null

    default:
      return ["wrong_root", `${r.type} is not a tournament record`]
  }
}

function slotOf(s: TournamentState, slot: string): SlotState {
  if (!s.slots[slot]) s.slots[slot] = { slot, head: s.id, submissions: [], approved: null, affected: false }
  return s.slots[slot]
}

// The draw fixes the field: it is the organizer's decision who plays, in the order that follows
// from the revealed seed. Only the organizer's own records can contradict it (a place taken out
// or never registered); whatever players write, however they date it, cannot. Check-in is the
// organizer's aid, not a condition here.
function draw(s: TournamentState, r: BlueLineRecord<"tournament.draw">): Problem {
  const c = r.content
  if (r.pubkey !== s.organizer) return ["not_authorized", "only the organizer draws"]
  if (c.prev !== s.heads.core) return ["stale_predecessor", "the tournament was changed meanwhile"]
  const allowed: TournamentPhase[] = s.settings.checkIn ? ["checkin", "drawn"] : ["registration", "drawn"]
  if (!allowed.includes(s.phase)) return ["phase_invalid", `no draw while ${s.phase}`]
  if (!s.seedCommit) return ["seed_not_committed", "a draw opens an earlier seed commitment"]
  if (seedCommitment(c.seed) !== s.seedCommit) return ["seed_mismatch", "the seed does not open the commitment"]
  if (c.order.length > s.settings.capacity) return ["draw_mismatch", "more in the field than places"]
  for (const id of c.order) {
    const p = s.participants[id]
    if (!p) return ["draw_mismatch", "the field holds someone who never registered"]
    if (p.status === "removed") return ["draw_mismatch", "the field holds someone the organizer took out"]
  }
  if (c.seeded.some((id) => !c.order.includes(id))) return ["draw_mismatch", "a seeded player is not in the field"]
  const expected = drawOrder(c.seed, c.order, c.seeded)
  if (expected.some((id, i) => c.order[i] !== id)) return ["draw_mismatch", "the order does not follow from the seed"]

  s.draw = { seed: c.seed, seeded: c.seeded, order: c.order, event: r.id, at: r.created_at }
  s.draws++
  // A commitment opens one draw; a new draw needs a new one.
  s.seedCommit = null
  s.phase = "drawn"
  s.heads.core = r.id
  return null
}

function submit(s: TournamentState, r: BlueLineRecord<"tournament.result">): Problem {
  const c = r.content
  if (!PLAYING.includes(s.phase)) return ["phase_invalid", "results come in while the tournament runs"]
  const slot = slotOf(s, c.slot)
  const byOrganizer = r.pubkey === s.organizer
  if (!byOrganizer) {
    const board = slot.board ? s.boards[slot.board] : undefined
    if (!Object.values(s.boards).some((b) => b.active && b.key === r.pubkey)) return ["not_authorized", "not an authorized board"]
    if (!board || !board.active || board.key !== r.pubkey) return ["board_not_assigned", "the slot is assigned to another board"]
  }
  if (slot.approved) return ["already_approved", "the slot has an approved result"]
  if (c.winner !== null && !s.participants[c.winner]) return ["not_registered", "the winner is not in the tournament"]
  const submission: Submission = {
    event: r.id,
    by: r.pubkey,
    at: r.created_at,
    winner: c.winner,
    score: c.score,
    ...(c.walkover ? { walkover: c.walkover } : {}),
    ...(c.match ? { match: c.match } : {}),
    ...(c.result ? { result: c.result } : {}),
  }
  slot.submissions.push(submission)
  if (byOrganizer || s.settings.approval === "board") {
    slot.approved = { event: r.id, winner: c.winner, score: c.score, ...(c.walkover ? { walkover: c.walkover } : {}), at: r.created_at, corrected: false }
    slot.head = r.id
  }
  return null
}
