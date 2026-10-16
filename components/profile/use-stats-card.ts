"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import type { OwnProfile } from "@/components/profile/use-profile"
import { createdAt } from "@/lib/nostr/time"
import { OWN } from "@/lib/profile/own-events"
import { statsCardOf } from "@/lib/profile/stats-card"
import { EMPTY_STATS_CARD, sharesNothing, type StatsCard } from "@/lib/protocol/profile"
import { readStatsCard, statsCardTemplate } from "@/lib/protocol/stats-card"
import { kvGet, kvSet } from "@/lib/storage/db"
import { useStored } from "@/lib/storage/hooks"
import { submitOwn } from "@/lib/sync/publish"

// "Statistik im Profil zeigen" (default off): whether the profile shares its stats card. The
// choice is kept with the profile on this device (kv, gone with the profile), so it holds before
// the first game too; on a device without a choice yet, what is published counts. Switched on,
// the card follows this device's figures; switched off, an empty card withdraws them.
const CHOICE_KEY = "profile.stats-card"

// The choice as stored: undefined while read, null without one.
const loadChoice = () => kvGet<boolean>(CHOICE_KEY).then((value) => value ?? null, () => null)
const useChoice = () => useStored("kv", loadChoice)[0]

export function useStatsCard(own: OwnProfile) {
  const { session, events, history, key, sameAs } = own
  const choice = useChoice()
  const event = events?.get(OWN.statsCard)
  const published = event ? readStatsCard(event, session.pubkey) : null
  const publishedShares = !!published && !sharesNothing(published.card)
  const enabled = choice ?? publishedShares
  const local = useMemo(() => (history.loaded ? statsCardOf(history.all, key, { aliases: history.aliases, sameAs }) : null), [history.loaded, history.all, history.aliases, key, sameAs])
  const hasFigures = !!local && !sharesNothing(local)
  const outdated = enabled && hasFigures && JSON.stringify(local) !== JSON.stringify(published?.card)

  const write = useCallback((card: StatsCard) => submitOwn([statsCardTemplate(card, createdAt(event?.created_at))]), [event?.created_at])
  const setEnabled = useCallback(
    async (on: boolean) => {
      await kvSet(CHOICE_KEY, on)
      if (on && local && !sharesNothing(local)) await write(local)
      else if (!on && publishedShares) await write(EMPTY_STATS_CARD)
    },
    [write, local, publishedShares],
  )
  const refresh = useCallback(() => (local ? write(local) : Promise.resolve(null)), [write, local])
  return { enabled, loaded: choice !== undefined, local, hasFigures, outdated, publishedAt: published?.createdAt ?? null, setEnabled, refresh }
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
