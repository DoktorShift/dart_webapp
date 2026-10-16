"use client"

import { lazy, Suspense, useEffect, useState } from "react"
import { UserRoundPlus } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { FitText } from "@/components/fit-text"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import type { Seat } from "@/components/profile/keep-sheet"
import { useSession } from "@/lib/profile/session"
import type { FinishedMatch } from "@/lib/shell/registry"
import { kvGet, kvSet } from "@/lib/storage/db"
import { isUnnamed } from "@/lib/storage/players"

// "Deine Ergebnisse mitnehmen" on the result of a finished game (registry "result.actions"): one
// quiet row, only for guests, only when a seat has a name, and gone for this game after
// "Später". The profile is created in a sheet that loads when the row is tapped (./keep-sheet.tsx:
// the guest's result screen carries only the row); afterwards one line says where to find it,
// no dialog (PLAN.md "Nutzerwege und unaufdringliche Profilerstellung").

// Games whose offer was put off, newest last; device-wide, not part of any profile.
const DISMISSED_KEY = "results-offer.dismissed"
const REMEMBERED = 50

const KeepSheet = lazy(() => import("@/components/profile/keep-sheet"))

export default function KeepResults({ match }: { match: FinishedMatch }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const k = tx.keep
  const session = useSession()
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  // Opened once, the sheet stays mounted (closed) with what was typed into it.
  const [sheet, setSheet] = useState({ open: false, opened: false })
  const [created, setCreated] = useState(false)
  const seats: Seat[] = match.players.flatMap((p, seat) => (isUnnamed(p.name) ? [] : [{ seat, name: p.name.trim() }]))

  useEffect(() => {
    let alive = true
    kvGet<string[]>(DISMISSED_KEY).then(
      (ids) => alive && setDismissed(!!ids?.includes(match.id)),
      () => alive && setDismissed(false),
    )
    return () => {
      alive = false
    }
  }, [match.id])

  if (created) return <InlineStatus tone="success">{k.done}</InlineStatus>
  // The sheet stays while it is open: the session appears the moment the profile starts, before
  // the games are taken over, and the row turns into the done line only after that.
  if (!sheet.open && (session !== null || dismissed !== false || seats.length === 0)) return null

  const later = async () => {
    setDismissed(true)
    const ids = (await kvGet<string[]>(DISMISSED_KEY).catch(() => undefined)) ?? []
    await kvSet(DISMISSED_KEY, [...ids.filter((id) => id !== match.id), match.id].slice(-REMEMBERED)).catch(() => {})
  }
  const close = () => setSheet((s) => ({ ...s, open: false }))

  return (
    <>
      {/* One row, as the result screen asks of its pieces: the label shrinks before it wraps. */}
      <div className="flex min-h-12 items-stretch overflow-hidden rounded-2xl bg-card ring-1 ring-inset ring-border xshort:min-h-11">
        <button
          type="button"
          onClick={() => setSheet({ open: true, opened: true })}
          className="flex min-w-0 flex-1 items-center gap-3 py-1 pl-4 pr-2 text-left text-[1.0625rem] font-medium text-primary transition-colors focus-visible:bg-secondary/50 focus-visible:outline-none active:bg-secondary/70 xshort:pl-3 xshort:text-[0.9375rem]"
        >
          <UserRoundPlus className="h-5 w-5 shrink-0 xshort:hidden" aria-hidden="true" />
          <FitText minScale={0.7} className="flex-1 leading-snug">
            {k.offer}
          </FitText>
        </button>
        <button
          type="button"
          onClick={() => void later()}
          aria-label={k.laterLabel}
          className="flex min-w-11 shrink-0 items-center justify-center border-l border-border px-3 text-[0.9375rem] text-muted-foreground transition-colors focus-visible:bg-secondary/50 focus-visible:outline-none active:bg-secondary/70"
        >
          {k.later}
        </button>
      </div>
      {sheet.opened && (
        <Suspense fallback={null}>
          <KeepSheet
            open={sheet.open}
            onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
            matchId={match.id}
            seats={seats}
            onLater={() => {
              close()
              void later()
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
