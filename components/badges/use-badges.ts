"use client"

import { useEffect, useMemo, useState } from "react"
import { validAwards, type ValidAward } from "@/lib/badges/awards"
import { evaluateMilestones, type MilestoneStatus } from "@/lib/badges/milestones"
import { currentSelection, EMPTY_SELECTION, type Selection } from "@/lib/badges/selection"
import { readEvidence, type Evidence } from "@/lib/badges/self-award"
import { inListOrder, lookupBadges, storedBadgeEvents } from "@/lib/badges/store"
import { useMatchHistory } from "@/lib/leaderboard"
import type { NostrEvent } from "@/lib/nostr/types"
import { onStorageChange } from "@/lib/storage/db"

// The badges the screens show: this device's copy first (lib/badges/store.ts), relays second.

export interface OwnBadges {
  // Every valid award for the profile, oldest first; null while this device's copy is read and
  // checked.
  awards: ValidAward[] | null
  // Among them, the ones from others.
  received: ValidAward[]
  selection: Selection
  // The valid awards the profile's list names, in its order.
  shown: ValidAward[]
  // The profile's own evidence records, by event id.
  evidence: Map<string, Evidence>
}

const NONE: OwnBadges = { awards: null, received: [], selection: EMPTY_SELECTION, shown: [], evidence: new Map() }

// The profile's badges on this device, kept current with this tab's and other tabs' writes, and
// looked for on relays once per page load.
export function useOwnBadges(pubkey: string): OwnBadges {
  const [read, setRead] = useState<{ pubkey: string; events: NostrEvent[]; awards: ValidAward[] } | null>(null)
  useEffect(() => {
    let latest = 0
    const load = () => {
      const run = ++latest
      void storedBadgeEvents(pubkey)
        .then(async (events) => ({ events, awards: await validAwards(events, pubkey) }))
        .then(
          (found) => run === latest && setRead({ pubkey, ...found }),
          () => run === latest && setRead({ pubkey, events: [], awards: [] }),
        )
    }
    load()
    const stop = onStorageChange((message) => {
      if (message.type === "change" && message.stores.includes("objects")) load()
    })
    void lookupBadges(pubkey)
    return () => {
      latest = -1
      stop()
    }
  }, [pubkey])

  return useMemo(() => {
    if (!read || read.pubkey !== pubkey) return NONE
    const selection = currentSelection(read.events, pubkey)
    const evidence = new Map<string, Evidence>()
    for (const event of read.events) {
      const record = readEvidence(event)
      if (record) evidence.set(event.id, record)
    }
    return { awards: read.awards, received: read.awards.filter((a) => a.issuer !== pubkey), selection, shown: inListOrder(selection, read.awards), evidence }
  }, [read, pubkey])
}

// The self-earned award of the profile for a milestone, if it has one.
export const selfAwardFor = (badges: OwnBadges, pubkey: string, id: string, version: number) =>
  badges.awards?.find((a) => a.issuer === pubkey && a.blueline?.scope === "self" && a.blueline.badge === id && a.blueline.version === version)

// The catalog's milestones for a player (statistics key, lib/storage/stats.ts), from this
// device's games; none without a player.
export function useMilestones(key: string | null, aliases?: Map<string, string>, sameAs?: Map<string, string>): { statuses: MilestoneStatus[]; loaded: boolean } {
  const { all, loaded } = useMatchHistory()
  const statuses = useMemo(() => (key ? evaluateMilestones(all, key, { aliases, sameAs }) : []), [all, key, aliases, sameAs])
  return { statuses, loaded }
}
