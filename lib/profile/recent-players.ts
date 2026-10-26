import type { ArchivedMatch } from "../storage/archive.ts"
import { isUnnamed, nameKey } from "../storage/players.ts"

// "Zuletzt gespielt mit": the people in this device's games, newest first, one entry per person
// (a profile counts once however it was called; without a profile, the name counts). Only local
// data; nothing is published. Used to suggest whom to invite or add (PLAN.md, M14).

export interface RecentPlayer {
  name: string
  pubkey?: string
  // When the last game with them finished (ISO).
  playedAt: string
  games: number
}

export function recentPlayers(matches: readonly ArchivedMatch[], me: string | null, opts: { withProfile?: boolean; limit?: number } = {}): RecentPlayer[] {
  const seen = new Map<string, RecentPlayer>()
  const sorted = [...matches].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
  for (const match of sorted) {
    for (const player of match.players) {
      if (player.unnamed || isUnnamed(player.name)) continue
      if (player.pubkey && player.pubkey === me) continue
      if (opts.withProfile && !player.pubkey) continue
      const key = player.pubkey ?? `name:${nameKey(player.name)}`
      const known = seen.get(key)
      if (known) known.games++
      else seen.set(key, { name: player.name.trim(), ...(player.pubkey ? { pubkey: player.pubkey } : {}), playedAt: match.finishedAt, games: 1 })
    }
  }
  return [...seen.values()].slice(0, opts.limit ?? 12)
}
