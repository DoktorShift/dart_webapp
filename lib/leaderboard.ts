"use client"

import { useCallback, useEffect, useMemo } from "react"
import type { GameType } from "@/lib/game/types"
import { clearLeaderboard } from "@/lib/storage/archive"
import { useArchive, usePlayers, useStored } from "@/lib/storage/hooks"
import { newObjectId } from "@/lib/storage/ids"
import { loadPlayerLinkState, type PlayerLinks } from "@/lib/storage/player-links"
import { importedAliases } from "@/lib/storage/players"
import { useSession } from "@/lib/profile/session"

// The Rangliste, built from the match archive on this device (lib/storage). Players are told
// apart by their stable id; results taken over from version 1.0.0 know only names and stay
// marked as imported until someone assigns them.

export { computeStandings, recentPlayerNames, STANDINGS_MIN_GAMES, type Standing, type Standings, type StandingsOptions, type StandingsSort, type StatsFilter as StandingsFilter } from "@/lib/storage/stats"
export type { V1MatchRecord as MatchRecord, V1PlayerResult as MatchPlayerResult } from "@/lib/storage/v1"
export type { ArchivedMatch } from "@/lib/storage/archive"

export type ModeType = GameType

// New games get 128 random bits; ids of older games stay as they are.
export const newMatchId = newObjectId

const readLinks = (): Promise<{ owner: string | null; links: PlayerLinks; conflicts: Record<string, string[]>; localSuggestions: PlayerLinks } | null> => loadPlayerLinkState().catch(() => null)

export function useMatchHistory() {
  const archive = useArchive()
  const players = usePlayers()
  const [linkState, reloadLinks] = useStored("kv", readLinks)
  const session = useSession()
  useEffect(() => { reloadLinks() }, [session?.pubkey, reloadLinks])
  const aliases = useMemo(() => importedAliases(players ?? []), [players])
  // The Rangliste counts games with two or more players. Solo games are archived too, for each
  // player's own statistics.
  const matches = useMemo(() => archive.matches.filter((m) => m.players.length >= 2), [archive.matches])
  const clear = useCallback(() => void clearLeaderboard(), [])
  const currentLinks = session !== undefined && linkState?.owner === (session?.pubkey ?? null) ? linkState : null
  return { matches, all: archive.matches, players, aliases, links: currentLinks?.links ?? {}, linkConflicts: currentLinks?.conflicts ?? {}, localLinkSuggestions: currentLinks?.localSuggestions ?? {}, loaded: archive.loaded && players !== null && currentLinks !== null, clear }
}
