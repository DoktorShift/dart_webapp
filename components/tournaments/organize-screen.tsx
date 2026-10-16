"use client"

import { useState } from "react"
import { Settings, UserRoundPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Confirm } from "@/components/ui/confirm"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/live/waiting"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { useGiveAwards, useMissingAwards } from "@/components/tournaments/awards"
import { boardName, PRIMARY, SECONDARY, useActions, useParticipantNames, useRoundLabel } from "@/components/tournaments/common"
import { MatchesList } from "@/components/tournaments/matches-list"
import { AddBoardSheet, BoardSheet, DrawSheet, GuestsSheet, ParticipantSheet, ResultSheet } from "@/components/tournaments/organize-sheets"
import { TOURNAMENT_SCREENS } from "@/components/tournaments/screens"
import { useLiveMatches } from "@/components/tournaments/use-live-matches"
import { useAutoAdmission, useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import { waitingList, type Participant } from "@/lib/protocol/tournament-state"
import { featureOn } from "@/lib/shell/features"
import type { ScreenProps } from "@/lib/shell/registry"
import type { MatchView } from "@/lib/tournaments/engine"
import { suggestBoards } from "@/lib/tournaments/engine"
import { badgeOccasion } from "@/lib/tournaments/occasion"
import { awaitingApproval, isGuestPlace, requests, shortKey } from "@/lib/tournaments/read"
import { approveTemplate, assignTemplate, phaseTemplate } from "@/lib/tournaments/records"

type Tab = "participants" | "boards" | "results"

// The organizer's workspace (PLAN.md "Turnierleitung"): what is up next on top, then Teilnehmer,
// Boards and Ergebnisse; Einstellungen behind the gear. Every change with consequences shows
// them first (draw, correction); nothing that has started is ever silently redone.
export default function OrganizeScreen({ params }: ScreenProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const { entry, loaded } = useTournament(params.tournament ?? null)
  useLiveMatches(entry?.read)
  useAutoAdmission(entry)
  if (!loaded) return null
  if (!entry?.read.state) return <Waiting>{tx.tournament.loading}</Waiting>
  if (!entry.read.me.organizer) return <EmptyState title={tx.tournament.organize} description={tx.organize.settings.handoverText} />
  return <Workspace entry={entry} />
}

type Names = ReturnType<typeof useParticipantNames>

function Workspace({ entry }: { entry: Entry }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const o = tx.organize
  const nav = useNav()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const view = read.view
  const names = useParticipantNames(read)
  const [tab, setTab] = useState<Tab>(state.phase === "running" ? "results" : "participants")
  const actions = useActions(read.id)
  const giveAwards = useGiveAwards()
  const [awardsRound, setAwardsRound] = useState(0)
  const missingAwards = useMissingAwards(entry, awardsRound)
  const [drawing, setDrawing] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const activeBoards = Object.values(state.boards).filter((b) => b.active)
  const pending = requests(state)
  const submitted = awaitingApproval(state)
  const affected = view?.matches.filter((m) => m.affected) ?? []
  const skipped = new Set(read.skipped.map((x) => x.slot).filter((slot) => view?.match(slot)))
  const calls = view && (state.phase === "running" || state.phase === "drawn") ? suggestBoards(view, activeBoards.map((b) => b.id)) : []
  const canDraw = state.phase === "checkin" || (state.phase === "registration" && !state.settings.checkIn)
  const badges = featureOn("badges")
  // Who would get a badge if the tournament ended now (said in the finish dialog).
  const finishedOccasion = badgeOccasion({ ...read, state: { ...state, finished: state.finished ?? { event: "", by: state.organizer, at: 0 } } })

  const pairing = (m: MatchView) => `${names.nameOf(m.slots[0].participant)} – ${names.nameOf(m.slots[1].participant)}`
  const callAll = () => actions.run("calls", () => calls.map((c) => assignTemplate(state, c.match, c.board)))
  const give = async () => {
    if (!missingAwards) return
    actions.setProblem(await giveAwards(missingAwards))
    setAwardsRound((n) => n + 1)
  }
  // The end and, right after it, the badges; a lapse stays as a task until they are given.
  const finish = async () => {
    const fresh = await actions.run("finish", () => [phaseTemplate(state, "finished")])
    const occasion = fresh && badges ? badgeOccasion(fresh.read) : null
    if (occasion) actions.setProblem(await giveAwards(occasion))
    setAwardsRound((n) => n + 1)
  }

  const tasks = [
    ...(pending.length > 0 ? [{ label: o.tasks.requests(pending.length), onClick: () => setTab("participants") }] : []),
    ...(submitted.length > 0 ? [{ label: o.tasks.results(submitted.length), onClick: () => setTab("results") }] : []),
    ...(affected.length > 0 ? [{ label: o.tasks.affected(affected.length), onClick: () => setTab("results") }] : []),
    ...(skipped.size > 0 ? [{ label: o.tasks.skipped(skipped.size), onClick: () => setTab("results") }] : []),
  ]
  // The one thing the phase asks for next, as the screen's one primary action. Calling matches
  // to free boards goes out from here in one tap; one call names its pairing and board.
  const single = calls.length === 1 ? view?.match(calls[0].match) : undefined
  const primary =
    state.phase === "registration" && state.settings.checkIn
      ? { label: o.participants.openCheckIn, run: () => void actions.run("checkin", () => [phaseTemplate(state, "checkin")]) }
      : canDraw
        ? { label: o.tasks.draw, run: () => setDrawing(true) }
        : state.phase === "drawn"
          ? { label: o.tasks.start, run: () => void actions.run("start", () => [phaseTemplate(state, "running")]) }
          : state.phase === "running" && view?.complete
            ? { label: o.tasks.finish, run: () => setFinishing(true) }
            : state.phase === "paused"
              ? { label: o.participants.resume, run: () => void actions.run("resume", () => [phaseTemplate(state, "running")]) }
              : calls.length > 0
                ? { label: single ? o.tasks.call(pairing(single), boardName(state, calls[0].board)) : o.tasks.calls(calls.length), run: () => void callAll() }
                : missingAwards
                  ? { label: o.tasks.awards, run: () => void give() }
                  : null

  return (
    <div className="pb-4">
      <p className="mt-2 text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{state.settings.name}</p>
      <p className="text-[0.9375rem] text-muted-foreground">{tx.phase[state.phase]}</p>
      {actions.problem && (
        <InlineStatus tone="error" className="mt-4">
          {actions.problem}
        </InlineStatus>
      )}
      {(tasks.length > 0 || primary) && (
        <Group title={o.tasks.title}>
          {tasks.map((task) => (
            <ListRow key={task.label} title={task.label} onClick={task.onClick} />
          ))}
          {primary && (
            <div className="px-4 py-3">
              <Button onClick={primary.run} disabled={actions.busy !== null} className={`${PRIMARY} h-auto min-h-14 whitespace-normal py-2 leading-snug [overflow-wrap:anywhere]`}>
                {primary.label}
              </Button>
            </div>
          )}
        </Group>
      )}
      <div className="mt-6 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Segmented
            label={o.tabs.participants}
            options={[
              { value: "participants", label: o.tabs.participants },
              { value: "boards", label: o.tabs.boards },
              { value: "results", label: o.tabs.results },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        <button
          type="button"
          onClick={() => nav.push(TOURNAMENT_SCREENS.settings, { tournament: read.id })}
          aria-label={o.tabs.settings}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/15"
        >
          <Settings className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
      {tab === "participants" && <ParticipantsTab entry={entry} names={names} />}
      {tab === "boards" && <BoardsTab entry={entry} names={names} calls={calls} />}
      {tab === "results" && <ResultsTab entry={entry} names={names} />}
      <DrawSheet entry={entry} names={names} open={drawing} onOpenChange={setDrawing} />
      <Confirm
        open={finishing}
        onOpenChange={setFinishing}
        title={o.participants.finishTitle}
        text={!view?.complete ? o.participants.finishIncomplete : badges ? o.participants.finishText(finishedOccasion?.places.length ?? 0) : o.participants.finishPlain}
        confirm={o.participants.finish}
        onConfirm={() => void finish()}
      />
    </div>
  )
}

// Registrations, the waiting list, who is here (guests the organizer brings always are);
// before the draw also adding guests.
function ParticipantsTab({ entry, names }: { entry: Entry; names: Names }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const p = tx.organize.participants
  const state = entry.read.state as NonNullable<Entry["read"]["state"]>
  const [chosen, setChosen] = useState<Participant | null>(null)
  const [adding, setAdding] = useState(false)
  const all = Object.values(state.participants)
  const beforeDraw = state.phase === "registration" || state.phase === "checkin"
  const groups: [string, Participant[]][] = [
    [p.pending, all.filter((x) => x.status === "pending")],
    [p.registered, all.filter((x) => x.status === "registered")],
    [p.waitlist, waitingList(state)],
    [p.out, all.filter((x) => x.status === "withdrawn" || x.status === "removed")],
  ]
  const subtitle = (x: Participant) =>
    [
      isGuestPlace(x) ? (x.player ? p.linked : p.guest) : names.hintOf(x.id),
      x.late ? p.late : null,
      state.phase === "checkin" && x.status === "registered" ? (x.checkedIn || isGuestPlace(x) ? p.checkedIn : p.missing) : null,
      x.claims && x.claims.length > 0 && !x.player ? p.wantsPlace(x.claims.length) : null,
      x.status === "removed" || x.status === "withdrawn" ? (x.reason && x.reason in p.reasons ? p.reasons[x.reason as keyof typeof p.reasons] : tx.status.withdrawn) : null,
    ]
      .filter(Boolean)
      .join(" · ")
  return (
    <>
      {all.length === 0 && <p className="mt-6 px-4 text-[0.9375rem] text-muted-foreground">{p.none}</p>}
      {groups.map(([title, list]) =>
        list.length === 0 ? null : (
          <Group key={title} title={`${title} (${list.length})`}>
            {list.map((x) => (
              <ListRow key={x.id} title={names.nameOf(x.id)} subtitle={subtitle(x) || undefined} onClick={() => setChosen(x)} />
            ))}
          </Group>
        ),
      )}
      {beforeDraw && (
        <Button variant="secondary" onClick={() => setAdding(true)} className={`${SECONDARY} mt-6 gap-2`}>
          <UserRoundPlus className="h-5 w-5" aria-hidden="true" />
          {p.addGuests}
        </Button>
      )}
      <ParticipantSheet entry={entry} names={names} participant={chosen} onOpenChange={(open) => !open && setChosen(null)} />
      <GuestsSheet entry={entry} open={adding} onOpenChange={setAdding} />
    </>
  )
}

// Matches ready to call and the boards, with each board's code for its device.
function BoardsTab({ entry, names, calls }: { entry: Entry; names: Names; calls: { match: string; board: string }[] }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const b = tx.organize.boards
  const round = useRoundLabel()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const view = read.view
  const actions = useActions(read.id)
  const [adding, setAdding] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const boards = Object.values(state.boards)
  const pairing = (m: MatchView) => `${names.nameOf(m.slots[0].participant)} – ${names.nameOf(m.slots[1].participant)}`
  const stateOf = (board: string) => {
    const live = view?.matches.find((m) => m.board === board && m.state === "live")
    if (live) return b.playing(pairing(live))
    const called = view?.matches.find((m) => m.board === board && m.state === "ready")
    if (called) return b.called(pairing(called))
    return b.free
  }
  return (
    <>
      {actions.problem && (
        <InlineStatus tone="error" className="mt-4">
          {actions.problem}
        </InlineStatus>
      )}
      {view && (state.phase === "running" || state.phase === "drawn") && (
        <Group title={b.calls}>
          {calls.length === 0 && <ListRow title={boards.some((x) => x.active) ? (view.matches.some((m) => m.state === "ready" && m.board === null) ? b.noFree : b.noReady) : b.none} />}
          {calls.map((c) => {
            const m = view.match(c.match)
            if (!m) return null
            return (
              <ListRow
                key={c.match}
                title={pairing(m)}
                subtitle={`${round(m)} · ${tx.matchNumber(m.number)} → ${boardName(state, c.board)}`}
                trailing={
                  <Button variant="secondary" onClick={() => void actions.run(c.match, () => [assignTemplate(state, c.match, c.board)])} disabled={actions.busy !== null} className="h-11 rounded-xl bg-primary/10 px-4 text-[0.9375rem] font-semibold text-primary shadow-none">
                    {b.call}
                  </Button>
                }
              />
            )
          })}
        </Group>
      )}
      <Group title={tx.organize.tabs.boards}>
        {boards.length === 0 && <ListRow title={b.none} />}
        {boards.map((x) => (
          <ListRow key={x.id} title={x.name} subtitle={x.active ? stateOf(x.id) : b.inactive} onClick={x.active ? () => setChosen(x.id) : undefined} disabled={!x.active} />
        ))}
      </Group>
      <Button variant="secondary" onClick={() => setAdding(true)} className={`${SECONDARY} mt-6`}>
        {b.add}
      </Button>
      <BoardSheet entry={entry} board={chosen} onOpenChange={(open) => !open && setChosen(null)} />
      <AddBoardSheet entry={entry} open={adding} onOpenChange={setAdding} />
    </>
  )
}

// Submitted results to approve, each with who won it, then every match by round: tap one to
// enter, correct or decide it.
function ResultsTab({ entry, names }: { entry: Entry; names: Names }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const r = tx.organize.results
  const round = useRoundLabel()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const view = read.view
  const actions = useActions(read.id)
  const [chosen, setChosen] = useState<MatchView | null>(null)
  if (!view) return <p className="mt-6 px-4 text-[0.9375rem] text-muted-foreground">{tx.tournament.noMatchesText}</p>
  const byBoard = (key: string) => Object.values(state.boards).find((b) => b.key === key)?.name
  const submissions = awaitingApproval(state).flatMap((slot) => {
    const m = view.match(slot.slot)
    return m ? slot.submissions.map((sub) => ({ m, sub })) : []
  })
  return (
    <>
      {actions.problem && (
        <InlineStatus tone="error" className="mt-4">
          {actions.problem}
        </InlineStatus>
      )}
      {submissions.length > 0 && (
        <Group title={r.submitted}>
          {submissions.map(({ m, sub }) => {
            const score = sub.walkover ? tx.walkover[sub.walkover] : `${Math.max(sub.score[0], sub.score[1])}:${Math.min(sub.score[0], sub.score[1])}`
            return (
              <ListRow
                key={sub.event}
                title={r.wins(names.nameOf(sub.winner), score)}
                subtitle={`${names.nameOf(m.slots[0].participant)} – ${names.nameOf(m.slots[1].participant)} · ${round(m)} · ${sub.by === state.organizer ? r.byOrganizer : r.by(byBoard(sub.by) ?? shortKey(sub.by))}`}
                trailing={
                  <Button onClick={() => void actions.run(sub.event, () => [approveTemplate(state, m.id, sub.event)])} disabled={actions.busy !== null} className="h-11 rounded-xl px-4 text-[0.9375rem] font-semibold">
                    {r.approve}
                  </Button>
                }
              />
            )
          })}
        </Group>
      )}
      <MatchesList read={read} names={names} me={null} onSelect={(m) => m.state !== "pending" && setChosen(m)} />
      <ResultSheet entry={entry} names={names} match={chosen ? (view.match(chosen.id) ?? chosen) : null} onOpenChange={(open) => !open && setChosen(null)} />
    </>
  )
}
