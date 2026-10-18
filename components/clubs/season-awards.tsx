"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT } from "@/components/i18n-provider"
import { useChange } from "@/components/clubs/common"
import { seasonsMissingAwards } from "@/components/clubs/awards"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { issueAwards, type BadgeOccasion } from "@/lib/badges/organizer"
import { isManager, type ClubView } from "@/lib/clubs/club"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { featureOn } from "@/lib/shell/features"

// Giving the badges of an ended season (winner, regulars) from the club: right after "Saison
// beenden", and from "Club verwalten" for every season this leader ended whose badges aren't all
// given yet, whether that lapsed (no relay answered) or was cut short.

// How often badges were given in this tab: every list of missing ones asks again after that,
// wherever it was opened (Club verwalten stays mounted under the season it ended).
let givenRounds = 0
const givenListeners = new Set<() => void>()
const subscribeGiven = (listener: () => void) => {
  givenListeners.add(listener)
  return () => {
    givenListeners.delete(listener)
  }
}

// Gives what is missing, named in the badges area's words. Resolves with the problem to show,
// or null once given.
export function useGiveAwards() {
  const tx = useAreaT(CLUBS_TEXTS)
  const bx = useAreaT(BADGES_TEXTS)
  const describe = useChange()
  return async (occasion: BadgeOccasion): Promise<string | null> => {
    try {
      const author = await clubAuthor()
      const given = await issueAwards(author.pubkey, occasion, (badge, name) => bx.organizer[badge](name))
      if (!given) return tx.season.awardsLapsed
      givenRounds += 1
      for (const listener of givenListeners) listener()
      return null
    } catch (error) {
      return describe(error)
    }
  }
}

// The seasons this manager ended whose badges are still missing (asked once relays answer).
export function useMissingAwards(view: ClubView | undefined): BadgeOccasion[] {
  const [missing, setMissing] = useState<BadgeOccasion[]>([])
  const round = useSyncExternalStore(subscribeGiven, () => givenRounds, () => 0)
  const state = view?.state
  const me = view?.me.pubkey
  const manager = !!view && isManager(view.me.role)
  // Ended seasons change rarely; the games only matter once one did.
  const ends = state ? Object.values(state.seasons).flatMap((s) => (s.ended ? [s.ended.event] : [])).join() : ""
  useEffect(() => {
    if (!featureOn("badges") || !state || !me || !manager || !ends) {
      setMissing([])
      return
    }
    let current = true
    seasonsMissingAwards(state, view.games, me).then(
      (found) => current && setMissing(found),
      () => {},
    )
    return () => {
      current = false
    }
    // Once per ended season, profile and round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.id, me, manager, ends, round])
  return missing
}

// "Auszeichnungen vergeben: <Saison>": one tap gives what is missing.
export function AwardsRow({ occasion, onDone }: { occasion: BadgeOccasion; onDone: (problem: string | null) => void }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const give = useGiveAwards()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    const problem = await give(occasion)
    setBusy(false)
    onDone(problem)
  }
  return <ListRow title={tx.tasks.awards(occasion.name)} value={busy ? tx.season.giving : undefined} onClick={busy ? undefined : () => void run()} />
}
