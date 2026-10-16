import { shortKey } from "../nostr/pointers.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { parseRecord, type ContentOf } from "../protocol/records.ts"
import type { FoundingProblem } from "../protocol/replay.ts"
import { isGuestId } from "../protocol/tournament.ts"
import { reduceTournament, waitingList, type Participant as Place, type TournamentState } from "../protocol/tournament-state.ts"
import {
  assignBoard,
  createTournament,
  recordResult,
  recordWalkover,
  resetMatch,
  resolveTournament,
  startMatch,
  withdraw,
  type MatchFormat,
  type MatchView,
  type Score,
  type Tournament,
  type TournamentSetup,
  type TournamentView,
} from "./engine.ts"
import type { StoredTournament } from "./store.ts"

// A tournament as a screen sees it: the records replayed (lib/protocol/tournament-state.ts:
// who is in, which results count, who organizes) and, once drawn, the engine's bracket built
// from the draw with every approved result, withdrawal, board call and live match applied
// (lib/tournaments/engine.ts: who plays whom, what is ready, tables, places). Nothing here
// talks to relays; sync.ts brings new events first.
//
// The protocol and the engine agree by construction: the draw order is the engine's seed
// order, every decision about a result enters the engine in the order it was made (the
// organizer's own result, an approval, a correction: the engine enters a correction as "the
// result again" and marks the matches built on the earlier one), and the protocol asks the
// engine (dependentSlots) which slots a correction affects.

// A live match a board founded for a slot (lib/live/follow.ts watchFoundings), by the board's key.
export interface LiveInput {
  slot: string
  match: string
  by: string
}

export interface LiveSlot {
  slot: string
  match: string
  board: string | null
}

export interface ReadOptions {
  // The reader's profile, or null for a guest.
  pubkey: string | null
  now?: number
  live?: readonly LiveInput[]
}

export interface Me {
  // The reader's place: their own registration, or a guest place linked to them.
  participant: Place | null
  organizer: boolean
  // An open offer of the organization to the reader.
  offered: boolean
}

export interface TournamentRead {
  id: string
  // null while the founding can't be read: not loaded yet, or sealed for this profile.
  state: TournamentState | null
  problem: FoundingProblem | null
  // The engine's bracket with every decision applied, once drawn.
  bracket: Tournament | null
  view: TournamentView | null
  // How each participant is shown: the alias they gave, or the start of their key.
  names: Record<string, string>
  me: Me
  live: Record<string, LiveSlot>
  // Decisions the bracket could not take as made (a winner who does not play the match, a result
  // for players the bracket no longer puts there): kept as made, a task for the organizer.
  skipped: { slot: string; why: string }[]
  relays: string[]
  loadedAt: number | null
}

export const placeName = (p: Place) => p.alias ?? shortKey(p.id)

export const isGuestPlace = (p: Pick<Place, "id">) => isGuestId(p.id)

// ---- The bracket from the draw -------------------------------------------------------------

// The engine's setup for the draw the state holds: participants in draw order (the engine's
// seeded count keeps the first ones), the rules the founding fixed.
function setupOf(state: TournamentState): TournamentSetup | null {
  const draw = state.draw
  if (!draw) return null
  const { settings } = state
  const format = (rules: { legsToWin: number; setsToWin: number }): MatchFormat => ({ legsToWin: rules.legsToWin, ...(rules.setsToWin > 1 ? { setsToWin: rules.setsToWin } : {}) })
  return {
    format: settings.format,
    participants: draw.order.map((id) => ({ id, name: state.participants[id] ? placeName(state.participants[id]) : id })),
    seeded: draw.seeded.length,
    seed: draw.seed,
    rules: { ...format(settings.rules), ...(settings.final ? { final: format(settings.final) } : {}) },
    grandFinalReset: settings.grandFinalReset,
    doubleRoundRobin: settings.doubleRoundRobin,
    ...(settings.groups ? { groups: settings.groups } : {}),
  }
}

// The bare bracket of a draw, built once per draw (a Tournament is never changed in place).
const brackets = new Map<string, Tournament | null>()
const MAX_CACHED = 8

export function bracketOf(state: TournamentState): Tournament | null {
  const key = state.draw?.event
  if (!key) return null
  if (brackets.has(key)) return brackets.get(key) ?? null
  let bracket: Tournament | null = null
  try {
    const setup = setupOf(state)
    bracket = setup ? createTournament(setup) : null
  } catch {
    // A draw the engine refuses (a field the format cannot take) shows no bracket.
  }
  if (brackets.size >= MAX_CACHED) brackets.delete(brackets.keys().next().value as string)
  brackets.set(key, bracket)
  return bracket
}

