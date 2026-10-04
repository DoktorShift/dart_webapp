"use client"

import { Medal, Users } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { ScreenFrame } from "@/components/nav/screen-frame"
import { LazyContent } from "@/components/nav/stack-view"
import { useNav } from "@/components/nav/nav-context"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { GuestProfile } from "@/components/shell/lazy"
import { useT } from "@/components/i18n-provider"
import { SCREENS, getSlot, runAction, type SlotId } from "@/lib/shell/registry"
import type { ReactNode } from "react"

// A tab root an area can take over (registry slot), with the shell's own view as fallback.
function Slotted({ id, fallback }: { id: SlotId; fallback: ReactNode }) {
  useRegistryVersion()
  const Slot = getSlot(id)
  return Slot ? <Slot fallback={fallback} /> : fallback
}

// Clubs before the clubs area exists, or while the player is in none: what clubs are for, and
// the two ways in.
function ClubsEmpty() {
  const t = useT()
  const nav = useNav()
  return (
    <EmptyState
      icon={Users}
      title={t.shell.clubs.emptyTitle}
      description={t.shell.clubs.emptyText}
      primary={{ label: t.shell.clubs.create, onClick: () => runAction(SCREENS.clubCreate, nav) }}
      secondary={{ label: t.shell.clubs.openInvite, onClick: () => runAction(SCREENS.clubOpenInvite, nav) }}
    />
  )
}

function TournamentsEmpty() {
  const t = useT()
  const nav = useNav()
  return (
    <EmptyState
      icon={Medal}
      title={t.shell.tournaments.emptyTitle}
      description={t.shell.tournaments.emptyText}
      primary={{ label: t.shell.tournaments.create, onClick: () => runAction(SCREENS.tournamentCreate, nav) }}
      secondary={{ label: t.shell.tournaments.openInvite, onClick: () => runAction(SCREENS.tournamentOpenInvite, nav) }}
    />
  )
}

export function ClubsRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.clubs}>
      <Slotted id="clubs.root" fallback={<ClubsEmpty />} />
    </ScreenFrame>
  )
}

export function TournamentsRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.tournaments}>
      <Slotted id="tournaments.root" fallback={<TournamentsEmpty />} />
    </ScreenFrame>
  )
}

// The signed-in profile registers the slot "profile.root" and shows the guest view while no
// profile exists on this device.
export function ProfileRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.profile}>
      <Slotted id="profile.root" fallback={<LazyContent component={GuestProfile} props={{}} />} />
    </ScreenFrame>
  )
}
