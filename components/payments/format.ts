"use client"

import { useMemo } from "react"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"

// Amounts and times as people read them: "1.000 sats" in German, "1,000 sats" in English. Fees
// can be a fraction of a sat (the wallet counts millisats), so up to three decimals show.
export interface Format {
  number(sats: number): string
  sats(sats: number): string
  msat(msat: number): string
  // "≈ 0,32 € · Kurs von 21:14 Uhr" for an amount in sats at a fetched rate (euro per bitcoin).
  euro(sats: number, rate: { rate: number; at: number }): string
  // A moment (ms): "21:14" today, with its date on another day.
  time(ms: number): string
}

export function useFormat(): Format {
  const { intl } = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  return useMemo(() => {
    const number = (sats: number) => sats.toLocaleString(intl, { maximumFractionDigits: 3 })
    const sats = (value: number) => tx.sats(number(value))
    const clock = (ms: number) => new Date(ms).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" })
    return {
      number,
      sats,
      msat: (msat) => sats(msat / 1000),
      euro: (value, { rate, at }) => {
        const euros = (value / 100_000_000) * rate
        return tx.euro(euros.toLocaleString(intl, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }), clock(at))
      },
      time: (ms) => (new Date(ms).toDateString() === new Date().toDateString() ? clock(ms) : new Date(ms).toLocaleString(intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })),
    }
  }, [intl, tx])
}
