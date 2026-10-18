"use client"

import { useEffect } from "react"
import { useFollowed } from "@/components/live/match-view"
import { setLive } from "@/components/tournaments/use-tournaments"
import { watchFoundings, type Founding } from "@/lib/live/follow"
import { featureOn } from "@/lib/shell/features"
import type { TournamentRead } from "@/lib/tournaments/read"
import { tournamentRelays } from "@/lib/tournaments/send"

// The matches a tournament's boards are playing, found by the boards' keys (lib/live
// watchFoundings): each founding names the tournament and the slot it decides. Reported to the
// tournaments store, which starts those matches in the bracket. Followed while a screen that
// shows the tournament is mounted; the store keeps the last report when none is. A build without
// live games (lib/shell/features.ts) has none: its tournaments run on reported results alone.
export function useLiveMatches(read: TournamentRead | undefined) {
  const id = read?.id
  const keys = read?.state ? Object.values(read.state.boards).filter((b) => b.active).map((b) => b.key).sort().join(",") : ""
  const relayKey = read?.relays.join(",") ?? ""
  useEffect(() => {
    if (!featureOn("live") || !id || !keys) return
    const found = new Map<string, Founding>()
    const report = () =>
      setLive(
        id,
        [...found.values()]
          .filter((f) => f.agreement.tournament?.id === id)
          .sort((a, b) => a.at - b.at)
          .map((f) => ({ slot: f.agreement.tournament?.slot as string, match: f.match, by: f.by })),
      )
    const sub = watchFoundings({ authors: keys.split(","), relays: tournamentRelays(relayKey ? relayKey.split(",") : []) }, (founding) => {
      found.set(founding.match, founding)
      report()
    })
    return () => sub.close()
  }, [id, keys, relayKey])
}

// The standing of one live match (legs, scores), followed through lib/live.
export function useLiveStanding(match: string | null, relays: readonly string[]) {
  const followed = useFollowed(match ? { match, key: null, relays: tournamentRelays(relays) } : null)
  const live = followed.state?.live
  return live ? { standing: live.content.standing, status: live.content.status, stale: followed.connection === "interrupted" } : null
}
