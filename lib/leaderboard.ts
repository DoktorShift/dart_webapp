"use client"

import { useCallback, useMemo } from "react"
import type { GameType } from "@/lib/game/types"
import { clearLeaderboard } from "@/lib/storage/archive"
import { useArchive, usePlayers } from "@/lib/storage/hooks"
import { newObjectId } from "@/lib/storage/ids"
import { importedAliases } from "@/lib/storage/players"

// The Rangliste, built from the match archive on this device (lib/storage). Players are told
// apart by their stable id; results taken over from version 1.0.0 know only names and stay
// marked as imported until someone assigns them.

export { computeStandings, recentPlayerNames, STANDINGS_MIN_GAMES, type Standing, type Standings, type StandingsOptions, type StandingsSort, type StatsFilter as StandingsFilter } from "@/lib/storage/stats"
export type { V1MatchRecord as MatchRecord, V1PlayerResult as MatchPlayerResult } from "@/lib/storage/v1"
export type { ArchivedMatch } from "@/lib/storage/archive"

export type ModeType = GameType

// New games get 128 random bits; ids of older games stay as they are.
export const newMatchId = newObjectId

export function useMatchHistory() {
  const archive = useArchive()
  const players = usePlayers()
  const aliases = useMemo(() => importedAliases(players ?? []), [players])
  // The Rangliste counts games with two or more players. Solo games are archived too, for each
  // player's own statistics.
  const matches = useMemo(() => archive.matches.filter((m) => m.players.length >= 2), [archive.matches])
  const clear = useCallback(() => void clearLeaderboard(), [])
  return { matches, all: archive.matches, players, aliases, loaded: archive.loaded && players !== null, clear }
}
