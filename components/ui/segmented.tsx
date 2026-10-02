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
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-secondary/70 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-11 rounded-lg px-2 text-[0.9375rem] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
            value === option.value ? "bg-background text-foreground shadow" : "text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
