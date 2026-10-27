"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Confirm } from "@/components/ui/confirm"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { useGiveAwards, useMissingAwards } from "@/components/tournaments/awards"
import { boardName, PRIMARY, useActions, type Names } from "@/components/tournaments/common"
import { DrawSheet } from "@/components/tournaments/organize-sheets"
import type { Entry } from "@/components/tournaments/use-tournaments"
import { featureOn } from "@/lib/shell/features"
import { suggestBoards, type MatchView } from "@/lib/tournaments/engine"
import { badgeOccasion } from "@/lib/tournaments/occasion"
import { assignTemplate, phaseTemplate } from "@/lib/tournaments/records"

export interface NextStep {
  // Matches ready for a free board, with the board each would go to.
  calls: { match: string; board: string }[]
  // Why the last step did not go through, in the person's words.
  problem: string | null
  // The one prominent button, or null when the phase asks nothing of the organizer now.
  button: ReactNode
  // The sheet and the confirmation the button opens.
  sheets: ReactNode
}

// The one thing the tournament's phase asks of its organizer next: open the check-in, draw,
// start, call the matches to the free boards (one call names its pairing and board), resume,
// finish, give the badges still missing. On top of the workspace ("Jetzt dran"), and on the
// tournament's page for an organizer without a place in the field (NextStepButton).
export function useNextStep(entry: Entry, names: Names): NextStep {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const o = tx.organize
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const view = read.view
  const actions = useActions(read.id)
  const giveAwards = useGiveAwards()
  const [awardsRound, setAwardsRound] = useState(0)
  const missingAwards = useMissingAwards(entry, awardsRound)
  const [drawing, setDrawing] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const activeBoards = Object.values(state.boards).filter((b) => b.active)
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

  return {
    calls,
    problem: actions.problem,
    button: primary && (
      <Button onClick={primary.run} disabled={actions.busy !== null} className={`${PRIMARY} h-auto min-h-14 whitespace-normal py-2 leading-snug wrap-anywhere`}>
        {primary.label}
      </Button>
    ),
    sheets: (
      <>
        <DrawSheet entry={entry} names={names} open={drawing} onOpenChange={setDrawing} />
        <Confirm
          open={finishing}
          onOpenChange={setFinishing}
          title={o.participants.finishTitle}
          text={!view?.complete ? o.participants.finishIncomplete : badges ? o.participants.finishText(finishedOccasion?.places.length ?? 0) : o.participants.finishPlain}
          confirm={o.participants.finish}
          onConfirm={() => void finish()}
        />
      </>
    ),
  }
}

// The organizer's next step as the tournament page's one primary (loaded only for the organizer).
export default function NextStepButton({ entry, names }: { entry: Entry; names: Names }) {
  const next = useNextStep(entry, names)
  return (
    <>
      {next.problem && <InlineStatus tone="error">{next.problem}</InlineStatus>}
      {next.button}
      {next.sheets}
    </>
  )
}
