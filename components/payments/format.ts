"use client"

import { useMemo } from "react"
import { useT } from "@/components/i18n-provider"

// Amounts and times as people read them: "1.000 sats" in German, "1,000 sats" in English. Fees
// can be a fraction of a sat (the wallet counts millisats), so up to three decimals show. Only
// the start catalog's texts are used, so the stake row in setup can format without loading the
// area's texts.
export interface Format {
  number(sats: number): string
  sats(sats: number): string
  msat(msat: number): string
  // An amount in sats in euro at a rate (euro per bitcoin): "0,32 €".
  euros(sats: number, eurPerBitcoin: number): string
  // A moment (ms): "21:14" today, with its date on another day.
  time(ms: number): string
}

export function useFormat(): Format {
  const t = useT()
  return useMemo(() => {
    const { intl } = t
    const number = (sats: number) => sats.toLocaleString(intl, { maximumFractionDigits: 3 })
    const sats = (value: number) => t.payments.sats(number(value))
    const clock = (ms: number) => new Date(ms).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" })
    return {
      number,
      sats,
      msat: (msat) => sats(msat / 1000),
      euros: (value, eurPerBitcoin) => ((value / 100_000_000) * eurPerBitcoin).toLocaleString(intl, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      time: (ms) => (new Date(ms).toDateString() === new Date().toDateString() ? clock(ms) : new Date(ms).toLocaleString(intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })),
    }
  }, [t])
}
