"use client"

import { useRef } from "react"
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
  const ref = useRef<HTMLDivElement>(null)
  const move = (index: number, direction: number) => {
    for (let offset = 1; offset <= options.length; offset++) {
      const next = (index + direction * offset + options.length) % options.length
      if (!options[next].disabled) {
        onChange(options[next].value)
        ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
        return
      }
    }
  }
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-secondary/70 p-1">
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value || (value === undefined && index === options.findIndex((item) => !item.disabled)) ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") move(index, 1)
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(index, -1)
            else return
            event.preventDefault()
          }}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-11 min-w-0 rounded-lg px-1.5 py-1 text-[0.9375rem] font-medium leading-tight tabular-nums transition-colors wrap-anywhere focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [@media(max-width:359px)]:px-1 [@media(max-width:359px)]:text-[0.8125rem]",
            value === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
