"use client"

import { Trophy } from "lucide-react"
import { ResultRow } from "@/components/shell/result-row"
import { useAreaT } from "@/components/i18n-provider"
import { useReport } from "@/components/tournaments/use-report"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import type { TournamentExtra } from "@/lib/tournaments/extra"

// The one line a tournament game adds to its result: how far its way to the tournament got
// (./gate.tsx shows it only for such a game).
export default function ReportRow({ extra, placement }: { extra: TournamentExtra; placement: "row" | "bar" }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const report = useReport(extra.id, extra.slot)
  return <ResultRow icon={Trophy} label={tx.game[report]} tone={report === "reported" ? "success" : report === "reporting" ? "neutral" : "warning"} placement={placement} />
}