// The slots whose pairing depends on `slot`'s outcome: the matches its winner and loser go to,
// everything after them, and for a group match the knockout matches fed by that group.
export function dependentSlots(t: Tournament, slot: string): string[] {
  const spec = t.matches.find((m) => m.id === slot)
  if (!spec) return []
  const groupOf = new Map(t.matches.map((m) => [m.id, m.group]))
  const feeds = (from: string, m: { slots: readonly { type: string; match?: string; group?: string }[] }) =>
    m.slots.some((s) => ((s.type === "winner" || s.type === "loser") && s.match === from) || (s.type === "group" && groupOf.get(from) !== null && s.group === groupOf.get(from)))
  const out: string[] = []
  const queue = [slot]
  while (queue.length > 0) {
    const from = queue.shift() as string
    for (const m of t.matches) {
      if (m.id === slot || out.includes(m.id) || !feeds(from, m)) continue
      out.push(m.id)
      queue.push(m.id)
    }
  }
  return out
}

// The engine's score for an approved result: the protocol writes the two sides' legs (sets when
// the match is played in sets) in slot order; a result whose winner sits in the other slot is
// turned around. In sets, the legs are the least the sets imply (the record keeps only sets).
function scoreOf(m: MatchView, score: readonly number[], winner: string): Score {
  const w = m.slots.findIndex((s) => s.participant === winner)
  let [a, b] = [score[0] ?? 0, score[1] ?? 0]
  if ((w === 1 && a > b) || (w === 0 && b > a)) [a, b] = [b, a]
  if ((m.format.setsToWin ?? 1) > 1) return { legs: [a * m.format.legsToWin, b * m.format.legsToWin], sets: [a, b] }
  return { legs: [a, b] }
}

// A step the replay applied that the bracket takes too: a board called to a slot, a decision
// about a slot's result (the organizer's own result or, where boards approve, a board's; an
// approval of a submission; a correction), or a player leaving after the draw (their own
// withdrawal, or the organizer taking them out).
type Step =
  | { kind: "assign"; slot: string; board: string }
  | { kind: "result"; slot: string; winner: string | null; score: number[]; walkover?: "noShow" | "retired" }
  | { kind: "leave"; participant: string; how: "withdrawn" | "disqualified" }

// The steps in the order the replay applied them, from the draw the bracket is built from on.
// The state keeps only the last decision per slot; the replay log says which records counted, in
// which order, and the events their content. A drawn player who had left when the draw was made
// (a withdrawal dated before it, never followed by a new registration) stays in the drawn field
// (the protocol's rule) and leaves first; what they do after the draw applies where it was made.
function stepsOf(state: TournamentState, events: readonly NostrEvent[]): Step[] {
  const byId = new Map(events.map((e) => [e.id, e]))
  const contentOf = <T extends "tournament.result" | "tournament.approve" | "tournament.correct" | "tournament.assign" | "tournament.remove">(id: string, type: T): ContentOf<T> | null => {
    const parsed = parseRecord(byId.get(id))
    return parsed.status === "ok" && parsed.record.type === type ? (parsed.record.content as ContentOf<T>) : null
  }
  const drawn = new Set(state.draw?.order ?? [])
  const drawAt = state.log.applied.findIndex((e) => e.id === state.draw?.event)
  const out: Step[] = []
  // Who of the drawn field had left at the draw, by their last leaving before it.
  const left = new Map<string, Step>()
  let organizer = state.founder
  state.log.applied.forEach((entry, at) => {
    if (entry.type === "tournament.handover.accept") organizer = entry.author
    const removal = entry.type === "tournament.remove" ? contentOf(entry.id, "tournament.remove") : null
    const participant = entry.type === "tournament.withdraw" ? entry.author : (removal?.participant ?? null)
    if (participant !== null) {
      const step: Step = { kind: "leave", participant, how: removal?.reason === "disqualified" ? "disqualified" : "withdrawn" }
      if (!drawn.has(participant)) return
      if (at > drawAt) out.push(step)
      else {
        left.delete(participant)
        left.set(participant, step)
      }
      return
    }
    if (at <= drawAt) {
      // Registering again before the draw ends a withdrawal (a removal can't be undone).
      if (entry.type === "tournament.register") left.delete(entry.author)
      return
    }
    if (entry.type === "tournament.assign") {
      const c = contentOf(entry.id, "tournament.assign")
      if (c) out.push({ kind: "assign", slot: c.slot, board: c.board })
    } else if (entry.type === "tournament.result" && (entry.author === organizer || state.settings.approval === "board")) {
      const c = contentOf(entry.id, "tournament.result")
      if (c) out.push({ kind: "result", slot: c.slot, winner: c.winner, score: c.score, ...(c.walkover ? { walkover: c.walkover } : {}) })
    } else if (entry.type === "tournament.approve") {
      const c = contentOf(entry.id, "tournament.approve")
      const sub = c && state.slots[c.slot]?.submissions.find((x) => x.event === c.submission)
      if (c && sub) out.push({ kind: "result", slot: c.slot, winner: sub.winner, score: sub.score, ...(sub.walkover ? { walkover: sub.walkover } : {}) })
    } else if (entry.type === "tournament.correct") {
      const c = contentOf(entry.id, "tournament.correct")
      if (c) out.push({ kind: "result", slot: c.slot, winner: c.winner, score: c.score, ...(c.walkover ? { walkover: c.walkover } : {}) })
    }
  })
  return [...left.values(), ...out]
}

