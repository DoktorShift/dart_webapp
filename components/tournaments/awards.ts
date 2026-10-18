"use client"

import { useEffect, useState } from "react"
import { useAreaT } from "@/components/i18n-provider"
import type { Entry } from "@/components/tournaments/use-tournaments"
import { currentPlan, issueAwards, type BadgeOccasion } from "@/lib/badges/organizer"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { featureOn } from "@/lib/shell/features"
import { badgeOccasion } from "@/lib/tournaments/occasion"

// The tournament's badges (lib/badges/organizer.ts), given by the organizer who finished it:
// right after "Turnier beenden", and from the organizer's tasks while some are still missing
// (no relay answered then, or the app was closed in between). Nothing of this with the badges
// switched off (lib/shell/features.ts).

// Gives what is missing for the occasion. Resolves with the problem to show, or null once given.
export function useGiveAwards() {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const bx = useAreaT(BADGES_TEXTS)
  return async (occasion: BadgeOccasion): Promise<string | null> => {
    try {
      const given = await issueAwards(occasion.ended.by, occasion, (badge, name) => bx.organizer[badge](name))
      return given ? null : tx.organize.participants.awardsLapsed
    } catch {
      return tx.failed
    }
  }
}

// The finished tournament's occasion while badges of it are still to give, asked once relays
// answer; null otherwise. `round` asks again (after giving).
export function useMissingAwards(entry: Entry, round: number): BadgeOccasion | null {
  const [missing, setMissing] = useState<BadgeOccasion | null>(null)
  const occasion = featureOn("badges") && entry.read.me.organizer ? badgeOccasion(entry.read) : null
  const ended = occasion?.ended.event
  useEffect(() => {
    if (!occasion) {
      setMissing(null)
      return
    }
    let current = true
    void currentPlan(occasion.ended.by, occasion).then(
      (plan) => current && setMissing(plan && plan.missing.length > 0 ? occasion : null),
      () => {},
    )
    return () => {
      current = false
    }
    // Once per finished tournament and round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, round])
  return missing
}
