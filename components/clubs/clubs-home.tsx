"use client"

import type { ReactNode } from "react"
import { ChevronRight, Globe } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { CardSection } from "@/components/common/card-section"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { formatDateTime, membershipLine, taskLabel, taskParams } from "@/components/clubs/common"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { useClubs } from "@/components/clubs/use-clubs"
import { clubTasks, nextDate, type ClubView } from "@/lib/clubs/club"
import { nowSeconds } from "@/lib/nostr/time"
import { useSession } from "@/lib/profile/session"
import { SCREENS, runAction } from "@/lib/shell/registry"

// The Clubs tab (registry slot "clubs.root"): invitations waiting, then "Meine Clubs" as cards
// (name, picture, where you stand, the next date, at most one thing to do), then the two ways
// in and the best-effort list of public clubs. Without any club, the shell's own view.
export default function ClubsHome({ fallback }: { fallback: ReactNode }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const session = useSession()
  const { views, loaded } = useClubs()
  if (session === undefined || !loaded) return null
  const invitations = views.filter((v) => v.invite && v.me.status === "none")
  const mine = views.filter((v) => !invitations.includes(v) && v.me.status !== "none")
  const discover = (
    <Group>
      <ListRow icon={Globe} iconTone="teal" title={tx.home.discover} subtitle={tx.home.discoverHint} onClick={() => nav.push(CLUB_SCREENS.discover)} />
    </Group>
  )
  if (invitations.length === 0 && mine.length === 0) {
    return (
      <>
        {fallback}
        {discover}
      </>
    )
  }
  return (
    <>
      {invitations.length > 0 && (
        <CardSection title={tx.home.invitations}>
          {invitations.map((view) => (
            <ClubCard key={view.id} view={view} onOpen={() => nav.push(SCREENS.clubInvite, { club: view.id })} />
          ))}
        </CardSection>
      )}
      {mine.length > 0 && (
        <CardSection title={tx.home.mine}>
          {mine.map((view) => (
            <ClubCard key={view.id} view={view} onOpen={(params) => nav.push(CLUB_SCREENS.view, { club: view.id, name: view.info?.name ?? "", ...params })} />
          ))}
        </CardSection>
      )}
      <div className="mt-6 grid gap-2 min-[360px]:grid-cols-2">
        <Button onClick={() => runAction(SCREENS.clubCreate, nav)} className="h-12 whitespace-normal rounded-xl text-[1.0625rem] font-semibold">
          {tx.home.create}
        </Button>
        <Button
          variant="secondary"
          onClick={() => runAction(SCREENS.clubOpenInvite, nav)}
          className="h-12 whitespace-normal rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20"
        >
          {tx.home.openInvite}
        </Button>
      </div>
      {discover}
    </>
  )
}

// One club: the card opens it; below it, the one thing the club wants from this person, if
// any, which opens the club right at that task.
function ClubCard({ view, onOpen }: { view: ClubView; onOpen: (params?: Record<string, string>) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const now = nowSeconds()
  const next = nextDate(view, now)
  const task = clubTasks(view, now).find((task) => task.kind !== "answer")
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button type="button" onClick={() => onOpen()} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-secondary/70">
        <Avatar seed={view.id} name={view.info?.name ?? undefined} src={view.info?.picture} size={48} />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="block text-[1.0625rem] font-semibold leading-snug">{view.info?.name ?? tx.unnamed}</span>
          <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{membershipLine(view, tx)}</span>
          {view.me.status === "member" && (
            <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{next ? tx.home.next(formatDateTime(next.starts, t)) : tx.club.noDate}</span>
          )}
        </span>
        <ChevronRight className="-mr-1 h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      </button>
      {task && (
        <button type="button" onClick={() => onOpen(taskParams(task))} className="flex min-h-11 w-full items-center border-t border-border px-4 py-2 text-left text-[0.9375rem] font-semibold text-primary transition-colors active:bg-secondary/70 [overflow-wrap:anywhere]">
          {taskLabel(task, tx, t)}
        </button>
      )}
    </div>
  )
}
