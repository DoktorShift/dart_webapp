"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { useAreaT } from "@/components/i18n-provider"
import { useMoney } from "@/components/payments/use-money"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { FIAT_PRESETS, MSAT_PER_UNIT, fiatFromMsat, parseFiat, type Amount } from "@/lib/payments/money"
import { AMOUNT_PRESETS, MAX_SATS } from "@/lib/payments/stake"

// Choosing an amount (HIG: offer choices before typing): a few amounts in the person's currency
// to tap, or any other typed in; "In Bitcoin eingeben" switches to whole bitcoin units. Under it,
// the other side of what was chosen with the rate's time. Without a rate only bitcoin is offered.
// `value` is null while nothing usable is chosen; an amount above the maximum is said in place.

type Mode = "fiat" | "bitcoin"

// Digits with one decimal sign and at most two decimals, as typed in the currency.
function cleanFiat(text: string) {
  const [whole, ...rest] = text.replace(/[^\d.,]/g, "").split(/[.,]/)
  const decimals = rest.join("").slice(0, 2)
  const hasSign = /[.,]/.test(text)
  return `${whole.replace(/^0+(?=\d)/, "").slice(0, 6)}${hasSign ? `,${decimals}` : ""}`
}

export function AmountPicker({
  label,
  value,
  onChange,
  bitcoinPresets = AMOUNT_PRESETS,
  defaultFiat,
}: {
  label: string
  value: Amount | null
  onChange: (amount: Amount | null) => void
  bitcoinPresets?: readonly number[]
  // Chosen for the person as soon as a rate is known, while they chose nothing themselves.
  defaultFiat?: number
}) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const money = useMoney()
  const inputId = useId()
  const hintId = useId()
  const rate = money.rate
  // A value chosen in a currency is shown in it; a value in bitcoin, or none without a rate, in
  // bitcoin. The text typed so far always belongs to the mode shown.
  const typedFor = (next: Mode, chosen: Amount | null) => {
    if (chosen === null) return ""
    if (next === "fiat") return chosen.fiat && !(FIAT_PRESETS as readonly number[]).includes(chosen.fiat.amount) ? cleanFiat(String(chosen.fiat.amount)) : ""
    return (bitcoinPresets as readonly number[]).includes(chosen.sats) ? "" : String(chosen.sats)
  }
  const [mode, setMode] = useState<Mode>(() => (value?.fiat || (rate && value === null) ? "fiat" : "bitcoin"))
  const [typed, setTyped] = useState(() => typedFor(value?.fiat || (rate && value === null) ? "fiat" : "bitcoin", value))
  // The rate coming or going: with one, nothing chosen yet, the currency becomes the first choice
  // and the default amount is chosen where there is one; without one, only bitcoin can be chosen.
  const defaulted = useRef(false)
  useEffect(() => {
    if (!rate) {
      if (mode === "fiat" && !value?.fiat) {
        setMode("bitcoin")
        setTyped(typedFor("bitcoin", value))
      }
      return
    }
    if (value !== null || typed !== "") return
    if (mode === "bitcoin") setMode("fiat")
    if (defaultFiat && !defaulted.current) {
      defaulted.current = true
      onChange(money.fromFiat(defaultFiat))
    }
    // Only when the rate appears or goes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate !== null])

  const fiatMax = rate ? fiatFromMsat(MAX_SATS * MSAT_PER_UNIT, rate) : null
  const typedFiat = mode === "fiat" ? parseFiat(typed) : null
  const typedSats = mode === "bitcoin" && typed !== "" ? Number(typed) : null
  const tooHigh = (typedFiat !== null && fiatMax !== null && typedFiat > fiatMax) || (typedSats !== null && typedSats > MAX_SATS)

  const choose = (next: Amount | null, typedText: string) => {
    setTyped(typedText)
    onChange(next)
  }
  const switchMode = (next: Mode) => {
    setMode(next)
    choose(null, "")
  }

  const preset = typed === "" ? (mode === "fiat" ? value?.fiat?.amount : value?.sats) : undefined
  const options =
    mode === "fiat" && rate
      ? FIAT_PRESETS.map((amount) => ({ value: amount, label: money.fiatOf({ amount, currency: rate.currency }, true) }))
      : bitcoinPresets.map((sats) => ({ value: sats, label: money.bitcoin(sats * MSAT_PER_UNIT) }))

  // The other side of the chosen amount, and the rate it rests on.
  const other = value === null ? null : mode === "fiat" ? tx.explain.pays(money.bitcoin(value.sats * MSAT_PER_UNIT)) : money.fiat(value.sats * MSAT_PER_UNIT) && tx.rate.approx(money.fiat(value.sats * MSAT_PER_UNIT)!)
  const rateLine = value !== null && rate ? money.rateLine() : null

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={label}
        options={options}
        value={preset}
        onChange={(chosen) => choose(mode === "fiat" && rate ? money.fromFiat(chosen) : { sats: chosen }, "")}
      />
      <div>
        <label htmlFor={inputId} className="mb-2 block px-4 text-[0.8125rem] text-muted-foreground">
          {tx.amount.custom}
        </label>
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card pl-4 pr-4">
          <input
            id={inputId}
            value={typed}
            onChange={(event) => {
              if (mode === "fiat") {
                const text = cleanFiat(event.target.value)
                const amount = parseFiat(text)
                choose(amount !== null && fiatMax !== null && amount <= fiatMax ? money.fromFiat(amount) : null, text)
              } else {
                // Whole units only; seven digits reach past the maximum, so "too high" can show.
                const digits = event.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 7)
                const sats = Number(digits)
                choose(digits && sats <= MAX_SATS ? { sats } : null, digits)
              }
            }}
            inputMode={mode === "fiat" ? "decimal" : "numeric"}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="0"
            aria-describedby={tooHigh ? hintId : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent text-[1.0625rem] tabular-nums outline-hidden placeholder:text-muted-foreground/70"
          />
          <span aria-hidden="true" className="text-[1.0625rem] text-muted-foreground">
            {mode === "fiat" ? money.symbol : "₿"}
          </span>
        </div>
        {tooHigh && (
          <p id={hintId} role="alert" className="mt-2 px-4 text-[0.8125rem] text-danger">
            {tx.amount.tooHigh(mode === "fiat" && fiatMax !== null && rate ? money.fiatOf({ amount: fiatMax, currency: rate.currency }) : money.bitcoin(MAX_SATS * MSAT_PER_UNIT))}
          </p>
        )}
      </div>
      {(other || rateLine || rate) && (
        <div className="flex items-start justify-between gap-3 px-4">
          <p className="min-w-0 text-[0.8125rem] leading-snug text-muted-foreground">
            {other}
            {other && rateLine && " "}
            {rateLine}
          </p>
          {rate && (
            <Button variant="link" size="sm" onClick={() => switchMode(mode === "fiat" ? "bitcoin" : "fiat")} className="-my-2 -mr-2 h-auto min-h-11 shrink-0 px-2 text-[0.8125rem]">
              {mode === "fiat" ? tx.amount.inBitcoin : tx.amount.inCurrency(tx.settings.currencies[money.currency])}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
