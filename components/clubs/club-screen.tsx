"use client"

import { useEffect, useState } from "react"
import { Calendar, ChartColumn, ChevronRight, Settings, Users } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { SlotItems } from "@/components/shell/slot-items"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { ClubHeader, SyncLine, formatDateTime, membershipLine, taskLabel, useChange } from "@/components/clubs/common"
import { DateAnswer, answerCounts } from "@/components/clubs/date-answer"
import { useGuestProfile } from "@/components/clubs/guest-profile"
import { InviteSheet } from "@/components/clubs/invite-sheet"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { StartGameSheet } from "@/components/clubs/start-game-sheet"
import { clubAuthor, useClub } from "@/components/clubs/use-clubs"
import { useNames } from "@/components/clubs/use-names"
import { VerdictSheet } from "@/components/clubs/verdict-sheet"
import { clubTasks, isLeader, isManager, nextDate, type ClubTask, type ClubView } from "@/lib/clubs/club"
import type { ClubGame } from "@/lib/clubs/games"
import { acceptOwnership, joinClub, leaveClub } from "@/lib/clubs/membership"
import { watchClub } from "@/lib/clubs/relays"
import type { Author } from "@/lib/clubs/send"
import { updateClub } from "@/lib/clubs/store"
import { currentSeason, seasonTable } from "@/lib/clubs/table"
import { nowSeconds } from "@/lib/nostr/time"
import type { ClubState } from "@/lib/protocol/club-state"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"

// A club (PLAN.md "Gestaltung der Clubansichten"): the one thing it wants from you first, then
// the next club night with your answer, the current season with your row, "Spiel starten", and
// the sections Spieler, Tabelle, Termine & Turniere. Leaders get "Club verwalten"; nothing of
// the management is mixed into the players' actions. Every state short of membership says
// what it is and what comes next.
export default function ClubScreen({ params }: ScreenProps) {
  const tx = useAreaT(CLUBS_TEXTS)
  const { view, loaded, missing, refresh } = useClub(params.club ?? null)
  useWatch(view)
  if (!view) return <p className="mt-6 px-4 text-[1.0625rem] text-muted-foreground">{loaded && missing ? tx.club.state.missing : tx.club.loading}</p>
  return <ClubBody view={view} refresh={() => void refresh()} />
}

// New records while the screen is open (a member joins, someone answers) go straight into the
// local copy; the store re-reads it.
function useWatch(view: ClubView | undefined) {
  const id = view?.id
  const ready = !!view?.state
  const relays = view?.relays.join(",") ?? ""
  useEffect(() => {
    if (!id || !ready) return
    const watcher = watchClub(id, relays ? relays.split(",") : [], { matches: [], dates: [] }, (event) => void updateClub(id, { events: [event] }))
    return () => watcher.close()
  }, [id, ready, relays])
}

type Run = (action: (author: Author) => Promise<unknown>) => Promise<void>

