"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import type { OwnProfile } from "@/components/profile/use-profile"
import { createdAt } from "@/lib/nostr/time"
import { OWN } from "@/lib/profile/own-events"
import { statsCardOf } from "@/lib/profile/stats-card"
import { EMPTY_STATS_CARD, sharesNothing, type StatsCard } from "@/lib/protocol/profile"
import { readStatsCard, statsCardTemplate } from "@/lib/protocol/stats-card"
import { publishOwn } from "@/lib/sync/publish"

// "Statistik im Profil zeigen" (default off): whether the profile shares its stats card, and
// whether the shared figures still match this device's games. The setting is the card itself:
// shown means the newest card shares figures, hidden means it shares none.
export function useStatsCard(own: OwnProfile) {
  const { session, events, history, key, sameAs } = own
  const event = events?.get(OWN.statsCard)
  const published = event ? readStatsCard(event, session.pubkey) : null
  const enabled = !!published && !sharesNothing(published.card)
  const local = useMemo(() => (history.loaded ? statsCardOf(history.all, key, { aliases: history.aliases, sameAs }) : null), [history.loaded, history.all, history.aliases, key, sameAs])
  const outdated = enabled && !!local && JSON.stringify(local) !== JSON.stringify(published?.card)

  const write = useCallback((card: StatsCard) => publishOwn([statsCardTemplate(card, createdAt(event?.created_at))]), [event?.created_at])
  const setEnabled = useCallback((on: boolean) => write(on && local ? local : EMPTY_STATS_CARD), [write, local])
  const refresh = useCallback(() => (local ? write(local) : Promise.resolve([])), [write, local])
  return { enabled, outdated, local, publishedAt: published?.createdAt ?? null, setEnabled, refresh }
}

// With a key on this device, a shared card follows the games on its own: no signer to ask. A
// signer app or extension would ask every time, so there the person updates it themselves
// (So sehen andere dein Profil › Statistik aktualisieren).
export function useStatsCardFollowsGames(own: OwnProfile) {
  const { outdated, local, refresh } = useStatsCard(own)
  const target = own.session.kind === "local" && outdated ? JSON.stringify(local) : null
  const tried = useRef<string | null>(null)
  useEffect(() => {
    // One attempt per state of the figures: an unreachable relay doesn't make it loop.
    if (!target || tried.current === target) return
    const timer = setTimeout(() => {
      tried.current = target
      void refresh().catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [target, refresh])
}
