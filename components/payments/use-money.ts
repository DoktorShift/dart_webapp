"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { useT } from "@/components/i18n-provider"
import { formatClock, formatDateTime } from "@/lib/i18n"
import { MSAT_PER_UNIT, UNITS_PER_BITCOIN, currencySymbol, defaultCurrency, fiatFromMsat, formatBitcoin, formatFiat, isRateOld, unitsFromFiat, type Amount, type Currency, type FiatAmount, type Rate } from "@/lib/payments/money"
import { loadRate, peekRate, refreshRate, subscribeRate } from "@/lib/payments/rate"
import { loadMoneySettings, type MoneySettings } from "@/lib/payments/settings"
import { useStored } from "@/lib/storage/hooks"

// Money as this device shows it (docs/ux/zahlungen-vorschlag.html): the amount in the person's
// currency first and the bitcoin amount (₿) second, or the other way round when they chose so
// in Einstellungen; the word "sats" nowhere. The rate comes from nostr-core's public price
// service, asked at most once a minute while a view with `live` figures is shown, and the last
// one is kept on the device. Without any rate, amounts show in bitcoin only.

// Until the stored settings are read: the region's currency, as a new device starts.
const fallbackSettings = (): MoneySettings => ({ currency: defaultCurrency(typeof navigator === "undefined" ? undefined : navigator.language), order: "fiat", balanceInProfile: true })
const REFRESH_MS = 60_000

export interface Money {
  // The stored settings are read; before that nothing is chosen or fetched for the person.
  ready: boolean
  settings: MoneySettings
  currency: Currency
  symbol: string
  rate: Rate | null
  // "7.950 ₿"
  bitcoin(msat: number): string
  // "5,00 €" at the current rate, or null without one.
  fiat(msat: number): string | null
  // A currency amount as it was chosen or agreed; `short` without decimals on a whole amount.
  fiatOf(fiat: FiatAmount, short?: boolean): string
  // What a row, a button or a headline says: the first of the two sides. With `fiat` the agreed
  // currency amount, else the current rate's; without a rate, bitcoin.
  primary(msat: number, fiat?: FiatAmount): string
  // The other side, or null when there is none (no rate, so bitcoin is all there is).
  secondary(msat: number, fiat?: FiatAmount): string | null
  // "Kurs von 18:40", or that there is no rate right now; null while a stored currency amount is
  // shown (its rate was then).
  rateLine(fiat?: FiatAmount): string | null
  // An amount chosen in the currency, as whole bitcoin units with the currency amount noted.
  fromFiat(amount: number): Amount | null
  // An amount in msat with the currency amount it is worth now, for the journal.
  noted(msat: number): FiatAmount | undefined
  // A moment (ms): "21:14" today, with its date on another day.
  time(ms: number): string
}

const readSettings = () => loadMoneySettings().catch(fallbackSettings)

export function useMoney({ live = true }: { live?: boolean } = {}): Money {
  const t = useT()
  const stored = useStored("kv", readSettings)[0]
  const ready = stored !== undefined
  const settings = useMemo(() => stored ?? fallbackSettings(), [stored])
  const currency = settings.currency
  const known = useSyncExternalStore(
    subscribeRate,
    () => peekRate(currency),
    () => null,
  )
  // No rate before the currency is certain, so nothing is chosen in the wrong one.
  const rate = ready ? known : null

  // The stored rate at once; a fresh one while a live view is shown, and again when the app
  // comes back to the screen.
  useEffect(() => {
    if (!ready) return
    void loadRate(currency)
    if (!live) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (document.hidden) return
      void refreshRate(currency)
      clearTimeout(timer)
      timer = setTimeout(refresh, REFRESH_MS)
    }
    refresh()
    document.addEventListener("visibilitychange", refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [currency, live, ready])

  return useMemo<Money>(() => {
    const { intl } = t
    const bitcoin = (msat: number) => formatBitcoin(intl, msat)
    const fiat = (msat: number) => (rate ? formatFiat(intl, fiatFromMsat(msat, rate), rate.currency) : null)
    const fiatOf = (amount: FiatAmount, short = false) => formatFiat(intl, amount.amount, amount.currency, short)
    const fiatSide = (msat: number, agreed?: FiatAmount) => (agreed ? fiatOf(agreed) : fiat(msat))
    const time = (ms: number) => (new Date(ms).toDateString() === new Date().toDateString() ? formatClock(t, ms) : formatDateTime(t, ms))
    return {
      ready,
      settings,
      currency,
      symbol: currencySymbol(intl, currency),
      rate,
      bitcoin,
      fiat,
      fiatOf,
      primary: (msat, agreed) => (settings.order === "fiat" ? (fiatSide(msat, agreed) ?? bitcoin(msat)) : bitcoin(msat)),
      secondary: (msat, agreed) => {
        const side = fiatSide(msat, agreed)
        if (settings.order === "fiat") return side ? bitcoin(msat) : null
        return side
      },
      rateLine: (agreed) => {
        if (agreed) return null
        if (!rate) return t.payments.rateMissing
        return t.payments.rateFrom(isRateOld(rate) ? formatDateTime(t, rate.at) : formatClock(t, rate.at))
      },
      fromFiat: (amount) => (rate && amount > 0 ? { sats: unitsFromFiat(amount, rate), fiat: { amount, currency: rate.currency } } : null),
      noted: (msat) => (rate ? { amount: Math.round(fiatFromMsat(msat, rate) * 100) / 100, currency: rate.currency } : undefined),
      time,
    }
  }, [t, ready, settings, currency, rate])
}

// A whole bitcoin, in units: for texts that explain the unit.
export const WHOLE_BITCOIN_MSAT = UNITS_PER_BITCOIN * MSAT_PER_UNIT
