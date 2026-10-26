import type { ArchivedMatch } from "../storage/archive.ts"
import { playerKey, type StatsOptions } from "../storage/stats.ts"

// A player's games in the archive, with the seat they played in (newest first, as stored).

export interface PlayedGame {
  match: ArchivedMatch
  seat: number
}

export function gamesOf(matches: readonly ArchivedMatch[], key: string, options: Pick<StatsOptions, "aliases" | "sameAs"> = {}): PlayedGame[] {
  return matches.flatMap((match) => {
    const seat = match.players.findIndex((player) => playerKey(match, player, options.aliases, options.sameAs) === key)
    return seat < 0 ? [] : [{ match, seat }]
  })
}

// Whether the archive holds games the profile played on another device: a seat with the
// profile's key but a player id that is not the profile's player here. Screens then say "all
// your devices" instead of "this device".
export function playedElsewhere(matches: readonly ArchivedMatch[], pubkey: string | null, playerId: string | null | undefined): boolean {
  if (!pubkey) return false
  return matches.some((m) => m.players.some((p) => p.pubkey === pubkey && p.playerId !== playerId))
}
