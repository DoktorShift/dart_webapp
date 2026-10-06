import type { Messages } from "@/lib/i18n"

// Amounts as people read them: "1.000 sats" in German, "1,000 sats" in English. Fees can be a
// fraction of a sat (the wallet counts millisats), so up to three decimals show.
export const formatNumber = (t: Messages, sats: number) => sats.toLocaleString(t.intl, { maximumFractionDigits: 3 })

export const formatSats = (t: Messages, sats: number) => t.payments.sats(formatNumber(t, sats))

export const formatMsat = (t: Messages, msat: number) => formatSats(t, msat / 1000)

// "≈ 0,32 € · Kurs von 21:14 Uhr" for an amount in sats at a fetched rate (euro per bitcoin).
export function formatEuro(t: Messages, sats: number, rate: { rate: number; at: number }) {
  const euros = (sats / 100_000_000) * rate.rate
  const amount = euros.toLocaleString(t.intl, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const time = new Date(rate.at).toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit" })
  return t.payments.euro(amount, time)
}
