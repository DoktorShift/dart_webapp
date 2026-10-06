"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { useChange } from "@/components/clubs/common"
import { GameSummary } from "@/components/clubs/game-summary"
import { clubAuthor } from "@/components/clubs/use-clubs"
import type { ClubView } from "@/lib/clubs/club"
import { answerGame, type ClubGame } from "@/lib/clubs/games"
import type { ClubState } from "@/lib/protocol/club-state"

// A player says whether a recorded result is right, from their own device: "Stimmt" counts it
// for the season (as the rules ask), "Stimmt nicht" hands it to the leaders.
export function VerdictSheet({ view, state, game, open, onOpenChange }: { view: ClubView; state: ClubState; game: ClubGame | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const [disputing, setDisputing] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<"confirm" | "dispute" | null>(null)

  const answer = async (verdict: "confirm" | "dispute") => {
    if (!game) return
    setBusy(true)
    setProblem(null)
    try {
      await answerGame(state, game, verdict, await clubAuthor(), verdict === "dispute" && reason.trim() ? reason.trim() : undefined)
      setDone(verdict)
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }
  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setDisputing(false)
      setReason("")
      setDone(null)
      setProblem(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={close} title={tx.game.verdict}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        {game && <GameSummary game={game} me={view.me.pubkey} />}
        {done ? (
          <InlineStatus tone={done === "confirm" ? "success" : "info"} className="mt-4">
            {done === "confirm" ? tx.game.confirmed : tx.game.disputed}
          </InlineStatus>
        ) : (
          <>
            {disputing && <TextField label={tx.game.disputeReason} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={280} className="mt-4" />}
            {problem && (
              <InlineStatus tone="error" className="mt-4">
                {problem}
              </InlineStatus>
            )}
            {disputing ? (
              <Button onClick={() => void answer("dispute")} disabled={busy} className="mt-4 h-12 w-full rounded-xl bg-danger text-[1.0625rem] font-semibold text-white hover:bg-danger/90">
                {tx.game.dispute}
              </Button>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button onClick={() => void answer("confirm")} disabled={busy} className="h-12 rounded-xl text-[1.0625rem] font-semibold">
                  {tx.game.confirm}
                </Button>
                <Button variant="secondary" onClick={() => setDisputing(true)} disabled={busy} className="h-12 rounded-xl text-[1.0625rem] font-semibold">
                  {tx.game.dispute}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <Button variant="ghost" onClick={() => close(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
        {done ? t.common.done : t.common.cancel}
      </Button>
    </Sheet>
  )
}
