// Money as people read it (docs/ux/zahlungen-vorschlag.html, "Beträge"): the fiat amount first,
// the bitcoin amount second, the word "sats" nowhere. Bitcoin is counted in whole base units with
// the ₿ sign, placed where the language puts its currency sign ("7.950 ₿" in German, "₿7,950" in
// English). The wallet pays and makes invoices in those units (msat inside); the fiat amount is an
// approximation at a rate with a time, never what is paid.

export const CURRENCIES = ["EUR", "USD", "CHF", "GBP"] as const
export type Currency = (typeof CURRENCIES)[number]

export const UNITS_PER_BITCOIN = 100_000_000
export const MSAT_PER_UNIT = 1000

// Fiat per bitcoin, from when (ms), for which currency.
export interface Rate {
  rate: number
  at: number
  currency: Currency
}

// After this a rate is said with its date, not just its time.
export const RATE_OLD_MS = 60 * 60 * 1000

// A rate counts as fresh while it is this young; older ones are kept and shown as old.
export const RATE_FRESH_MS = 60 * 1000

export const isRateOld = (rate: Rate, now = Date.now()) => now - rate.at > RATE_OLD_MS

// An amount in a currency, as a person chose or confirmed it. Kept beside the bitcoin amount
// (the stake of a game, a payment in the journal), so both sides keep saying the same figure
// however the rate moves afterwards.
export interface FiatAmount {
  amount: number
  currency: Currency
}

// An amount to pay or ask for: whole bitcoin units, and the currency amount it was chosen as.
export interface Amount {
  sats: number
  fiat?: FiatAmount
}

// Offered wherever a currency amount is chosen; any other can be typed.
export const FIAT_PRESETS = [1, 2, 5, 10] as const

export function readFiatAmount(value: unknown): FiatAmount | undefined {
  const fiat = value as Partial<FiatAmount> | null | undefined
  return fiat && typeof fiat.amount === "number" && fiat.amount > 0 && Number.isFinite(fiat.amount) && isCurrency(fiat.currency) ? { amount: fiat.amount, currency: fiat.currency } : undefined
}

export const isCurrency = (value: unknown): value is Currency => typeof value === "string" && (CURRENCIES as readonly string[]).includes(value)

// The sign of a currency as the locale writes it ("€", "US$", "CHF").
export function currencySymbol(intl: string, currency: Currency): string {
  return new Intl.NumberFormat(intl, { style: "currency", currency }).formatToParts(1).find((part) => part.type === "currency")?.value ?? currency
}

// The currency of a region: euro for most of Europe, otherwise the few others the picker offers.
export function defaultCurrency(locale: string | undefined): Currency {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale ?? "")?.[1]?.toUpperCase()
  if (region === "CH" || region === "LI") return "CHF"
  if (region === "GB" || region === "IM" || region === "JE" || region === "GG") return "GBP"
  if (region === "US") return "USD"
  return "EUR"
}

// A fiat amount as whole bitcoin units, at least one.
export function unitsFromFiat(amount: number, rate: Rate): number {
  return Math.max(1, Math.round((amount / rate.rate) * UNITS_PER_BITCOIN))
}

export function fiatFromMsat(msat: number, rate: Rate): number {
  return (msat / MSAT_PER_UNIT / UNITS_PER_BITCOIN) * rate.rate
}

// Where the locale puts its currency sign, and what sits between sign and number.
function signPlacement(intl: string): { before: boolean; gap: string } {
  const parts = new Intl.NumberFormat(intl, { style: "currency", currency: "EUR" }).formatToParts(1)
  const index = parts.findIndex((part) => part.type === "currency")
  const literal = parts.find((part) => part.type === "literal")?.value ?? ""
  return { before: index === 0, gap: literal }
}

const whole = (intl: string, value: number) => value.toLocaleString(intl, { maximumFractionDigits: 0 })

// "7.950 ₿" or "₿7,950": whole units; an amount under one unit (a fee) is "< 1 ₿".
export function formatBitcoin(intl: string, msat: number): string {
  const { before, gap } = signPlacement(intl)
  const units = Math.round(Math.abs(msat) / MSAT_PER_UNIT)
  const text = before ? `₿${gap}${whole(intl, Math.max(units, msat === 0 ? 0 : 1))}` : `${whole(intl, Math.max(units, msat === 0 ? 0 : 1))}${gap}₿`
  if (units === 0 && msat !== 0) return `< ${text}`
  return msat < 0 ? `−${text}` : text
}

// "5,00 €" or "€5.00"; an amount under a cent is "< 0,01 €". `short` leaves the decimals off a
// whole amount ("5 €"), for the few amounts offered to tap.
export function formatFiat(intl: string, amount: number, currency: Currency, short = false): string {
  const whole = short && Number.isInteger(amount)
  const format = new Intl.NumberFormat(intl, { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })
  const abs = Math.abs(amount)
  if (abs > 0 && abs < 0.005) return `< ${format.format(0.01)}`
  const text = format.format(abs)
  return amount < 0 ? `−${text}` : text
}

// A fiat amount at a rate, or null without one.
export function formatFiatOf(intl: string, msat: number, rate: Rate | null): string | null {
  return rate ? formatFiat(intl, fiatFromMsat(msat, rate), rate.currency) : null
}

// A typed fiat amount ("5", "5,50", "5.50") as a number, or null when it isn't one.
// An amount with its sign for a list: "−5,00 €" for money that went out.
export const negative = (text: string) => `−${text}`

export function parseFiat(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".")
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return value > 0 ? value : null
}
