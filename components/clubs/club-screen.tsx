"use client"

import { useEffect, useRef, useState } from "react"
import { Calendar, ChartColumn, Ellipsis, Link, LogOut, Settings, Share, Target, UserRoundPlus, Users } from "lucide-react"
import { ActionRow, type Action } from "@/components/ui/action-row"
import { Avatar } from "@/components/ui/avatar"
import { AvatarStack } from "@/components/ui/avatar-stack"
import { Button } from "@/components/ui/button"
import { Chip, Chips } from "@/components/ui/chip"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Menu, type MenuItem } from "@/components/ui/menu"
import { InlineStatus } from "@/components/common/inline-status"
import { TaskRow } from "@/components/common/task-row"
import { NavBarItems } from "@/components/nav/nav-bar-items"
import { useNav } from "@/components/nav/nav-context"
import { SlotItems } from "@/components/shell/slot-items"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDateTime } from "@/lib/i18n"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { ClubHeader, SyncLine, membershipLine, taskLabel, useChange } from "@/components/clubs/common"
import { Confirm } from "@/components/ui/confirm"
import { DateAnswer, answerCounts } from "@/components/clubs/date-answer"
import { useInlineProfile } from "@/components/profile/inline-profile"
import { ClubShareSheet, InviteSheet } from "@/components/clubs/invite-sheet"
import { InvitesSheet } from "@/components/clubs/manage-sheets"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { StartGameSheet } from "@/components/clubs/start-game-sheet"
import { clubAuthor, clubReader, useClub } from "@/components/clubs/use-clubs"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { VerdictSheet } from "@/components/clubs/verdict-sheet"
import { clubTasks, isLeader, isManager, nextDate, type ClubTask, type ClubView } from "@/lib/clubs/club"
import type { ClubGame } from "@/lib/clubs/games"
import { acceptOwnership, ClubOutdatedError, joinClub, leaveClub, openOffer } from "@/lib/clubs/membership"
import { watchClub } from "@/lib/clubs/relays"
import type { Author } from "@/lib/clubs/send"
import { updateClub } from "@/lib/clubs/store"
import { grantAccess, maintainClub } from "@/lib/clubs/sync"
import { currentSeason, seasonTable } from "@/lib/clubs/table"
import { nowSeconds } from "@/lib/nostr/time"
import type { NostrEvent } from "@/lib/nostr/types"
import type { ClubState } from "@/lib/protocol/club-state"
import { readLabels } from "@/lib/protocol/tags"
import type { ScreenParams } from "@/lib/shell/nav"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"