// The bracket with every step applied in the order it was made, then the matches boards are
// playing. A decision the bracket cannot take as made (a winner who does not play the match, a
// result for players the bracket no longer puts there) is kept in `skipped` for the organizer,
// until a newer decision about the same slot replaces it.
function decide(bare: Tournament, state: TournamentState, events: readonly NostrEvent[], live: readonly LiveInput[]): { bracket: Tournament; live: Record<string, LiveSlot>; skipped: TournamentRead["skipped"] } {
  let t = bare
  const refused = new Map<string, string>()
  const attempt = (slot: string, change: () => Tournament) => {
    try {
      t = change()
    } catch (error) {
      refused.set(slot, error instanceof Error ? error.message : String(error))
    }
  }
  for (const step of stepsOf(state, events)) {
    if (step.kind === "leave") {
      // Refused only once the bracket is complete (or for the same kind again): nobody plays
      // any more, so nothing waits for the organizer.
      try {
        t = withdraw(t, step.participant, step.how)
      } catch {
        // The bracket stays as it is.
      }
      continue
    }
    const m = resolveTournament(t).match(step.slot)
    if (!m) continue
    if (step.kind === "assign") {
      const board = step.board
      if ((m.state === "ready" || m.state === "live") && m.board !== board) attempt(step.slot, () => assignBoard(t, step.slot, board))
      continue
    }
    refused.delete(step.slot)
    const winner = step.winner
    if (winner === null) {
      if (t.records[step.slot]) attempt(step.slot, () => resetMatch(t, step.slot))
    } else if (!m.slots.some((s) => s.participant === winner)) {
      refused.set(step.slot, `${winner} does not play ${step.slot}`)
    } else if (step.walkover) {
      const reason = step.walkover
      attempt(step.slot, () => recordWalkover(t, step.slot, winner, reason))
    } else attempt(step.slot, () => recordResult(t, step.slot, scoreOf(m, step.score, winner)))
  }
  // A live match counts only from the key of the board the match is called to, while that board
  // is in the tournament: a board code that got out cannot start other matches.
  const playing: Record<string, LiveSlot> = {}
  for (const l of live) {
    const m = resolveTournament(t).match(l.slot)
    const board = m?.board ? state.boards[m.board] : undefined
    if (!m || playing[l.slot] || !board?.active || board.key !== l.by) continue
    playing[l.slot] = { slot: l.slot, match: l.match, board: board.id }
    if (m.state === "ready") attempt(l.slot, () => startMatch(t, l.slot, board.id))
  }
  return { bracket: t, live: playing, skipped: [...refused].map(([slot, why]) => ({ slot, why })) }
}

// ---- Reading ---------------------------------------------------------------------------------

