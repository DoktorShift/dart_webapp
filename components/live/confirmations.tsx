"use client"

import { useSyncExternalStore } from "react"
import { ChevronRight, CircleAlert, CircleCheck } from "lucide-react"
import { FitText } from "@/components/fit-text"
import { openLiveSheet } from "@/components/live/gate"
import { useAreaT } from "@/components/i18n-provider"
import { LIVE_TEXTS } from "@/lib/i18n/features/live.screens"
import { boardView, subscribeBoards } from "@/lib/live/board"
import type { FinishedMatch } from "@/lib/shell/registry"
import { cn } from "@/lib/utils"

// On the result of a live game: how many of the connected players confirmed it and how many
// dispute it, in one line ("result.actions" asks for one row; in the result's top bar on a phone
// in landscape). It opens "Spieler verbinden", where every seat's answer stands by its name.
export default function Confirmations({ match }: { match: FinishedMatch }) {
  const tx = useAreaT(LIVE_TEXTS)
  const view = useSyncExternalStore(
    subscribeBoards,
    () => boardView(match.id),
    () => null,
  )
  const seats = view?.seats.filter((seat) => seat.holder) ?? []
  if (seats.length === 0) return null
  const confirmed = seats.filter((seat) => seat.verdict === "confirm").length
  const disputes = seats.filter((seat) => seat.verdict === "dispute").length
  const Icon = disputes > 0 ? CircleAlert : CircleCheck
  const text = [tx.confirmations(confirmed, seats.length), ...(disputes > 0 ? [tx.disputes(disputes)] : [])].join(" · ")
  return (
    <button
      type="button"
      onClick={() => openLiveSheet(match.id, "players")}
      className="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-card/70 px-3 text-left text-[0.9375rem] active:bg-secondary/70 xshort:w-auto xshort:max-w-full xshort:border-0 xshort:bg-transparent xshort:px-2"
    >
      <Icon className={cn("h-5 w-5 shrink-0", disputes > 0 ? "text-danger" : "text-success")} aria-hidden="true" />
      <FitText minScale={0.8} className="min-w-0 flex-1 leading-snug">
        {text}
      </FitText>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/70 xshort:hidden" aria-hidden="true" />
    </button>
  )
}
