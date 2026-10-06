"use client"

import { useSyncExternalStore } from "react"
import { ChevronRight, CircleAlert, CircleCheck } from "lucide-react"
import { openLiveSheet } from "@/components/live/gate"
import { useT } from "@/components/i18n-provider"
import { boardView, subscribeBoards } from "@/lib/live/board"
import type { FinishedMatch } from "@/lib/shell/registry"

// On the result of a live game: how many of the connected players confirmed it, and who
// disputes it, in one row. It opens "Spieler verbinden" with every seat's answer.
export default function Confirmations({ match }: { match: FinishedMatch }) {
  const t = useT()
  const view = useSyncExternalStore(
    subscribeBoards,
    () => boardView(match.id),
    () => null,
  )
  const seats = view?.seats.map((seat, i) => ({ ...seat, name: match.players[i]?.name ?? "" })).filter((seat) => seat.holder) ?? []
  if (seats.length === 0) return null
  const confirmed = seats.filter((seat) => seat.verdict === "confirm").length
  const disputes = seats.filter((seat) => seat.verdict === "dispute").map((seat) => seat.name)
  const Icon = disputes.length > 0 ? CircleAlert : CircleCheck
  return (
    <button
      type="button"
      onClick={() => openLiveSheet(match.id, "players")}
      className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 text-left text-[0.9375rem] active:bg-secondary/70"
    >
      <Icon className={disputes.length > 0 ? "h-5 w-5 shrink-0 text-danger" : "h-5 w-5 shrink-0 text-success"} aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">
        {t.live.confirmations(confirmed, seats.length)}
        {disputes.length > 0 && <span className="block text-danger">{t.live.disputedBy(disputes.join(", "))}</span>}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </button>
  )
}
