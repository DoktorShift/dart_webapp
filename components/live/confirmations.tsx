"use client"

import { useSyncExternalStore } from "react"
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react"
import { openLiveSheet } from "@/components/live/gate"
import { useAreaT } from "@/components/i18n-provider"
import { ResultRow } from "@/components/shell/result-row"
import { LIVE_TEXTS } from "@/lib/i18n/features/live.screens"
import { boardView, subscribeBoards } from "@/lib/live/board"
import type { SlotListProps } from "@/lib/shell/registry"

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
  // The symbol and the row's tone say it with the words: still open while answers are missing,
  // done once everyone confirmed, worth a look as soon as someone disputes.
  const [icon, tone] = disputes > 0 ? ([CircleAlert, "warning"] as const) : confirmed === seats.length ? ([CircleCheck, "success"] as const) : ([CircleDashed, "neutral"] as const)
  const count = placement === "bar" ? tx.confirmationsShort(confirmed, seats.length) : tx.confirmations(confirmed, seats.length)
  const text = [count, ...(disputes > 0 ? [tx.disputes(disputes)] : [])].join(" · ")
  return <ResultRow icon={icon} label={text} tone={tone} placement={placement} onClick={() => openLiveSheet(match.id, "players")} trailing={{ kind: "chevron" }} />
}
