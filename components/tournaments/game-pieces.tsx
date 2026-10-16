"use client"

import { lazy, useEffect, useRef, useState } from "react"
import { Trophy } from "lucide-react"
import { FitText } from "@/components/fit-text"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import type { SavedMatch } from "@/lib/game/types"
import type { FinishedMatch } from "@/lib/shell/registry"
import { onStorageChange } from "@/lib/storage/db"
import { tournamentExtra, type TournamentExtra } from "@/lib/tournaments/board-device"
import { loadBoardDevice, type BoardDeviceRecord } from "@/lib/tournaments/store"
import { cn } from "@/lib/utils"

// What a tournament game adds to the game screen: nothing visible while it is played, the
// result's way to the tournament once it is won (game.attachments), and one line on the result
// screen that says so (result.actions). Any other game: nothing, not even the tournament code.
// The game's config names the tournament, the slot and the board (lib/tournaments/board-device.ts).

const Reporter = lazy(() => import("@/components/tournaments/reporter"))

export function TournamentGate({ match }: { match: SavedMatch; close: () => void }) {
  const extra = tournamentExtra(match.config)
  return extra ? <Reporter extra={extra} match={match} /> : null
}

// The board's record, kept current with what the reporter writes.
function useBoardRecord(extra: TournamentExtra | null): BoardDeviceRecord | null {
  const [record, setRecord] = useState<BoardDeviceRecord | null>(null)
  const id = extra?.id ?? null
  useEffect(() => {
    if (!id) return
    let current = true
    const load = () => void loadBoardDevice(id).then((found) => current && setRecord(found), () => {})
    load()
    const stop = onStorageChange((message) => {
      if (message.type === "change" && message.stores.includes("pending")) load()
    })
    return () => {
      current = false
      stop()
    }
  }, [id])
  return record
}

export function TournamentResultRow({ match, placement }: { match: FinishedMatch; placement: "row" | "bar" }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const extra = useRef(tournamentExtra(match.config)).current
  const record = useBoardRecord(extra)
  if (!extra) return null
  const game = record?.games[extra.slot]
  const waiting = game?.reported && record?.outbox.some((e) => e.id === game.reported?.event)
  const text = !game?.reported ? tx.game.reporting : waiting ? tx.game.pending : tx.game.reported
  if (placement === "bar") return <FitText className="px-2 text-[0.9375rem] font-medium text-primary">{text}</FitText>
  return (
    <p role="status" className={cn("flex h-11 items-center gap-2 rounded-xl border border-border bg-card/70 px-4 text-[1.0625rem] font-medium")}>
      <Trophy className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <FitText minScale={0.75} className="flex-1 leading-snug">
        {text}
      </FitText>
    </p>
  )
}
