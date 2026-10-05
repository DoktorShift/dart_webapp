import type { GameType } from "../game/types.ts"

// The keys version 1.0.0 keeps in localStorage, and careful access to its history of results.
//
// Version 1.0.0 can run again: after a rollback, or in a tab that was left open across an
// update. It quietly deletes what it doesn't understand in its own keys. So this file never
// writes anything into them that 1.0.0 would reject, never drops an entry it doesn't
// understand itself, and only ever changes the one record it was asked to change.

export const V1_KEYS = {
  currentMatch: "dart-scorer.current-match.v1",
  lastPlayers: "dart-scorer.last-players.v1",
  settings: "dart-scorer.settings.v1",
  rules: "dart-scorer.rules.v1",
  lastGame: "dart-scorer.last-game.v1",
  matches: "dart-scorer.matches.v1",
  language: "dart-scorer.language.v1",
  // Written by next-themes, read before the first paint, so it stays in localStorage.
  theme: "theme",
} as const

export const V1_KEY_LIST: string[] = Object.values(V1_KEYS)

// Version 1.0.0 keeps the newest 500 results.
export const MAX_V1_MATCHES = 500

const GAME_TYPES: GameType[] = ["x01", "cricket", "clock"]

// One player's line in a 1.0.0 result. `points` is 0 outside X01.
export interface V1PlayerResult {
  name: string
  won: boolean
  darts: number
  points: number
}

// A finished game as 1.0.0 stores it for the Rangliste: names and totals, no throws.
export interface V1MatchRecord {
  id: string
  finishedAt: string
  modeId: string
  modeName: string
  modeType: GameType
  players: V1PlayerResult[]
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

export function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

// Every 1.0.0 key as the exact text stored, null where a key isn't set.
export function readAllRaw(): Record<string, string | null> {
  return Object.fromEntries(V1_KEY_LIST.map((key) => [key, readRaw(key)]))
}

// The stored list as it is, entries this version doesn't understand included.
function readEntries(): unknown[] {
  try {
    const raw = readRaw(V1_KEYS.matches)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeEntries(entries: unknown[]) {
  try {
    const store = storage()
    if (!store) return false
    store.setItem(V1_KEYS.matches, JSON.stringify(entries.slice(0, MAX_V1_MATCHES)))
    return true
  } catch {
    // Full or blocked. The caller reports it.
    return false
  }
}

// The checks 1.0.0 applies (lib/leaderboard.ts validRecord there), plus a known type of game.
export function isV1Record(value: unknown): value is V1MatchRecord {
  if (!isObject(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.finishedAt === "string" &&
    typeof value.modeName === "string" &&
    GAME_TYPES.includes(value.modeType as GameType) &&
    Array.isArray(value.players) &&
    value.players.every((p) => isObject(p) && typeof p.name === "string" && typeof p.won === "boolean")
  )
}

// The results 1.0.0 would show, newest first.
export const readV1Records = (): V1MatchRecord[] => readEntries().filter(isV1Record)

export const findV1Record = (id: string) => readV1Records().find((r) => r.id === id) ?? null

const sameId = (entry: unknown, id: string) => isObject(entry) && entry.id === id

// Adds a result, or replaces the one with the same id where it stands. Returns false when it
// could not be written.
export function upsertV1Record(record: V1MatchRecord) {
  const entries = readEntries()
  const index = entries.findIndex((e) => sameId(e, record.id))
  if (index >= 0) entries[index] = record
  else entries.unshift(record)
  return writeEntries(entries)
}

export function removeV1Record(id: string) {
  const entries = readEntries()
  if (!entries.some((e) => sameId(e, id))) return true
  return writeEntries(entries.filter((e) => !sameId(e, id)))
}

// "Rangliste zurücksetzen", as 1.0.0 does it.
export function clearV1Records() {
  return writeEntries([])
}

// Adds results that aren't there yet (from an imported file), keeping the list newest first.
export function mergeV1Records(records: V1MatchRecord[]) {
  const entries = readEntries()
  const known = new Set(entries.flatMap((e) => (isObject(e) && typeof e.id === "string" ? [e.id] : [])))
  const added = records.filter((r) => !known.has(r.id))
  if (added.length === 0) return true
  const time = (e: unknown) => (isObject(e) && typeof e.finishedAt === "string" ? Date.parse(e.finishedAt) || 0 : 0)
  return writeEntries([...entries, ...added].sort((a, b) => time(b) - time(a)))
}

// "Alle Daten auf diesem Gerät löschen": every key 1.0.0 uses, and any other key of this app.
export function removeAllV1Data() {
  const store = storage()
  if (!store) return false
  try {
    const keys = new Set(V1_KEY_LIST)
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key && (key.startsWith("dart-scorer.") || key.startsWith("blueline"))) keys.add(key)
    }
    for (const key of keys) store.removeItem(key)
    return true
  } catch {
    return false
  }
}
