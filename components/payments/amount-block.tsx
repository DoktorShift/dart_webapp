"use client"

import { useEffect } from "react"
import { useMoney } from "@/components/payments/use-money"
import { isRateOld, type FiatAmount } from "@/lib/payments/money"
import { cn } from "@/lib/utils"

// An amount as the headline of a payment sheet: the currency amount large, the bitcoin amount
// under it, and the rate's time when the currency amount rests on the current rate (an agreed
// amount has none: it is what was agreed). Says one thing twice at most, never three times.
export function AmountBlock({ msat, fiat, align = "center", className, onlyOldRate = false }: { msat: number; fiat?: FiatAmount; align?: "center" | "start"; className?: string; onlyOldRate?: boolean }) {
  const money = useMoney()
  const secondary = money.secondary(msat, fiat)
  const rateLine = onlyOldRate && money.rate && !isRateOld(money.rate) ? null : money.rateLine(fiat)
  return (
    <div className={cn("flex flex-col", align === "center" ? "items-center text-center" : "items-start text-left", className)}>
      <p className="font-display text-4xl font-semibold tabular-nums tracking-tight">{money.primary(msat, fiat)}</p>
      {secondary && <p className="mt-1 text-[1.0625rem] tabular-nums text-muted-foreground">{secondary}</p>}
      {(secondary || money.rate === null) && rateLine && <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{rateLine}</p>}
    </div>
  )
}

// The pause after a confirmed outcome, long enough to read "Bezahlt" or "Erhalten".
const CLOSE_AFTER_MS = 1800

// Closes a sheet by itself once an outcome arrived while it was open (Apple Pay: the check, then
// the sheet goes). `onDone` runs once `active` turns true; a tap on "Fertig" may come first.
export function useAutoClose(active: boolean, onDone: () => void) {
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(onDone, CLOSE_AFTER_MS)
    return () => clearTimeout(timer)
    // Timed from the moment the outcome arrived; a new `onDone` closure doesn't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