function ClubBody({ view, refresh }: { view: ClubView; refresh: () => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const describe = useChange()
  const now = nowSeconds()
  const { state, me, info } = view
  const name = info?.name ?? ""
  const leader = isLeader(me.role)
  const manager = isManager(me.role)
  const archived = !!info?.archived
  const [playing, setPlaying] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [verdict, setVerdict] = useState<ClubGame | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const names = useNames(state?.offer ? [state.owner] : [])

  const run: Run = async (action) => {
    setBusy(true)
    setProblem(null)
    try {
      await action(await clubAuthor())
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }
  const sub = (screen: string) => nav.push(screen, { club: view.id, name })
  const onTask = (task: ClubTask) => {
    if (task.kind === "ownership") setAccepting(true)
    else if (task.kind === "verdict") setVerdict(task.game)
    else sub(CLUB_SCREENS.manage)
  }

  const tasks = state ? clubTasks(view, now).filter((task) => task.kind !== "answer") : []
  const next = nextDate(view, now)
  const season = state ? currentSeason(state, now) : null
  const table = state && season ? seasonTable(season, view.games, state.results[season.id]) : null
  const myRow = table && me.pubkey ? (table.ranked.find((r) => r.pubkey === me.pubkey) ?? table.unranked.find((r) => r.pubkey === me.pubkey) ?? null) : null

  return (
    <div className="pb-4">
      <ClubHeader view={view} subtitle={membershipLine(view, tx)} />
      {!state ? (
        <NoState view={view} />
      ) : me.status !== "member" ? (
        <Outsider view={view} state={state} busy={busy} problem={problem} run={run} />
      ) : (
        <>
          {archived && (
            <InlineStatus tone="info" className="mt-4">
              {tx.club.state.archived}
            </InlineStatus>
          )}
          {tasks[0] && (
            <button
              type="button"
              onClick={() => onTask(tasks[0])}
              className="mt-4 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-3 text-left text-[1.0625rem] font-semibold text-primary-foreground shadow active:brightness-95"
            >
              <span className="[overflow-wrap:anywhere]">{taskLabel(tasks[0], tx, t)}</span>
              <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
            </button>
          )}
          {problem && (
            <InlineStatus tone="error" className="mt-4">
              {problem}
            </InlineStatus>
          )}
          {!archived && (
            <div className="mt-4 grid gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto]">
              <Button onClick={() => setPlaying(true)} className="h-12 whitespace-normal rounded-xl text-[1.0625rem] font-semibold">
                {tx.club.play}
              </Button>
              {manager && (
                <Button
                  variant="secondary"
                  onClick={() => setInviting(true)}
                  className="h-12 whitespace-normal rounded-xl bg-primary/10 px-5 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20"
                >
                  {tx.club.invite}
                </Button>
              )}
            </div>
          )}

          <Group title={tx.club.nextDate}>
            {next ? (
              <>
                <ListRow
                  title={next.title}
                  subtitle={[formatDateTime(next.starts, t), next.place].filter(Boolean).join(" · ")}
                  value={tx.dates.coming(answerCounts(next).yes, answerCounts(next).maybe)}
                  onClick={() => sub(CLUB_SCREENS.dates)}
                />
                {!archived && (
                  <div className="px-4 py-3">
                    <DateAnswer view={view} state={state} date={next} />
                  </div>
                )}
              </>
            ) : (
              <ListRow title={tx.club.noDate} subtitle={leader && !archived ? tx.dates.noneLeader : undefined} onClick={() => sub(CLUB_SCREENS.dates)} />
            )}
          </Group>

          <Group title={tx.club.season}>
            {season && table ? (
              <ListRow
                title={season.name}
                subtitle={myRow ? (myRow.rank !== null ? tx.club.yourRow(myRow.rank, myRow.points, myRow.games) : tx.club.yourRowUnranked(myRow.games, table.rules.minGames)) : tx.club.notInTable}
                value={tx.club.fullTable}
                onClick={() => sub(CLUB_SCREENS.table)}
              />
            ) : (
              <ListRow
                title={tx.club.noSeason}
                subtitle={manager && !archived ? tx.table.noSeasonLeader : tx.table.noSeasonText}
                onClick={() => sub(manager && !archived ? CLUB_SCREENS.season : CLUB_SCREENS.table)}
              />
            )}
          </Group>

          <SlotItems list="club.tournaments" props={() => ({ club: view.id, name, leader, compact: true })} className="mt-4 empty:hidden" />

          <Group>
            <ListRow icon={Users} iconTone="blue" title={tx.club.members} value={Object.keys(state.members).length} onClick={() => sub(CLUB_SCREENS.members)} />
            <ListRow icon={ChartColumn} iconTone="green" title={tx.club.table} onClick={() => sub(CLUB_SCREENS.table)} />
            <ListRow icon={Calendar} iconTone="orange" title={tx.club.dates} onClick={() => sub(CLUB_SCREENS.dates)} />
          </Group>
          {leader && (
            <Group>
              <ListRow icon={Settings} iconTone="gray" title={tx.club.manage} onClick={() => sub(CLUB_SCREENS.manage)} />
            </Group>
          )}
          {me.role !== "owner" && (
            <Group>
              <ListRow title={tx.club.leave} destructive onClick={() => setLeaving(true)} />
            </Group>
          )}

          <StartGameSheet view={view} state={state} open={playing} onOpenChange={setPlaying} />
          <InviteSheet view={view} state={state} open={inviting} onOpenChange={setInviting} />
          <VerdictSheet view={view} state={state} game={verdict} open={verdict !== null} onOpenChange={(open) => !open && setVerdict(null)} />
          <Confirm
            open={leaving}
            onOpenChange={setLeaving}
            title={tx.club.leaveTitle}
            text={tx.club.leaveText}
            confirm={tx.club.leaveConfirm}
            destructive
            onConfirm={() => void run((author) => leaveClub(view.id, state.log.applied.at(-1)?.at ?? 0, author))}
          />
          {state.offer && (
            <Confirm
              open={accepting}
              onOpenChange={setAccepting}
              title={tx.club.acceptTitle}
              text={`${tx.club.state.offer(names(state.owner).name ?? tx.unnamed)} ${tx.club.acceptText}`}
              confirm={tx.club.accept}
              onConfirm={() => void run((author) => acceptOwnership(state, author))}
            />
          )}
        </>
      )}
      <SyncLine view={view} onRefresh={refresh} />
    </div>
  )
}

// The club's records can't be read: joined a closed club and waiting for access, an invitation
// not used yet, a closed club looked at without one, or nothing found.
function NoState({ view }: { view: ClubView }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const text = view.me.status === "joined" ? tx.club.state.joined : view.problem === "sealed" ? tx.club.state.sealed : tx.club.state.missing
  return (
    <>
      <InlineStatus tone={view.me.status === "joined" ? "success" : "info"} className="mt-4">
        {text}
      </InlineStatus>
      {view.invite && view.me.status === "none" && (
        <Button onClick={() => nav.replaceTop(SCREENS.clubInvite, { club: view.id })} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {tx.home.status.invitation}
        </Button>
      )}
    </>
  )
}

// Someone who reads the club but is no member: a request waiting, a former member, or a
// visitor of a public club who can ask to join.
function Outsider({ view, state, busy, problem, run }: { view: ClubView; state: ClubState; busy: boolean; problem: string | null; run: Run }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const guest = useGuestProfile()
  const { me } = view
  const canAsk = state.info.visibility === "public" && !state.info.archived && me.status !== "request"
  const text = me.status === "request" ? tx.club.state.request : me.status === "removed" ? tx.club.state.removed : me.status === "left" ? tx.club.state.left : tx.club.state.outsider
  return (
    <>
      <InlineStatus tone="info" className="mt-4">
        {text}
      </InlineStatus>
      {state.info.archived && (
        <InlineStatus tone="info" className="mt-2">
          {tx.club.state.archived}
        </InlineStatus>
      )}
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      {me.status === "request" && (
        <Button variant="ghost" disabled={busy} onClick={() => void run((author) => leaveClub(view.id, me.request?.at ?? 0, author))} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
          {tx.club.withdraw}
        </Button>
      )}
      {view.invite && me.status !== "request" && (
        <Button onClick={() => nav.replaceTop(SCREENS.clubInvite, { club: view.id })} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {tx.home.status.invitation}
        </Button>
      )}
      {canAsk && !view.invite && (
        <>
          {guest.fields}
          <Button
            disabled={!guest.ready || busy}
            onClick={() => void run(async (author) => (await guest.ensure()) && joinClub(view.id, null, author))}
            className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold"
          >
            {tx.club.requestNone}
          </Button>
          <p className="mt-2 px-4 text-[0.8125rem] text-muted-foreground">{tx.club.requestHint}</p>
          {guest.dialog}
        </>
      )}
    </>
  )
}

// One question with a cancel and one answer; red when the answer removes something.
export function Confirm({
  open,
  onOpenChange,
  title,
  text,
  confirm,
  destructive,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  text: string
  confirm: string
  destructive?: boolean
  onConfirm: () => void
}) {
  const t = useT()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">{title}</AlertDialogTitle>
          <AlertDialogDescription>{text}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={destructive ? "h-11 bg-danger text-white hover:bg-danger/90" : "h-11"}>
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
