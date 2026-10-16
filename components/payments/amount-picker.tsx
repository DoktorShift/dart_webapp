"use client"

import { useId, useState } from "react"
import { Segmented } from "@/components/ui/segmented"
import { useAreaT } from "@/components/i18n-provider"
import { useFormat } from "@/components/payments/format"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { MAX_SATS } from "@/lib/payments/stake"

// An amount in sats: a few common ones to tap, or any other whole amount typed in. `value` is
// null while nothing usable is chosen; a typed amount above the maximum is said in place.
export function AmountPicker({ label, presets, value, onChange }: { label: string; presets: readonly number[]; value: number | null; onChange: (sats: number | null) => void }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const format = useFormat()
  const inputId = useId()
  const hintId = useId()
  const preset = value !== null && presets.includes(value) ? value : undefined
  const [typed, setTyped] = useState(value !== null && preset === undefined ? String(value) : "")
  const tooHigh = typed !== "" && Number(typed) > MAX_SATS

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={label}
        options={presets.map((sats) => ({ value: sats, label: format.number(sats) }))}
        value={preset}
        onChange={(sats) => {
          setTyped("")
          onChange(sats)
        }}
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
              // Whole sats only; seven digits reach past the maximum, so "too high" can show.
              const digits = event.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 7)
              setTyped(digits)
              const sats = Number(digits)
              onChange(digits && sats <= MAX_SATS ? sats : null)
            }}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            placeholder={tx.amount.placeholder}
            aria-describedby={tooHigh ? hintId : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent text-[1.0625rem] tabular-nums outline-none placeholder:text-muted-foreground/70"
          />
          <span aria-hidden="true" className="text-[1.0625rem] text-muted-foreground">
            {tx.unit}
          </span>
        </div>
        {tooHigh && (
          <p id={hintId} role="alert" className="mt-2 px-4 text-[0.8125rem] text-danger">
            {tx.amount.tooHigh(format.sats(MAX_SATS))}
          </p>
        )}
      </div>
    </div>
  )
}
