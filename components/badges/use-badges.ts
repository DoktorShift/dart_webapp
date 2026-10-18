"use client"

import { useEffect, useMemo, useState } from "react"
import { useAreaT } from "@/components/i18n-provider"
import { problemText } from "@/components/badges/texts"
import type { OwnProfile } from "@/components/profile/use-profile"
import type { Outcome } from "@/lib/badges/actions"
import { splitReceived, validAwards, type ValidAward } from "@/lib/badges/awards"
import { evaluateMilestones, type MilestoneStatus } from "@/lib/badges/milestones"
import { currentSelection, EMPTY_SELECTION, type Selection } from "@/lib/badges/selection"
import { awardRestsOn, readEvidence, selfAwardHolds, type Evidence } from "@/lib/badges/self-award"
import { inListOrder, lookupBadges, storedBadgeEvents } from "@/lib/badges/store"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { useMatchHistory } from "@/lib/leaderboard"
import type { NostrEvent } from "@/lib/nostr/types"
import { onStorageChange } from "@/lib/storage/db"

// The badges the screens show: this device's copy first (lib/badges/store.ts), relays second.

export interface OwnBadges {
  // Every valid award for the profile, oldest first; null while this device's copy is read and
  // checked.
  awards: ValidAward[] | null
  // Among them, the ones from issuers the profile vouches for (lib/badges/awards.ts
  // splitReceived): these are "Erhalten" and count as new …
  received: ValidAward[]
  // … and the ones from issuers it doesn't know yet: behind one quiet row, never counted.
  unvouched: ValidAward[]
  selection: Selection
  // The valid awards the profile's list names, in its order.
  shown: ValidAward[]
  // The profile's own evidence records, by event id.
  evidence: Map<string, Evidence>
}

const NONE: OwnBadges = { awards: null, received: [], unvouched: [], selection: EMPTY_SELECTION, shown: [], evidence: new Map() }

// The profile's badges on this device, kept current with this tab's and other tabs' writes, and
// looked for on relays once per page load. Without a profile (null) nothing is read or asked
// for: a guest opens no connection (decision 0002 §1).
export function useOwnBadges(pubkey: string | null): OwnBadges {
  const [read, setRead] = useState<{ pubkey: string; events: NostrEvent[]; awards: ValidAward[] } | null>(null)
  useEffect(() => {
    if (!pubkey) return
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
    if (!pubkey || !read || read.pubkey !== pubkey) return NONE
    const selection = currentSelection(read.events, pubkey)
    const evidence = new Map<string, Evidence>()
    for (const event of read.events) {
      const record = readEvidence(event)
      if (record) evidence.set(event.id, record)
    }
    const shown = inListOrder(selection, read.awards)
    return { awards: read.awards, ...splitReceived(read.awards, pubkey, shown), selection, shown, evidence }
  }, [read, pubkey])
}

// The self-earned award of the profile for a milestone, if it has one.
export const selfAwardFor = (badges: OwnBadges, pubkey: string, id: string, version: number) =>
  badges.awards?.find((a) => a.issuer === pubkey && a.blueline?.scope === "self" && a.blueline.badge === id && a.blueline.version === version)

const evidenceOf = (badges: OwnBadges, award: ValidAward) => badges.evidence.get(award.blueline?.evidence ?? "") ?? null

// Whether an award no longer holds: its issuer's area says so, or, for the profile's own
// milestone, the game it rests on was corrected on this device (lib/badges/self-award.ts).
export const awardVoided = (own: OwnProfile, badges: OwnBadges, award: ValidAward): boolean =>
  award.voided || (award.issuer === own.session.pubkey && selfAwardHolds(award, evidenceOf(badges, award), own.history.all, own.key ?? "", { aliases: own.history.aliases, sameAs: own.sameAs }) === false)

// Of the milestones a game made the profile reach, those its profile doesn't show from this
// game yet: without an own award, or with one resting on another game (corrected since).
export const notShownFrom = (badges: OwnBadges, pubkey: string, statuses: readonly MilestoneStatus[], matchId: string): MilestoneStatus[] =>
  statuses.filter((s) => {
    const award = selfAwardFor(badges, pubkey, s.milestone.id, s.milestone.version)
    return !award || !awardRestsOn(award, evidenceOf(badges, award), matchId)
  })

// The catalog's milestones for a player (statistics key, lib/storage/stats.ts), from this
// device's games; none without a player.
export function useMilestones(key: string | null, aliases?: Map<string, string>, sameAs?: Map<string, string>): { statuses: MilestoneStatus[]; loaded: boolean } {
  const { all, loaded } = useMatchHistory()
  const statuses = useMemo(() => (key ? evaluateMilestones(all, key, { aliases, sameAs }) : []), [all, key, aliases, sameAs])
  return { statuses, loaded }
}

// Runs one change of the profile's badges and says what went wrong, in place.
export function useChange() {
  const tx = useAreaT(BADGES_TEXTS)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (change: () => Promise<Outcome>) => {
    setBusy(true)
    setProblem(null)
    try {
      if ((await change()) === "offline") setProblem(problemText(tx, "offline"))
    } catch (error) {
      setProblem(problemText(tx, error))
    } finally {
      setBusy(false)
    }
  }
  return { busy, problem, run }
}
