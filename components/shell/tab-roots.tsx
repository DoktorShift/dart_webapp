"use client"

import { ScreenFrame } from "@/components/nav/screen-frame"
import { LazyContent } from "@/components/nav/stack-view"
import { ClubsHome, ProfileHome, TournamentsHome } from "@/components/shell/lazy"
import { useT } from "@/components/i18n-provider"

// The roots of the Clubs, Tournaments and Profile tabs: the large title right away, the content
// below it from tab-homes.tsx once its code has arrived (areas take it over through the registry
// slots "clubs.root", "tournaments.root" and "profile.root").

export function ClubsRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.clubs}>
      <LazyContent component={ClubsHome} props={{}} />
    </ScreenFrame>
  )
}

export function TournamentsRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.tournaments}>
      <LazyContent component={TournamentsHome} props={{}} />
    </ScreenFrame>
  )
}

export function ProfileRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.profile}>
      <LazyContent component={ProfileHome} props={{}} />
    </ScreenFrame>
  )
}
