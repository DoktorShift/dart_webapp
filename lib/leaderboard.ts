"use client"

import { useCallback, useEffect, useState } from "react"
import type { GameType } from "@/lib/game/types"

// Match results are kept on this device only (localStorage) until sync exists.
const STORAGE_KEY = "dart-scorer.matches.v1"
const MAX_MATCHES = 500
const CHANGE_EVENT = "dart-scorer:matches-changed"

export type ModeType = GameType

export interface MatchPlayerResult {
  name: string
  won: boolean
  darts: number
  points: number
}

export interface MatchRecord {
  id: string
  finishedAt: string
  modeId: string
  modeName: string
  modeType: ModeType
  players: MatchPlayerResult[]
}

export interface Standing {
  key: string
  name: string
  matches: number
  wins: number
  winRate: number
  // 3-dart average across x01 matches, null when the player has no x01 darts
  average: number | null
  lastPlayed: string
}

export type StandingsFilter = "all" | ModeType

const nameKey = (name: string) => name.trim().toLowerCase()

// Entries that don't look like a finished game (older versions, damaged data) are skipped.
const validRecord = (m: unknown): m is MatchRecord => {
  if (typeof m !== "object" || m === null) return false
  const r = m as Partial<MatchRecord>
  return (
    typeof r.id === "string" &&
    typeof r.finishedAt === "string" &&
    typeof r.modeName === "string" &&
    Array.isArray(r.players) &&
    r.players.every((p) => typeof p?.name === "string" && typeof p.won === "boolean")
  )
}

function readMatches(): MatchRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(validRecord) : []
  } catch {
    return []
  }
}

function writeMatches(matches: MatchRecord[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(matches.slice(0, MAX_MATCHES)))
  } catch {
    // Storage full or blocked (private mode): the leaderboard just won't update.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

// Safe to call more than once for the same match: a record with the same id is replaced.
export function recordMatch(match: MatchRecord) {
  writeMatches([match, ...readMatches().filter((m) => m.id !== match.id)])
}

// Used when the winning dart is undone from the result screen.
export function removeMatch(id: string) {
  const matches = readMatches()
  if (matches.some((m) => m.id === id)) writeMatches(matches.filter((m) => m.id !== id))
}

// Names from recent games, most recent first, for quick picks in player setup.
export function recentPlayerNames(matches: MatchRecord[], limit = 12) {
  const seen = new Map<string, string>()
  for (const match of matches)
    for (const player of match.players) {
      const key = nameKey(player.name)
      if (key && !seen.has(key)) seen.set(key, player.name.trim())
    }
  return Array.from(seen.values()).slice(0, limit)
}

export function clearMatches() {
  writeMatches([])
}

export function newMatchId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function computeStandings(matches: MatchRecord[], filter: StandingsFilter = "all"): Standing[] {
  const byPlayer = new Map<string, Standing & { x01Darts: number; x01Points: number }>()

  // Newest first, so the first spelling we see for a name is the most recent one.
  for (const match of matches) {
    if (filter !== "all" && match.modeType !== filter) continue

    for (const player of match.players) {
      const key = nameKey(player.name)
      if (!key) continue

      const entry = byPlayer.get(key) ?? {
        key,
        name: player.name.trim(),
        matches: 0,
        wins: 0,
        winRate: 0,
        average: null,
        lastPlayed: match.finishedAt,
        x01Darts: 0,
        x01Points: 0,
      }

      entry.matches += 1
      if (player.won) entry.wins += 1
      if (match.modeType === "x01") {
        entry.x01Darts += player.darts
        entry.x01Points += player.points
      }
      byPlayer.set(key, entry)
    }
  }

  return Array.from(byPlayer.values())
    .map(({ x01Darts, x01Points, ...standing }) => ({
      ...standing,
      winRate: standing.matches > 0 ? standing.wins / standing.matches : 0,
      average: x01Darts > 0 ? Math.round((x01Points / x01Darts) * 3 * 10) / 10 : null,
    }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.winRate - a.winRate ||
        (b.average ?? -1) - (a.average ?? -1) ||
        a.name.localeCompare(b.name),
    )
}

export function useMatchHistory() {
  const [matches, setMatches] = useState<MatchRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const sync = () => setMatches(readMatches())
    sync()
    setLoaded(true)

    // Keep open screens and other tabs in step with new results.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync()
    }
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const clear = useCallback(() => clearMatches(), [])

  return { matches, loaded, clear }
}
