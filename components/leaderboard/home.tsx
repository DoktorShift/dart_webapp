"use client"

import { useState } from "react"
import { Medal, Users } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Segmented } from "@/components/ui/segmented"
import { useNav } from "@/components/nav/nav-context"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { SlotItems } from "@/components/shell/slot-items"
import { useT } from "@/components/i18n-provider"
import { DeviceSection } from "@/components/leaderboard/device-section"
import { getSlotItems } from "@/lib/shell/registry"

// The Rangliste tab: one tab, three areas (E-decision 2026-10-26): the games on this device,
// the season tables of the player's clubs, the player's tournament placings. Each area says
// what it counts. The two latter come from their areas through the registry ("leaderboard.sections").
type Section = "device" | "clubs" | "tournaments"
const SECTIONS: Section[] = ["device", "clubs", "tournaments"]

export default function LeaderboardHome() {
  const t = useT()
  const l = t.leaderboard
  const nav = useNav()
  useRegistryVersion()
  const [section, setSection] = useState<Section>("device")
  const provided = (id: Section) => getSlotItems("leaderboard.sections").some((item) => item.id === id)
  return (
    <>
      <div className="mt-4">
        <Segmented label={l.section} options={SECTIONS.map((s) => ({ value: s, label: l.sections[s] }))} value={section} onChange={setSection} />
      </div>
      {section === "device" && <DeviceSection />}
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
