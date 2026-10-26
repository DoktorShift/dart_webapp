"use client"

import { useMemo } from "react"
import { recentPlayers, type RecentPlayer } from "@/lib/profile/recent-players"
import { useSession } from "@/lib/profile/session"
import { useArchive } from "@/lib/storage/hooks"

// The people this device played with lately (lib/profile/recent-players.ts), without the
// signed-in profile itself.
export function useRecentPlayers(opts: { withProfile?: boolean; limit?: number } = {}): { players: RecentPlayer[]; loaded: boolean } {
  const { matches, loaded } = useArchive()
  const session = useSession()
  const me = session?.pubkey ?? null
  const { withProfile, limit } = opts
  const players = useMemo(() => recentPlayers(matches, me, { withProfile, limit }), [matches, me, withProfile, limit])
  return { players, loaded }
}
