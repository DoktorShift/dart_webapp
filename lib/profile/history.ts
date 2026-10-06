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
