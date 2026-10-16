"use client"

import { useState } from "react"
import { Settings, UserRoundPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/live/waiting"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { boardName, SECONDARY, useActions, useParticipantNames, useRoundLabel, type Names } from "@/components/tournaments/common"
import { MatchesList } from "@/components/tournaments/matches-list"
import { useNextStep } from "@/components/tournaments/next-step"
import { AddBoardSheet, BoardSheet, GuestsSheet, ParticipantSheet, ResultSheet } from "@/components/tournaments/organize-sheets"
import { TOURNAMENT_SCREENS } from "@/components/tournaments/screens"
import { useLiveMatches } from "@/components/tournaments/use-live-matches"
import { useAutoAdmission, useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import { waitingList, type Participant } from "@/lib/protocol/tournament-state"
import type { ScreenProps } from "@/lib/shell/registry"
import type { MatchView } from "@/lib/tournaments/engine"
import { awaitingApproval, isGuestPlace, requests, shortKey } from "@/lib/tournaments/read"
import { approveTemplate, assignTemplate } from "@/lib/tournaments/records"

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

function Workspace({ entry }: { entry: Entry }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const o = tx.organize
  const nav = useNav()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const view = read.view
  const names = useParticipantNames(read)
  const [tab, setTab] = useState<Tab>(state.phase === "running" ? "results" : "participants")
  const next = useNextStep(entry, names)
  const pending = requests(state)
  const submitted = awaitingApproval(state)
  const affected = view?.matches.filter((m) => m.affected) ?? []
  const skipped = new Set(read.skipped.map((x) => x.slot).filter((slot) => view?.match(slot)))

  const tasks = [
    ...(pending.length > 0 ? [{ label: o.tasks.requests(pending.length), onClick: () => setTab("participants") }] : []),
    ...(submitted.length > 0 ? [{ label: o.tasks.results(submitted.length), onClick: () => setTab("results") }] : []),
    ...(affected.length > 0 ? [{ label: o.tasks.affected(affected.length), onClick: () => setTab("results") }] : []),
    ...(skipped.size > 0 ? [{ label: o.tasks.skipped(skipped.size), onClick: () => setTab("results") }] : []),
  ]

  return (
    <div className="pb-4">
      {/* The gear sits with the tournament's name, so the segments below get the full width. */}
      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{state.settings.name}</p>
          <p className="text-[0.9375rem] text-muted-foreground">{tx.phase[state.phase]}</p>
        </div>
        <button
          type="button"
          onClick={() => nav.push(TOURNAMENT_SCREENS.settings, { tournament: read.id })}
          aria-label={o.tabs.settings}
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/15"
        >
          <Settings className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
      {next.problem && (
        <InlineStatus tone="error" className="mt-4">
          {next.problem}
        </InlineStatus>
      )}
      {(tasks.length > 0 || next.button) && (
        <Group title={o.tasks.title}>
          {tasks.map((task) => (
            <ListRow key={task.label} title={task.label} onClick={task.onClick} />
          ))}
          {next.button && <div className="px-4 py-3">{next.button}</div>}
        </Group>
      )}
      <div className="mt-6">
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
      {tab === "participants" && <ParticipantsTab entry={entry} names={names} />}
      {tab === "boards" && <BoardsTab entry={entry} names={names} calls={next.calls} />}
      {tab === "results" && <ResultsTab entry={entry} names={names} />}
      {next.sheets}
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
