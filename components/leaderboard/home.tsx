"use client"

import { useState } from "react"
import { Medal, UserRound, Users } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Segmented } from "@/components/ui/segmented"
import { useNav } from "@/components/nav/nav-context"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { SlotItems } from "@/components/shell/slot-items"
import { useT } from "@/components/i18n-provider"
import { DeviceSection } from "@/components/leaderboard/device-section"
import { featureOn } from "@/lib/shell/features"
import { getSlotItems } from "@/lib/shell/registry"

// The Rangliste tab: one tab, four areas (E-decision 2026-10-26, friends added E29): the games
// on this device, the figures the player's friends share, the season tables of the player's
// clubs, the player's tournament placings. Each area says what it counts. The three latter come
// from their areas through the registry ("leaderboard.sections"). The areas are a row of pills
// (ScopeBar): four words don't fit a segmented control on a phone without breaking one.
type Section = "device" | "friends" | "clubs" | "tournaments"
const SECTIONS: Section[] = (["device", "friends", "clubs", "tournaments"] as const).filter((s) => s !== "friends" || featureOn("friends"))

export default function LeaderboardHome() {
  const t = useT()
  const l = t.leaderboard
  const nav = useNav()
  useRegistryVersion()
  const [section, setSection] = useState<Section>("device")
  const provided = (id: Section) => getSlotItems("leaderboard.sections").some((item) => item.id === id)
  return (
    <>
      <div className="mt-3"><Segmented label={l.section} options={SECTIONS.map((s) => ({ value: s, label: l.sectionShort[s] }))} value={section} onChange={setSection} /></div>
      {section === "device" && <DeviceSection />}
      {section === "friends" &&
        (provided("friends") ? (
          <SlotItems list="leaderboard.sections" only={["friends"]} props={() => ({})} />
        ) : (
          <EmptyState icon={UserRound} title={l.friendsOffTitle} description={l.friendsOffText} />
        ))}
      {section === "clubs" &&
        (provided("clubs") ? (
          <SlotItems list="leaderboard.sections" only={["clubs"]} props={() => ({})} />
        ) : (
          <EmptyState icon={Users} title={l.clubsEmptyTitle} description={l.clubsEmptyText} primary={{ label: l.clubsOpen, onClick: () => nav.selectTab("clubs") }} />
        ))}
      {section === "tournaments" &&
        (provided("tournaments") ? (
          <SlotItems list="leaderboard.sections" only={["tournaments"]} props={() => ({})} />
        ) : (
          <EmptyState icon={Medal} title={l.tournamentsEmptyTitle} description={l.tournamentsEmptyText} primary={{ label: l.tournamentsOpen, onClick: () => nav.selectTab("tournaments") }} />
        ))}
    </>
  )
}
