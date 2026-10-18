"use client"

import { Award } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { BADGE_SCREENS } from "@/components/badges/screens"
import { awardTexts, milestoneTexts } from "@/components/badges/texts"
import type { ValidAward } from "@/lib/badges/awards"
import type { MilestoneStatus } from "@/lib/badges/milestones"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"

// The rows of the badges lists (./badges-screen.tsx, ./more-screen.tsx), each opening the
// badge's own screen.

// An award of the signed-in profile. One whose result was corrected says so in words and with a
// grey icon, never by colour alone.
export function AwardRow({ award, subtitle, voided = false }: { award: ValidAward; subtitle?: string; voided?: boolean }) {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const { name } = awardTexts(tx, award)
  return <ListRow icon={Award} iconTone={voided ? "gray" : "orange"} title={name} subtitle={voided ? tx.list.corrected : subtitle} onClick={() => nav.push(BADGE_SCREENS.badge, { id: award.award.id, name })} />
}

// A milestone of the catalog for a player on this device, reached or still within reach.
export function MilestoneRow({ status, playerKey, subtitle, reached }: { status: MilestoneStatus; playerKey: string; subtitle?: string; reached: boolean }) {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const { name } = milestoneTexts(tx, status.milestone)
  return (
    <ListRow
      icon={Award}
      iconTone={reached ? "orange" : "gray"}
      title={name}
      subtitle={subtitle}
      onClick={() => nav.push(BADGE_SCREENS.badge, { milestone: status.milestone.id, key: playerKey, name })}
    />
  )
}