export function readTournament(stored: StoredTournament, opts: ReadOptions): TournamentRead {
  const now = opts.now
  const result = reduceTournament(stored.events, stored.tournament, {
    ...(now !== undefined ? { now } : {}),
    dependents: (slot, s) => {
      const bare = bracketOf(s)
      return bare ? dependentSlots(bare, slot) : []
    },
  })
  const base = { id: stored.tournament, relays: stored.relays, loadedAt: stored.loadedAt }
  if (!result.state) {
    return { ...base, state: null, problem: result.problem, bracket: null, view: null, names: {}, me: { participant: null, organizer: false, offered: false }, live: {}, skipped: [] }
  }
  const state = result.state
  const names: Record<string, string> = {}
  for (const p of Object.values(state.participants)) names[p.id] = placeName(p)
  const bare = bracketOf(state)
  const decided = bare ? decide(bare, state, stored.events, opts.live ?? []) : null
  const pubkey = opts.pubkey
  const participant = pubkey ? (state.participants[pubkey] ?? Object.values(state.participants).find((p) => p.player === pubkey) ?? null) : null
  const me: Me = {
    participant,
    organizer: pubkey !== null && state.organizer === pubkey,
    offered: pubkey !== null && state.offer !== null && state.offer.to === pubkey && state.offer.expires > (now ?? Math.floor(Date.now() / 1000)),
  }
  return {
    ...base,
    state,
    problem: null,
    bracket: decided?.bracket ?? null,
    view: decided ? resolveTournament(decided.bracket) : null,
    names,
    me,
    live: decided?.live ?? {},
    skipped: decided?.skipped ?? [],
  }
}

// ---- Questions screens ask of the state ----------------------------------------------------

export const admitted = (state: TournamentState) => Object.values(state.participants).filter((p) => p.status === "registered")
export const freePlaces = (state: TournamentState) => Math.max(0, state.settings.capacity - admitted(state).length)
export const requests = (state: TournamentState) => Object.values(state.participants).filter((p) => p.status === "pending")

// What automatic admission decides next, if anything: while there is room, the first on the
// waiting list before any request, then requests by their date (a new registration after a
// withdrawal is a new request), the same on every device, however relays delivered them; once
// full, the next request goes on the waiting list where there is one.
export function nextAdmission(state: TournamentState): { participant: Place; to: "admit" | "waitlist" } | null {
  if (state.settings.admission !== "auto" || (state.phase !== "registration" && state.phase !== "checkin")) return null
  const asking = requests(state).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
  const room = freePlaces(state) > 0
  const participant = room ? (waitingList(state)[0] ?? asking[0]) : state.settings.waitlist ? asking[0] : undefined
  return participant ? { participant, to: room ? "admit" : "waitlist" } : null
}

// Registration is open while the tournament takes registrations and the announced deadline, if
// any, has not passed (by this device's clock).
export const registrationOpen = (state: TournamentState, now: number) =>
  (state.phase === "registration" || state.phase === "checkin") && (state.settings.registrationCloses === undefined || now <= state.settings.registrationCloses)

// Slots with a submitted result the organizer has not decided on.
export const awaitingApproval = (state: TournamentState) => Object.values(state.slots).filter((s) => !s.approved && s.submissions.length > 0)

// Who has not checked in while check-in is open: admitted players only. Guests are the
// organizer's to bring and count as present.
export const notCheckedIn = (state: TournamentState) => (state.phase === "checkin" ? admitted(state).filter((p) => !p.checkedIn && !isGuestPlace(p)) : [])

// The field the organizer draws: everyone admitted but those not checked in.
export function drawField(state: TournamentState): string[] {
  const missing = new Set(notCheckedIn(state).map((p) => p.id))
  return admitted(state).filter((p) => !missing.has(p.id)).map((p) => p.id)
}

// What a draw of `field` with `seeded` in front would give: how many matches, how many byes.
// null when the engine cannot draw this field for the format.
export function drawPreview(state: TournamentState, field: readonly string[], seeded: readonly string[]): { matches: number; byes: number } | null {
  const top = seeded.filter((id) => field.includes(id))
  const draw = { seed: "preview", seeded: top, order: [...top, ...field.filter((id) => !top.includes(id))], event: "", at: 0 }
  try {
    const setup = setupOf({ ...state, draw })
    if (!setup) return null
    const t = createTournament(setup)
    const first = t.matches.filter((m) => (m.bracket === "main" || m.bracket === "winners") && m.round === 1).length
    const byes = t.format === "single" || t.format === "double" ? field.length - 2 * first : 0
    return { matches: t.matches.filter((m) => !m.reset).length, byes }
  } catch {
    return null
  }
}

// The participant a seat of the match holds, by side.
export const sideOf = (m: MatchView, participant: string): 0 | 1 | null => (m.slots[0].participant === participant ? 0 : m.slots[1].participant === participant ? 1 : null)
