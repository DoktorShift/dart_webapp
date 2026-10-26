"use client"

import type { ReactNode } from "react"
import { ChevronRight, Globe } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { AvatarStack } from "@/components/ui/avatar-stack"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { CardSection } from "@/components/common/card-section"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDateTime } from "@/lib/i18n"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { membershipLine, taskLabel, taskParams } from "@/components/clubs/common"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { useClubs } from "@/components/clubs/use-clubs"
import { clubTasks, isLeader, nextDate, type ClubView } from "@/lib/clubs/club"
import { nowSeconds } from "@/lib/nostr/time"
import { useSession } from "@/lib/profile/session"
import { SCREENS } from "@/lib/shell/registry"

// The Clubs tab (registry slot "clubs.root"): invitations waiting, each with "Beitreten", then
// "Meine Clubs" as cards (name, picture, the people in it, where you stand, the next date, at
// most one thing to do), then the best-effort list of public clubs. The two ways in, scanning a
// code and founding a club, are on the bar (components/shell/tab-roots.tsx). Without any club,
// the shell's own view.
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
            <ClubCard key={view.id} view={view} onOpen={() => nav.push(SCREENS.clubInvite, { club: view.id })} join />
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
      {discover}
    </>
  )
}

// One club: the card opens it; below it, the one thing the club wants from this person, if
// any, which opens the club right at that task. An invitation's card carries "Beitreten".
function ClubCard({ view, onOpen, join = false }: { view: ClubView; onOpen: (params?: Record<string, string>) => void; join?: boolean }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const now = nowSeconds()
  const next = nextDate(view, now)
  const task = clubTasks(view, now).find((task) => task.kind !== "answer")
  const members = view.state ? Object.keys(view.state.members) : []
  const member = view.me.status === "member"
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button type="button" onClick={() => onOpen()} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-secondary/70">
        <Avatar seed={view.id} name={view.info?.name ?? undefined} src={view.info?.picture} size={48} />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="block text-[1.0625rem] font-semibold leading-snug">{view.info?.name ?? tx.unnamed}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip tone={member && isLeader(view.me.role) ? "accent" : view.info?.archived || !member ? "neutral" : "success"}>{membershipLine(view, tx)}</Chip>
            {members.length > 0 && <AvatarStack people={members.map((seed) => ({ seed }))} label={tx.home.members(members.length)} size={20} max={3} />}
          </span>
          {member && (
            <span className="mt-1 block text-[0.8125rem] leading-snug text-muted-foreground">{next ? tx.home.next(formatDateTime(t, next.starts * 1000)) : tx.club.noDate}</span>
          )}
        </span>
        <ChevronRight className="-mr-1 h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      </button>
      {join && (
        <div className="border-t border-border px-4 py-3">
          <Button onClick={() => onOpen()} className="h-11 w-full rounded-xl text-[1.0625rem] font-semibold">
            {tx.home.join}
          </Button>
        </div>
      )}
      {task && (
        <button type="button" onClick={() => onOpen(taskParams(task))} className="flex min-h-11 w-full items-center border-t border-border px-4 py-2 text-left text-[0.9375rem] font-semibold text-primary transition-colors active:bg-secondary/70 [overflow-wrap:anywhere]">
          {taskLabel(task, tx, t)}
        </button>
      )}
    </div>
  )
}
