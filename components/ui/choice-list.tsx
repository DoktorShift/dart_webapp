"use client"

import type { ReactNode } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ChoiceListOption<T extends string> {
  value: T
  title: ReactNode
  subtitle?: ReactNode
}

// One choice out of a list, with a checkmark on the chosen row, like a picker in iOS Settings.
// For choices whose labels are too long or too many for a segmented control (player names).
// Labels wrap; nothing is cut off.
export function ChoiceList<T extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  className,
  disabled,
}: {
  // The group's name: a text, or the id of the text that stands above it.
  label?: string
  labelledBy?: string
  options: ChoiceListOption<T>[]
  value: T | null
  onChange: (value: T) => void
  className?: string
  // While a choice is being saved: no second tap, the list looks the part.
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-labelledby={labelledBy} aria-busy={disabled || undefined} className={cn("divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card", disabled && "opacity-60", className)}>
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-[1.0625rem] transition-colors focus-visible:bg-secondary/50 focus-visible:outline-none active:bg-secondary/70"
          >
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <span className="block leading-snug">{option.title}</span>
              {option.subtitle && <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">{option.subtitle}</span>}
            </span>
            <Check className={cn("h-5 w-5 shrink-0 text-primary", !checked && "invisible")} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
