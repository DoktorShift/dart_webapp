"use client"

import { useState } from "react"
import { ChevronDown, Printer, UserRoundPlus } from "lucide-react"
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
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/live/waiting"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { boardName, formatDateTime, PRIMARY, SECONDARY, SyncLine, useActions, useParticipantNames, useRoundLabel } from "@/components/tournaments/common"
import { MatchRow } from "@/components/tournaments/matches-list"
import { AddBoardSheet, BoardSheet, DetailsSheet, DrawSheet, GuestsSheet, HandoverSheet, ParticipantSheet, ResultSheet } from "@/components/tournaments/organize-sheets"
import { TOURNAMENT_SCREENS } from "@/components/tournaments/screens"
import { useLiveMatches } from "@/components/tournaments/use-live-matches"
import { useNames } from "@/components/tournaments/use-names"
import { useAutoAdmission, useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import { relayHost } from "@/lib/profile/relay-status"
import { waitingList, type Participant } from "@/lib/protocol/tournament-state"
import type { MatchView } from "@/lib/tournaments/engine"
import { suggestBoards } from "@/lib/tournaments/engine"
import { badgeOccasion } from "@/lib/tournaments/occasion"
import { awaitingApproval, isGuestPlace, requests, shortKey } from "@/lib/tournaments/read"
import { approveTemplate, assignTemplate, cancelOfferTemplate, phaseTemplate } from "@/lib/tournaments/records"
import { tournamentRelays } from "@/lib/tournaments/send"
import type { ScreenProps } from "@/lib/shell/registry"
import { cn } from "@/lib/utils"

type Tab = "participants" | "boards" | "results" | "settings"

// The organizer's workspace (PLAN.md "Turnierleitung"): what is up next on top, then Teilnehmer,
// Boards, Ergebnisse and Einstellungen. Every change with consequences shows them first
// (draw, correction); nothing that has started is ever silently redone.
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
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const o = tx.organize
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const view = read.view
  const names = useParticipantNames(read)
  const [tab, setTab] = useState<Tab>(state.phase === "running" ? "results" : "participants")
  const actions = useActions(read.id)
  const [drawing, setDrawing] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const activeBoards = Object.values(state.boards).filter((b) => b.active)
  const pending = requests(state)
  const submitted = awaitingApproval(state)
  const affected = view?.matches.filter((m) => m.affected) ?? []
  const calls = view ? suggestBoards(view, activeBoards.map((b) => b.id)) : []
  const beforeDraw = state.phase === "registration" || state.phase === "checkin"
  const canDraw = state.phase === "checkin" || (state.phase === "registration" && !state.settings.checkIn)
  const occasion = badgeOccasion({ ...read, state: { ...state, finished: state.finished ?? { event: "", by: state.organizer, at: 0 } } })

  const tasks = [
    ...(pending.length > 0 ? [{ label: o.tasks.requests(pending.length), tab: "participants" as Tab }] : []),
    ...(submitted.length > 0 ? [{ label: o.tasks.results(submitted.length), tab: "results" as Tab }] : []),
    ...(affected.length > 0 ? [{ label: o.tasks.affected(affected.length), tab: "results" as Tab }] : []),
    ...(calls.length > 0 && (state.phase === "running" || state.phase === "drawn") ? [{ label: o.tasks.calls(calls.length), tab: "boards" as Tab }] : []),
  ]
  const phaseAction =
    state.phase === "registration" && state.settings.checkIn ? (
      <Button onClick={() => void actions.run("checkin", () => [phaseTemplate(state, "checkin")])} disabled={actions.busy !== null} className={PRIMARY}>
        {o.participants.openCheckIn}
      </Button>
    ) : canDraw ? (
      <Button onClick={() => setDrawing(true)} disabled={actions.busy !== null} className={PRIMARY}>
        {o.tasks.draw}
      </Button>
    ) : state.phase === "drawn" ? (
      <Button onClick={() => void actions.run("start", () => [phaseTemplate(state, "running")])} disabled={actions.busy !== null} className={PRIMARY}>
        {o.tasks.start}
      </Button>
    ) : state.phase === "running" && view?.complete ? (
      <Button onClick={() => setFinishing(true)} disabled={actions.busy !== null} className={PRIMARY}>
        {o.tasks.finish}
      </Button>
    ) : state.phase === "paused" ? (
      <Button onClick={() => void actions.run("resume", () => [phaseTemplate(state, "running")])} disabled={actions.busy !== null} className={PRIMARY}>
        {o.participants.resume}
      </Button>
    ) : null

  return (
    <div className="pb-4">
      <p className="mt-2 text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{state.settings.name}</p>
      <p className="text-[0.9375rem] text-muted-foreground">{tx.phase[state.phase]}</p>
      {actions.problem && (
        <InlineStatus tone="error" className="mt-4">
          {actions.problem}
        </InlineStatus>
      )}
      {(tasks.length > 0 || phaseAction) && state.phase !== "finished" && state.phase !== "cancelled" && (
        <Group title={o.tasks.title}>
          {tasks.map((task) => (
            <ListRow key={task.label} title={task.label} onClick={() => setTab(task.tab)} />
          ))}
          {phaseAction && <div className="px-4 py-3">{phaseAction}</div>}
        </Group>
      )}
      <div className="mt-6">
        <Segmented
          label={o.tabs.participants}
          options={[
            { value: "participants", label: o.tabs.participants },
            { value: "boards", label: o.tabs.boards },
            { value: "results", label: o.tabs.results },
            { value: "settings", label: o.tabs.settings },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "participants" && <ParticipantsTab entry={entry} names={names} beforeDraw={beforeDraw} />}
      {tab === "boards" && <BoardsTab entry={entry} names={names} calls={calls} />}
      {tab === "results" && <ResultsTab entry={entry} names={names} />}
      {tab === "settings" && <SettingsTab entry={entry} names={names} />}
      <DrawSheet entry={entry} names={names} open={drawing} onOpenChange={setDrawing} />
      <AlertDialog open={finishing} onOpenChange={setFinishing}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{o.participants.finishTitle}</AlertDialogTitle>
            <AlertDialogDescription>{view?.complete ? o.participants.finishText(occasion?.places.length ?? 0) : o.participants.finishIncomplete}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            {/* Integration point (badges track): after this phase change, build badgeOccasion(read) of
                the fresh reading and call issueAwards(session.pubkey, occasion, texts) from
                lib/badges/organizer.ts; the coordinator wires it (lib/tournaments/occasion.ts). */}
            <AlertDialogAction className="h-11" onClick={() => void actions.run("finish", () => [phaseTemplate(state, "finished")])}>
              {o.participants.finish}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type Names = ReturnType<typeof useParticipantNames>

// Registrations, the waiting list, who is here, guests; before the draw also late entries.
function ParticipantsTab({ entry, names, beforeDraw }: { entry: Entry; names: Names; beforeDraw: boolean }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const p = tx.organize.participants
  const state = entry.read.state as NonNullable<Entry["read"]["state"]>
  const [chosen, setChosen] = useState<Participant | null>(null)
  const [adding, setAdding] = useState(false)
  const all = Object.values(state.participants)
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
      state.settings.checkIn && x.status === "registered" && !isGuestPlace(x) ? (x.checkedIn ? p.checkedIn : p.missing) : null,
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
  const matchOf = (id: string) => view?.match(id)
  const pairing = (m: MatchView) => `${names.nameOf(m.slots[0].participant)} – ${names.nameOf(m.slots[1].participant)}`
  const stateOf = (board: string) => {
    const live = view?.matches.find((m) => m.board === board && m.state === "live")
    if (live) return b.playing(pairing(live))
    const called = view?.matches.find((m) => m.board === board && m.state === "ready")
    if (called) return b.called(pairing(called))
    return b.free
  }
  const callAll = () => actions.run("calls", () => calls.map((c) => assignTemplate(state, c.match, c.board)))
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
            const m = matchOf(c.match)
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
          {calls.length > 1 && (
            <div className="px-4 py-3">
              <Button onClick={() => void callAll()} disabled={actions.busy !== null} className={PRIMARY}>
                {b.callAll(calls.length)}
              </Button>
            </div>
          )}
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

// Submitted results to approve, then every match: tap one to enter, approve or correct.
function ResultsTab({ entry, names }: { entry: Entry; names: Names }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const r = tx.organize.results
  const round = useRoundLabel()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const view = read.view
  const actions = useActions(read.id)
  const [chosen, setChosen] = useState<MatchView | null>(null)
  const submitted = awaitingApproval(state)
  if (!view) return <p className="mt-6 px-4 text-[0.9375rem] text-muted-foreground">{tx.tournament.noMatchesText}</p>
  const matches = view.matches.filter((m) => m.state !== "void" && m.state !== "pending")
  const byBoard = (key: string) => Object.values(state.boards).find((b) => b.key === key)?.name
  return (
    <>
      {actions.problem && (
        <InlineStatus tone="error" className="mt-4">
          {actions.problem}
        </InlineStatus>
      )}
      {submitted.length > 0 && (
        <Group title={r.submitted}>
          {submitted.map((slot) => {
            const m = view.match(slot.slot)
            const sub = slot.submissions.at(-1)
            if (!m || !sub) return null
            const score = sub.walkover ? tx.walkover[sub.walkover] : `${sub.score[0]}:${sub.score[1]}`
            return (
              <ListRow
                key={slot.slot}
                title={`${names.nameOf(m.slots[0].participant)} – ${names.nameOf(m.slots[1].participant)}`}
                subtitle={`${round(m)} · ${score} · ${sub.by === state.organizer ? r.byOrganizer : r.by(byBoard(sub.by) ?? shortKey(sub.by))}`}
                trailing={
                  <Button onClick={() => void actions.run(slot.slot, () => [approveTemplate(state, slot.slot, sub.event)])} disabled={actions.busy !== null} className="h-11 rounded-xl px-4 text-[0.9375rem] font-semibold">
                    {r.approve}
                  </Button>
                }
              />
            )
          })}
        </Group>
      )}
      <Group title={tx.tournament.tabs.matches}>
        {matches.length === 0 && <ListRow title={r.none} />}
        {matches.map((m) => (
          <MatchRow key={m.id} read={read} m={m} names={names} me={null} onClick={() => setChosen(m)} />
        ))}
      </Group>
      <ResultSheet entry={entry} names={names} match={chosen ? (view.match(chosen.id) ?? chosen) : null} onOpenChange={(open) => !open && setChosen(null)} />
    </>
  )
}

// Details, the hand-over, export, cancelling, and the technical details behind "Erweitert".
function SettingsTab({ entry, names }: { entry: Entry; names: Names }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const s = tx.organize.settings
  const nav = useNav()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const actions = useActions(read.id)
  const [editing, setEditing] = useState(false)
  const [handingOver, setHandingOver] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const offerTo = useNames(state.offer ? [state.offer.to] : [])(state.offer?.to ?? "")
  const over = state.phase === "finished" || state.phase === "cancelled"
  return (
    <>
      {actions.problem && (
        <InlineStatus tone="error" className="mt-4">
          {actions.problem}
        </InlineStatus>
      )}
      <Group>
        {!over && <ListRow title={s.details} onClick={() => setEditing(true)} />}
        {state.phase === "running" && <ListRow title={tx.organize.participants.pause} onClick={() => void actions.run("pause", () => [phaseTemplate(state, "paused")])} />}
        <ListRow icon={Printer} iconTone="gray" title={s.export} onClick={() => nav.push(TOURNAMENT_SCREENS.print, { tournament: read.id })} />
      </Group>
      {!over && (
        <Group footer={state.offer ? s.offerOpen(offerTo.name ?? names.nameOf(state.offer.to), formatDateTime(state.offer.expires, t)) : s.handoverText}>
          {state.offer ? (
            <ListRow title={s.cancelOffer} onClick={() => void actions.run("cancelOffer", () => [cancelOfferTemplate(state, (state.offer as NonNullable<typeof state.offer>).event)])} />
          ) : (
            <ListRow title={s.handover} onClick={() => setHandingOver(true)} />
          )}
        </Group>
      )}
      {!over && (
        <Group>
          <ListRow title={tx.organize.participants.cancel} destructive onClick={() => setCancelling(true)} />
        </Group>
      )}
      <Group footer={s.advancedText}>
        <ListRow title={s.advanced} onClick={() => setAdvanced((a) => !a)} chevron={false} trailing={<ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform", advanced && "rotate-180")} aria-hidden="true" />} />
        {advanced && (
          <div className="px-4 py-3 text-[0.8125rem] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            <p>{read.id}</p>
            <p>
              {s.relays}: {tournamentRelays(read.relays).map(relayHost).join(", ")}
            </p>
            <p>{tx.unsent(read.unsent.length)}</p>
            {read.skipped.length > 0 && (
              <p>
                {s.skipped}: {read.skipped.map((x) => `${x.slot} (${x.why})`).join("; ")}
              </p>
            )}
          </div>
        )}
      </Group>
      <SyncLine read={read} />
      <DetailsSheet entry={entry} open={editing} onOpenChange={setEditing} />
      <HandoverSheet entry={entry} names={names} open={handingOver} onOpenChange={setHandingOver} />
      <AlertDialog open={cancelling} onOpenChange={setCancelling}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{tx.organize.participants.cancelTitle}</AlertDialogTitle>
            <AlertDialogDescription>{tx.organize.participants.cancelText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-danger text-white hover:bg-danger/90" onClick={() => void actions.run("cancel", () => [phaseTemplate(state, "cancelled")])}>
              {tx.organize.participants.cancel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
