"use client"

import { lazy, Suspense, useState } from "react"
import { UserRoundPlus } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { ResultRow } from "@/components/shell/result-row"
import { useDismissedFor } from "@/components/shell/use-dismissed-for"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import type { Seat } from "@/components/profile/keep-sheet"
import { useSession } from "@/lib/profile/session"
import type { SlotListProps } from "@/lib/shell/registry"
import { isUnnamed } from "@/lib/storage/players"

// "Deine Ergebnisse mitnehmen" on the result of a finished game (registry "result.actions"): one
// quiet row, only for guests, only when a seat has a name, and gone for this game after
// "Später". The profile is created in a sheet that loads when the row is tapped (./keep-sheet.tsx:
// the guest's result screen carries only the row); afterwards one line says where to find it,
// no dialog (PLAN.md "Nutzerwege und unaufdringliche Profilerstellung").

// Games whose offer was put off; device-wide, not part of any profile.
const DISMISSED_KEY = "results-offer.dismissed"

const KeepSheet = lazy(() => import("@/components/profile/keep-sheet"))

export default function KeepResults({ match, placement }: SlotListProps["result.actions"]) {
  const tx = useAreaT(PROFILE_TEXTS)
  const k = tx.keep
  const session = useSession()
  const { dismissed, dismiss } = useDismissedFor(DISMISSED_KEY, match.id)
  // Opened once, the sheet stays mounted (closed) with what was typed into it.
  const [sheet, setSheet] = useState({ open: false, opened: false })
  const [created, setCreated] = useState(false)
  const seats: Seat[] = match.players.flatMap((p, seat) => (isUnnamed(p.name) ? [] : [{ seat, name: p.name.trim() }]))

  // In the result's top bar the line has 44 pt: smaller words on two lines.
  if (created) {
    return (
      <InlineStatus tone="success" className={placement === "bar" ? "min-w-0 py-1 text-[0.8125rem]" : undefined}>
        {k.done}
      </InlineStatus>
    )
  }
  // The sheet stays while it is open: the session appears the moment the profile starts, before
  // the games are taken over, and the row turns into the done line only after that.
  if (!sheet.open && (session !== null || dismissed !== false || seats.length === 0)) return null

  const close = () => setSheet((s) => ({ ...s, open: false }))

  return (
    <>
      <ResultRow
        icon={UserRoundPlus}
        label={k.offer}
        tone="accent"
        placement={placement}
        onClick={() => setSheet({ open: true, opened: true })}
        trailing={{ kind: "text", label: k.later, ariaLabel: k.laterLabel, onClick: () => void dismiss() }}
      />
      {sheet.opened && (
        <Suspense fallback={null}>
          <KeepSheet
            open={sheet.open}
            onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
            matchId={match.id}
            seats={seats}
            onLater={() => {
              close()
              void dismiss()
            }}
            onCreated={() => {
              close()
              setCreated(true)
            }}
          />
        </Suspense>
      )}
    </>
  )
}
