import { configFor, DEFAULT_RULES, type GameRules } from "../game/rules.ts"
import { configToRules } from "../protocol/match.ts"
import type { ContentOf } from "../protocol/records.ts"
import { MAX_PARTICIPANTS, TOURNAMENT_ENGINE } from "../protocol/tournament.ts"
import { MAX_ROUND_ROBIN, MIN_PARTICIPANTS, type TournamentFormat } from "./engine.ts"

// A tournament being created, in the four steps of the creation flow (PLAN.md "Turniere":
// Eckdaten, Format und Spielregeln, Teilnehmer und Boards, Vorschau). Saved locally as it is
// typed (store.ts); publishing turns it into the founding record plus one record per guest and
// board. Times are the device's local time and zone: the zone is shown, not chosen.

export interface TournamentDraft {
  id: string
  // The club it belongs to, when created from a club (its id and the name to show).
  club: string | null
  clubName: string | null
  name: string
  about: string
  // "2026-10-24T19:00" (a datetime-local value), or "" when not set.
  starts: string
  timezone: string
  place: string
  online: boolean
  format: TournamentFormat
  // X01 rules as game setup keeps them; the tournament plays X01 only.
  rules: GameRules
  // A longer final; null plays the final like every other match.
  final: { legsToWin: number; setsToWin: number } | null
  grandFinalReset: boolean
  doubleRoundRobin: boolean
  groups: { count: number; advance: number }
  capacity: number
  waitlist: boolean
  checkIn: boolean
  approval: "organizer" | "board"
  admission: "auto" | "manual"
  registrationCloses: string
  // Guests without profile, by name, and the boards' names.
  guests: string[]
  boards: string[]
  updatedAt: number
}

export const DEFAULT_CAPACITY = 16
export const MAX_BOARDS = 16

export function newDraft(id: string, timezone: string, now = Date.now(), overrides: Partial<TournamentDraft> = {}): TournamentDraft {
  return {
    id,
    club: null,
    clubName: null,
    name: "",
    about: "",
    starts: "",
    timezone,
    place: "",
    online: false,
    format: "single",
    rules: { ...DEFAULT_RULES, legsToWin: 3 },
    final: null,
    grandFinalReset: true,
    doubleRoundRobin: false,
    groups: { count: 4, advance: 2 },
    capacity: DEFAULT_CAPACITY,
    waitlist: true,
    checkIn: true,
    approval: "organizer",
    admission: "auto",
    registrationCloses: "",
    guests: [],
    boards: ["Board 1", "Board 2"],
    updatedAt: now,
    ...overrides,
  }
}

// What stops the draft from being published, each named once; the preview step lists them.
export type DraftProblem = "name" | "capacity" | "guests" | "groups" | "boards"

export function draftProblems(draft: TournamentDraft): DraftProblem[] {
  const problems: DraftProblem[] = []
  const guests = cleanNames(draft.guests)
  if (draft.name.trim() === "") problems.push("name")
  if (!Number.isInteger(draft.capacity) || draft.capacity < Math.max(2, MIN_PARTICIPANTS[draft.format]) || draft.capacity > MAX_PARTICIPANTS) problems.push("capacity")
  else if (draft.format === "roundRobin" && draft.capacity > MAX_ROUND_ROBIN) problems.push("capacity")
  if (guests.length > draft.capacity) problems.push("guests")
  if (draft.format === "groups") {
    const { count, advance } = draft.groups
    const fits = Number.isInteger(count) && Number.isInteger(advance) && count >= 2 && advance >= 1 && count * 2 <= draft.capacity && count * advance >= 2 && advance <= Math.floor(draft.capacity / count)
    if (!fits || Math.ceil(draft.capacity / count) > MAX_ROUND_ROBIN) problems.push("groups")
  }
  if (cleanNames(draft.boards).length > MAX_BOARDS) problems.push("boards")
  return problems
}

// Names as entered, one per line or comma-separated, without blanks and doubles.
export function cleanNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names.flatMap((n) => n.split(/[\n,;]/))) {
    const name = raw.trim().slice(0, 40).trim()
    const key = name.toLowerCase()
    if (name && !seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

// A datetime-local value as unix seconds in the device's zone; undefined when not set or
// unreadable.
export function localTime(value: string): number | undefined {
  if (!value) return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

// The rules the tournament's matches are played by (the protocol form of an X01 game).
export const draftMatchRules = (draft: TournamentDraft) => configToRules(configFor("x01", draft.rules, [], "x01"))

export function foundContent(draft: TournamentDraft, seedCommit: string): ContentOf<"tournament.found"> {
  const rules = draftMatchRules(draft)
  const starts = localTime(draft.starts)
  const closes = localTime(draft.registrationCloses)
  return {
    name: draft.name.trim(),
    ...(draft.about.trim() ? { about: draft.about.trim() } : {}),
    ...(draft.club ? { club: draft.club } : {}),
    engine: TOURNAMENT_ENGINE,
    format: draft.format,
    rules,
    ...(draft.final ? { final: { ...rules, legsToWin: draft.final.legsToWin, setsToWin: draft.final.setsToWin } } : {}),
    capacity: draft.capacity,
    admission: draft.admission,
    waitlist: draft.waitlist,
    checkIn: draft.checkIn,
    approval: draft.approval,
    ...(starts !== undefined ? { starts, timezone: draft.timezone } : {}),
    ...(draft.place.trim() ? { place: draft.place.trim() } : {}),
    ...(draft.online ? { online: true } : {}),
    ...(closes !== undefined ? { registrationCloses: closes } : {}),
    seedCommit,
    ...(draft.format === "double" ? { grandFinalReset: draft.grandFinalReset } : {}),
    ...(draft.format === "roundRobin" || draft.format === "groups" ? { doubleRoundRobin: draft.doubleRoundRobin } : {}),
    ...(draft.format === "groups" ? { groups: { count: draft.groups.count, advance: draft.groups.advance } } : {}),
  }
}