// A club (PLAN.md "Gestaltung der Clubansichten"): its head (picture, who is in it, where you
// stand), the quick actions in a row (Spiel starten, Einladen or Tabelle, Termine), the one
// thing it wants from you, then the next club night with your answer and the current season
// with your row. Management and leaving sit behind "Mehr" in the bar; nothing of the management
// is mixed into the players' actions. Every state short of membership says what it is and what
// comes next. Opening the club asks the relays once.
export default function ClubScreen({ params }: ScreenProps) {
  const tx = useAreaT(CLUBS_TEXTS)
  const { view, loaded, missing, refresh } = useClub(params.club ?? null)
  const id = view?.id
  useEffect(() => {
    if (id) void refresh()
    // Once per club opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useWatch(view)
  if (!view) return <p className="mt-6 px-4 text-[1.0625rem] text-muted-foreground">{loaded && missing ? tx.club.state.missing : tx.club.loading}</p>
  return <ClubBody view={view} params={params} refresh={refresh} />
}

// Records that change who is in the club: a leader's device then shares access at once, so a
// member who just joined through the link isn't left waiting (lib/clubs/sync.ts).
const MEMBERSHIP_TYPES: readonly string[] = ["club.join", "club.accept", "club.role", "club.remove", "club.leave", "club.owner.offer"]
const changesMembers = (event: NostrEvent) => MEMBERSHIP_TYPES.includes(readLabels(event.tags)?.type ?? "")

// New records while the screen is open (a member joins, someone answers) go straight into the
// local copy; the store re-reads it.
function useWatch(view: ClubView | undefined) {
  const id = view?.id
  const ready = !!view?.state
  const relays = view?.relays.join(",") ?? ""
  useEffect(() => {
    if (!id || !ready) return
    const watcher = watchClub(id, relays ? relays.split(",") : [], { matches: [], dates: [] }, (event) => {
      void (async () => {
        const reader = await clubReader()
        await updateClub(id, { events: [event] }, reader.pubkey)
        if (changesMembers(event)) await maintainClub(id, reader)
      })().catch(() => {
        // Signed out meanwhile, or the copy can't be written now: the next refresh brings it.
      })
    })
    return () => watcher.close()
  }, [id, ready, relays])
}

type Run = (action: (author: Author) => Promise<unknown>) => Promise<void>

function ClubBody({ view, params, refresh }: { view: ClubView; params: ScreenParams; refresh: () => Promise<ClubView | null> }) {
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
  // The start sheet: open, closed (slides away), or left behind when a game starts: setup
  // covers and freezes the tabs at once, and a sheet still sliding away would never finish.
  const [sheet, setSheet] = useState<"closed" | "open" | "left">("closed")
  const [inviting, setInviting] = useState(false)
  const [invites, setInvites] = useState(false)
  const [verdict, setVerdict] = useState<ClubGame | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const names = useProfileNames(state?.offer ? [state.owner] : [])

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
    else if (task.kind === "access") void run((author) => grantAccess(view.id, author))
    else sub(CLUB_SCREENS.manage)
  }

  const tasks = state ? clubTasks(view, now).filter((task) => task.kind !== "answer") : []
  const next = nextDate(view, now)
  const season = state ? currentSeason(state, now) : null
  const table = state && season ? seasonTable(season, view.games, state.results[season.id]) : null
  const myRow = table && me.pubkey ? (table.ranked.find((r) => r.pubkey === me.pubkey) ?? table.unranked.find((r) => r.pubkey === me.pubkey) ?? null) : null
  const waiting = table && me.pubkey ? table.open.filter((o) => o.why !== "excluded" && o.game.agreement.seats.some((s) => s.pubkey === me.pubkey)).length : 0

  // Opened from the task line on the Clubs tab: straight into that task.
  const openedTask = useRef(false)
  useEffect(() => {
    if (openedTask.current || !params.task) return
    openedTask.current = true
    const task = tasks.find((task) => task.kind === params.task && (!("game" in task) || task.game.match === params.game))
    if (task) onTask(task)
    // Once, on the first render with the club's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Accepted on a device that just loaded (club.md "Übergabe"), and only counted once this
  // device's own replay applied it: otherwise no reader would.
  const accept = () =>
    void run(async (author) => {
      const fresh = (await refresh())?.state
      if (!fresh) throw new ClubOutdatedError()
      await acceptOwnership(fresh, author)
      if ((await refresh())?.state?.owner !== author.pubkey) throw new ClubOutdatedError()
    })

  // Leaders invite; members too where the club lets them (their link only asks); in a public
  // club everyone else can at least share it.
  const mayInvite = manager || (me.status === "member" && state?.info.membersInvite === true)
  const canInvite = mayInvite || state?.info.visibility === "public"
  const actions: Action[] = !state || me.status !== "member" ? [] : [
    ...(archived ? [] : [{ id: "play", icon: Target, label: tx.club.actions.play, onClick: () => setSheet("open") }]),
    ...(archived || !canInvite ? [] : [{ id: "invite", icon: mayInvite ? UserRoundPlus : Share, label: mayInvite ? tx.club.actions.invite : tx.club.actions.share, onClick: () => setInviting(true) }]),
    { id: "dates", icon: Calendar, label: tx.club.actions.dates, onClick: () => sub(CLUB_SCREENS.dates) },
    ...(archived || !canInvite ? [{ id: "table", icon: ChartColumn, label: tx.club.actions.table, onClick: () => sub(CLUB_SCREENS.table) }] : []),
  ].slice(0, 3)
  const menu: MenuItem[] = !state || me.status !== "member" ? [] : [
    ...(leader ? [{ id: "manage", icon: Settings, label: tx.club.manage, onSelect: () => sub(CLUB_SCREENS.manage) }] : []),
    ...(manager && !archived ? [{ id: "invites", icon: Link, label: tx.manage.invites, onSelect: () => setInvites(true) }] : []),
    ...(me.role !== "owner" ? [{ id: "leave", icon: LogOut, label: tx.club.leave, destructive: true, onSelect: () => setLeaving(true) }] : []),
  ]

  return (
    <div className="pb-4">
      {menu.length > 0 && (
        <NavBarItems>
          <Menu icon={Ellipsis} label={t.shell.bar.more} items={menu} className="-mr-1" />
        </NavBarItems>
      )}
      {!state || me.status !== "member" ? (
        <ClubHeader view={view} subtitle={membershipLine(view, tx)} />
      ) : (
        <ClubHero view={view} state={state} onMembers={() => sub(CLUB_SCREENS.members)} />
      )}
      {!state ? (
        <NoState view={view} />
      ) : me.status !== "member" ? (
        <Outsider view={view} state={state} busy={busy} problem={problem} run={run} />
      ) : (
        <>
          <ActionRow actions={actions} className="mt-4" />
          {archived && (
            <InlineStatus tone="info" className="mt-4">
              {tx.club.state.archived}
            </InlineStatus>
          )}
          {tasks[0] && <TaskRow label={taskLabel(tasks[0], tx, t)} disabled={busy} onClick={() => onTask(tasks[0])} className="mt-4" />}
          {problem && (
            <InlineStatus tone="error" className="mt-4">
              {problem}
            </InlineStatus>
          )}

          <Group title={tx.club.nextDate}>
            {next ? (
              <>
                <ListRow
                  title={next.title}
                  subtitle={[formatDateTime(t, next.starts * 1000), next.place].filter(Boolean).join(" · ")}
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
                subtitle={[
                  myRow ? (myRow.rank !== null ? tx.club.yourRow(myRow.rank, myRow.points, myRow.games) : tx.club.yourRowUnranked(myRow.games, table.rules.minGames)) : waiting === 0 ? tx.club.notInTable : null,
                  waiting > 0 ? tx.club.waitingGames(waiting) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
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
            {!actions.some((a) => a.id === "table") && <ListRow icon={ChartColumn} iconTone="green" title={tx.club.table} onClick={() => sub(CLUB_SCREENS.table)} />}
            {leader && <ListRow icon={Settings} iconTone="gray" title={tx.club.manage} onClick={() => sub(CLUB_SCREENS.manage)} />}
          </Group>

          {sheet !== "left" && (
            <StartGameSheet
              view={view}
              state={state}
              open={sheet === "open"}
              onOpenChange={(open) => setSheet(open ? "open" : "closed")}
              onStart={(type, preset) => {
                setSheet("left")
                nav.openSetup(type, preset)
              }}
            />
          )}
          {mayInvite ? <InviteSheet view={view} state={state} open={inviting} onOpenChange={setInviting} /> : <ClubShareSheet view={view} open={inviting} onOpenChange={setInviting} />}
          {manager && <InvitesSheet view={view} state={state} open={invites} onOpenChange={setInvites} />}
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
          {openOffer(state, now) && (
            <Confirm
              open={accepting}
              onOpenChange={setAccepting}
              title={tx.club.acceptTitle}
              text={`${tx.club.state.offer(names(state.owner).name ?? tx.unnamed)} ${tx.club.acceptText}`}
              confirm={tx.club.accept}
              onConfirm={accept}
            />
          )}
        </>
      )}
      <SyncLine view={view} onRefresh={refresh} />
    </div>
  )
}

// The head of a club for its members: the picture, the people in it as faces (tap: the list),
// and where this person stands, in chips. The name is the screen's title.
function ClubHero({ view, state, onMembers }: { view: ClubView; state: ClubState; onMembers: () => void }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const info = view.info
  const pubkeys = Object.keys(state.members)
  const names = useProfileNames(pubkeys.slice(0, 4))
  const people = pubkeys.map((p, i) => ({ seed: p, ...(i < 4 ? { name: names(p).name, src: names(p).picture } : {}) }))
  return (
    <section className="mt-4">
      <div className="flex items-center gap-4">
        <Avatar seed={view.id} name={info?.name ?? undefined} src={info?.picture} size={72} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Chips>
            <Chip tone={isLeader(view.me.role) ? "accent" : "neutral"}>{tx.roles[view.me.role ?? "member"]}</Chip>
            <Chip>{info?.visibility === "public" ? tx.club.visibility.public : tx.club.visibility.closed}</Chip>
            {info?.archived && <Chip tone="warning">{tx.home.status.archived}</Chip>}
          </Chips>
          <AvatarStack people={people} label={tx.home.members(pubkeys.length)} onClick={onMembers} />
        </div>
      </div>
      {info?.about && <p className="mt-3 text-[0.9375rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{info.about}</p>}
    </section>
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
  const guest = useInlineProfile()
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
      {view.invite && me.status === "none" && (
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
