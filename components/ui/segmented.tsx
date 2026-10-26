"use client"

import { cn } from "@/lib/utils"

export interface SegmentedOption<T> {
  value: T
  label: string
  disabled?: boolean
}

// A segmented control (HIG): one choice out of a few, all of them visible.
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: SegmentedOption<T>[]
  value: T | undefined
  onChange: (value: T) => void
}) {
  return (
    // Up to three segments share the width equally; from four on, each takes what its words need
    // (iOS apportions segment widths by content), so the longest word stays whole on a phone.
    <div role="radiogroup" aria-label={label} className={cn("grid grid-flow-col gap-1 rounded-xl bg-secondary/70 p-1", options.length >= 4 ? "[grid-auto-columns:minmax(min-content,auto)]" : "auto-cols-fr")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-11 min-w-0 rounded-lg px-1.5 py-1 text-[0.9375rem] font-medium leading-tight tabular-nums transition-colors break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [@media(max-width:359px)]:px-1 [@media(max-width:359px)]:text-[0.8125rem]",
            // Four areas on a phone: smaller type and tighter padding.
            options.length >= 4 && "[@media(max-width:439px)]:px-1 [@media(max-width:439px)]:text-[0.8125rem]",
            value === option.value ? "bg-background text-foreground shadow" : "text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
