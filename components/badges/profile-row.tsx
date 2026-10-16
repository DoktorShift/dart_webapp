"use client"

import { useEffect, useMemo, useState } from "react"
import { Award } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { BADGE_SCREENS } from "@/components/badges/screens"
import { useMilestones, useOwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile } from "@/components/profile/use-profile"
import { evaluateMilestones } from "@/lib/badges/milestones"
import { seenAwardIds } from "@/lib/badges/store"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { useMatchHistory } from "@/lib/leaderboard"
import { useSession } from "@/lib/profile/session"
import { onStorageChange } from "@/lib/storage/db"
import { summarizePlayers } from "@/lib/storage/stats"

// The "Auszeichnungen" row in the Profile tab (registry "profile.rows"): how many the profile
// has, and how many from others it hasn't looked at yet. A guest sees the device's: what its
// players reached here.
export default function BadgesRow() {
  const session = useSession()
  if (session === undefined) return null
  return session ? <OwnRow /> : <GuestRow />
}

function Row({ value }: { value?: string }) {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  return <ListRow icon={Award} iconTone="orange" title={tx.list.row} value={value} onClick={() => nav.push(BADGE_SCREENS.list)} />
}

function OwnRow() {
  const tx = useAreaT(BADGES_TEXTS)
  const own = useOwnProfile()
  const badges = useOwnBadges(own?.session.pubkey ?? null)
  const { statuses } = useMilestones(own?.key ?? null, own?.history.aliases, own?.sameAs)
  const seen = useSeenAwardIds()
  if (!own || badges.awards === null || seen === null) return <Row />
  // New: awards from issuers the profile vouches for that it hasn't looked at; strangers' never.
  const unseen = badges.received.filter((a) => !seen.includes(a.award.id)).length
  // Milestones reached here (published as the profile's own awards or not) plus awards from others.
  const reached = statuses.filter((s) => s.achieved).length + badges.received.length
  return <Row value={unseen > 0 ? tx.list.rowNew(unseen) : reached > 0 ? String(reached) : undefined} />
}

function GuestRow() {
  const { all, aliases, loaded } = useMatchHistory()
  const reached = useMemo(
    () =>
      summarizePlayers(all, { aliases })
        .filter((s) => !s.unnamed)
        .reduce((n, s) => n + evaluateMilestones(all, s.key, { aliases }).filter((m) => m.achieved).length, 0),
    [all, aliases],
  )
  return <Row value={loaded && reached > 0 ? String(reached) : undefined} />
}

// The award ids the person has looked at (lib/badges/store.ts); null while read.
function useSeenAwardIds() {
  const [seen, setSeen] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => void seenAwardIds().then((ids) => alive && setSeen(ids))
    load()
    const stop = onStorageChange((message) => {
      if (message.type === "change" && message.stores.includes("kv")) load()
    })
    return () => {
      alive = false
      stop()
    }
  }, [])
  return seen
}
