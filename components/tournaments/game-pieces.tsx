"use client"

import { lazy, useEffect, useState } from "react"
import { Trophy } from "lucide-react"
import { ResultRow } from "@/components/shell/result-row"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import type { SavedMatch } from "@/lib/game/types"
import type { FinishedMatch } from "@/lib/shell/registry"
import { onStorageChange } from "@/lib/storage/db"
import { deliveryStatus } from "@/lib/sync/outbox"
import { tournamentGame } from "@/lib/tournaments/extra"
import { loadBoardDevice } from "@/lib/tournaments/store"

// What a tournament game adds to the game screen: nothing visible while it is played, the
// result's way to the tournament once it is won (game.attachments), and one line on the result
// screen that says how far it got (result.actions). Any other game, a rematch of a tournament
// game included: nothing, not even the tournament code (lib/tournaments/extra.ts).

const Reporter = lazy(() => import("@/components/tournaments/reporter"))

export function TournamentGate({ match }: { match: SavedMatch; close: () => void }) {
  const extra = tournamentGame(match)
  return extra ? <Reporter extra={extra} match={match} /> : null
}

type Report = "reporting" | "waiting" | "reported"

// How far the game's result got: not signed yet, waiting in the outbox, or with the relays.
function useReport(match: FinishedMatch): Report | null {
  const extra = tournamentGame(match)
  const [report, setReport] = useState<Report>("reporting")
  const id = extra?.id
  const slot = extra?.slot
  useEffect(() => {
    if (!id || !slot) return
    let current = true
    const load = async () => {
      const reported = (await loadBoardDevice(id))?.games[slot]?.reported
      const next: Report = !reported ? "reporting" : (await deliveryStatus(reported.event))?.state === "waiting" ? "waiting" : "reported"
      if (current) setReport(next)
    }
    void load().catch(() => {})
    const stop = onStorageChange((message) => {
      if (message.type === "change" && (message.stores.includes("pending") || message.stores.includes("outbox"))) void load().catch(() => {})
    })
    return () => {
      current = false
      stop()
    }
  }, [id, slot])
  return extra ? report : null
}

export function TournamentResultRow({ match, placement }: { match: FinishedMatch; placement: "row" | "bar" }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const report = useReport(match)
  if (!report) return null
  return <ResultRow icon={Trophy} label={tx.game[report]} tone={report === "reported" ? "success" : report === "waiting" ? "warning" : "neutral"} placement={placement} />
}
