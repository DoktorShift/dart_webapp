"use client"

import { lazy } from "react"
import { Trophy } from "lucide-react"
import { ResultRow } from "@/components/shell/result-row"
import { useAreaT } from "@/components/i18n-provider"
import { useReport } from "@/components/tournaments/use-report"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import type { SavedMatch } from "@/lib/game/types"
import type { FinishedMatch } from "@/lib/shell/registry"
import { tournamentGame } from "@/lib/tournaments/extra"

// What a tournament game adds to the game screen: nothing visible while it is played, the
// result's way to the tournament once it is won (game.attachments), and one line on the result
// screen that says how far it got (result.actions). Any other game, a rematch of a tournament
// game included: nothing, not even the tournament code (lib/tournaments/extra.ts).

const Reporter = lazy(() => import("@/components/tournaments/reporter"))

export function TournamentGate({ match }: { match: SavedMatch; close: () => void }) {
  const extra = tournamentGame(match)
  return extra ? <Reporter extra={extra} match={match} /> : null
}

export function TournamentResultRow({ match, placement }: { match: FinishedMatch; placement: "row" | "bar" }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const extra = tournamentGame(match)
  const report = useReport(extra?.id ?? null, extra?.slot ?? null)
  if (!extra) return null
  return <ResultRow icon={Trophy} label={tx.game[report]} tone={report === "reported" ? "success" : report === "waiting" ? "warning" : "neutral"} placement={placement} />
}
