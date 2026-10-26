"use client"

import { Plus, ScanLine } from "lucide-react"
import { NavIconButton } from "@/components/nav/nav-bar-items"
import { useNav } from "@/components/nav/nav-context"
import { ScreenFrame } from "@/components/nav/screen-frame"
import { LazyContent } from "@/components/nav/stack-view"
import { ClubsHome, LeaderboardHome, ProfileHome, TournamentsHome } from "@/components/shell/lazy"
import { useT } from "@/components/i18n-provider"
import { SCREENS, runAction, type ShellAction } from "@/lib/shell/registry"

// The roots of the Rangliste, Clubs, Tournaments and Profile tabs: the large title right away,
// the content below it once its code has arrived (areas take the latter three over through the
// registry slots "clubs.root", "tournaments.root" and "profile.root"). Clubs and Tournaments carry the two
// ways in on their bar, where Contacts and Mail have theirs: scan a code, add one of your own.

function BarActions({ scan, add, addLabel }: { scan: ShellAction; add: ShellAction; addLabel: string }) {
  const t = useT()
  const nav = useNav()
  return (
    <>
      <NavIconButton icon={ScanLine} label={t.shell.bar.scan} onClick={() => runAction(scan, nav)} />
      <NavIconButton icon={Plus} label={addLabel} onClick={() => runAction(add, nav)} className="-mr-1" />
    </>
  )
}

export function LeaderboardRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.leaderboard}>
      <LazyContent component={LeaderboardHome} props={{}} />
    </ScreenFrame>
  )
}

export function ClubsRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.clubs} trailing={<BarActions scan={SCREENS.clubOpenInvite} add={SCREENS.clubCreate} addLabel={t.shell.clubs.create} />}>
      <LazyContent component={ClubsHome} props={{}} />
    </ScreenFrame>
  )
}

export function TournamentsRoot() {
  const t = useT()
  return (
    <ScreenFrame title={t.shell.tabs.tournaments} trailing={<BarActions scan={SCREENS.tournamentOpenInvite} add={SCREENS.tournamentCreate} addLabel={t.shell.tournaments.create} />}>
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
