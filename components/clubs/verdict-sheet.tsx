"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { SheetButton, gameLabel, personName, useChange } from "@/components/clubs/common"
import { GameSummary } from "@/components/clubs/game-summary"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { useProfileNames } from "@/components/profile/use-profile-names"
import type { ClubView } from "@/lib/clubs/club"
import { answerGame, awaitsVerdict, correctGame, type ClubGame, type Outcome } from "@/lib/clubs/games"
import type { ClubState } from "@/lib/protocol/club-state"

// A club game's result. A player who still has to say whether it is right does so here, from
// their own device: "Stimmt" counts it for the season (as the rules ask), "Stimmt nicht" hands
// it to the leaders, with a word on what is wrong if they like. The one who recorded it can
// correct a wrong entry (winner, legs, a reason everyone sees). Everyone else just sees the
// result.
export function VerdictSheet({ view, state, game, open, onOpenChange }: { view: ClubView; state: ClubState; game: ClubGame | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const me = view.me.pubkey
  const [disputing, setDisputing] = useState(false)
  const [reason, setReason] = useState("")
  const [correcting, setCorrecting] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<"confirm" | "dispute" | "corrected" | null>(null)
  const asked = !!game && !!me && awaitsVerdict(game, me)
  const recorder = !!game?.result?.throws && game.result.by === me && view.me.status === "member" && !state.info.archived

  const act = async (action: () => Promise<unknown>, then: typeof done) => {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      setDone(then)
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }
  const answer = (verdict: "confirm" | "dispute") =>
    game && act(async () => answerGame(state, game, verdict, await clubAuthor(), verdict === "dispute" && reason.trim() ? reason.trim() : undefined), verdict)
  const correct = (outcome: Outcome, why: string) => game && act(async () => correctGame(state, game, outcome, why, await clubAuthor()), "corrected")
  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setDisputing(false)
      setReason("")
      setCorrecting(null)
      setDone(null)
      setProblem(null)
    }
  }

  const title = done || !game ? (game ? gameLabel(game) : "") : correcting ? tx.game.correctTitle : asked ? tx.game.verdict : gameLabel(game)
  return (
    <Sheet open={open} onOpenChange={close} title={title}>
      <SheetBody>
        {game && <GameSummary game={game} me={me} />}
        {done ? (
          <InlineStatus tone={done === "dispute" ? "info" : "success"} className="mt-4">
            {done === "confirm" ? tx.game.confirmed : done === "dispute" ? tx.game.disputed : tx.game.correctedDone}
          </InlineStatus>
        ) : correcting && game ? (
          <Correction game={game} me={me} outcome={correcting} onChange={setCorrecting} busy={busy} problem={problem} onSend={correct} />
        ) : (
          <>
            {asked && disputing && <TextField label={tx.game.disputeReason} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={280} className="mt-4" />}
            {problem && (
              <InlineStatus tone="error" className="mt-4">
                {problem}
              </InlineStatus>
            )}
            {asked && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button onClick={() => void answer("confirm")} disabled={busy} className="h-12 rounded-xl text-[1.0625rem] font-semibold">
                  {tx.game.confirm}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => (disputing ? void answer("dispute") : setDisputing(true))}
                  disabled={busy}
                  className={disputing ? "h-12 rounded-xl bg-danger text-[1.0625rem] font-semibold text-white hover:bg-danger/90" : "h-12 rounded-xl text-[1.0625rem] font-semibold"}
                >
                  {tx.game.dispute}
                </Button>
              </div>
            )}
            {recorder && game.result && (
              <Button variant="secondary" onClick={() => setCorrecting({ winner: game.result!.winner, legs: [...game.result!.legs] })} disabled={busy} className="mt-4 h-12 w-full rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15">
                {tx.game.correct}
              </Button>
            )}
          </>
        )}
      </SheetBody>
      <SheetButton onClick={() => (correcting && !done ? setCorrecting(null) : close(false))}>{(asked || correcting) && !done ? t.common.cancel : t.common.done}</SheetButton>
    </Sheet>
  )
}

// What really happened: the winner and the legs per seat, and why the entry was wrong. Sent
// only when something differs from the recorded result.
function Correction({ game, me, outcome, onChange, busy, problem, onSend }: { game: ClubGame; me: string | null; outcome: Outcome; onChange: (outcome: Outcome) => void; busy: boolean; problem: string | null; onSend: (outcome: Outcome, why: string) => unknown }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const seats = game.agreement.seats
  const names = useProfileNames(seats.map((s) => s.pubkey).filter((p): p is string => !!p))
  const [why, setWhy] = useState("")
  const nameOf = (i: number) => (seats[i].pubkey ? personName(seats[i].pubkey, names(seats[i].pubkey), tx, { me, alias: seats[i].alias }) : seats[i].alias)
  const result = game.result!
  const changed = outcome.winner !== result.winner || outcome.legs.some((n, i) => n !== result.legs[i])
  const ready = changed && why.trim() !== "" && outcome.legs.every((n) => Number.isInteger(n) && n >= 0)
  const legs = (i: number, value: string) => {
    const n = Number.parseInt(value, 10)
    onChange({ ...outcome, legs: outcome.legs.map((v, j) => (j === i ? (Number.isInteger(n) && n >= 0 && n <= 99 ? n : 0) : v)) })
  }
  return (
    <>
      <p className="mt-4 text-[0.9375rem] leading-snug text-muted-foreground">{tx.game.correctText}</p>
      <section className="mt-4">
        <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{tx.game.winner}</p>
        <ChoiceList label={tx.game.winner} options={seats.map((_, i) => ({ value: String(i), title: nameOf(i) }))} value={outcome.winner === null ? null : String(outcome.winner)} onChange={(value) => onChange({ ...outcome, winner: Number(value) })} />
      </section>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {seats.map((_, i) => (
          <TextField key={i} label={tx.game.legsOf(nameOf(i))} type="number" inputMode="numeric" min={0} max={99} value={outcome.legs[i]} onChange={(event) => legs(i, event.target.value)} className="mt-0" />
        ))}
      </div>
      <TextField label={tx.game.correctReason} value={why} onChange={(event) => setWhy(event.target.value)} maxLength={280} />
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <Button onClick={() => void onSend(outcome, why.trim())} disabled={!ready || busy} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        {busy ? tx.game.correcting : tx.game.sendCorrection}
      </Button>
    </>
  )
}
