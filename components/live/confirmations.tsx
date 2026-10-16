"use client"

import { useSyncExternalStore } from "react"
import { ChevronRight, CircleAlert, CircleCheck, CircleDashed } from "lucide-react"
import { FitText } from "@/components/fit-text"
import { openLiveSheet } from "@/components/live/gate"
import { useAreaT } from "@/components/i18n-provider"
import { LIVE_TEXTS } from "@/lib/i18n/features/live.screens"
import { boardView, subscribeBoards } from "@/lib/live/board"
import type { SlotListProps } from "@/lib/shell/registry"
import { cn } from "@/lib/utils"

// On the result of a live game: how many of the connected players confirmed it and how many
// dispute it, in one line ("result.actions" asks for one row, or a bar button on a phone in
// landscape). It opens "Spieler verbinden", where every seat's answer stands by its name.
export default function Confirmations({ match, placement }: SlotListProps["result.actions"]) {
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
  const bar = placement === "bar"
  // The symbol says it with the words: still open while answers are missing, done once everyone
  // confirmed, a problem as soon as someone disputes.
  const [Icon, tone] = disputes > 0 ? [CircleAlert, "text-danger"] : confirmed === seats.length ? [CircleCheck, "text-success"] : [CircleDashed, "text-muted-foreground"]
  const count = bar ? tx.confirmationsShort(confirmed, seats.length) : tx.confirmations(confirmed, seats.length)
  const text = [count, ...(disputes > 0 ? [tx.disputes(disputes)] : [])].join(" · ")
  return (
    <button
      type="button"
      onClick={() => openLiveSheet(match.id, "players")}
      className={cn(
        "flex h-11 min-w-0 items-center gap-2 rounded-xl text-left text-[0.9375rem] active:bg-secondary/70",
        bar ? "max-w-full px-2 text-primary" : "w-full border border-border bg-card/70 px-3",
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0", tone)} aria-hidden="true" />
      <FitText minScale={0.6} className="min-w-0 flex-1 leading-snug">
        {text}
      </FitText>
      {!bar && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />}
    </button>
  )
}
