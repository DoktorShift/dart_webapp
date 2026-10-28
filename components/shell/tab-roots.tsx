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
      <button type="button" onClick={() => runAction(scan, nav)} className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-[0.8125rem] font-medium text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        <ScanLine className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t.shell.bar.scan}
      </button>
      <NavIconButton icon={Plus} label={addLabel} onClick={() => runAction(add, nav)} />
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
