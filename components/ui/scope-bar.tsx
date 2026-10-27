"use client"

import { useEffect, useRef, type ComponentType } from "react"
import { cn } from "@/lib/utils"

export interface ScopeOption<T extends string> {
  value: T
  label: string
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>
}

// A row of pills for the areas of a screen, one of them chosen (the filter pills of the App
// Store, Fitness and Maps): every label stays one line and whole, and when the row is wider than
// the screen it scrolls sideways, bleeding to the screen's edges like a list. For VoiceOver and
// the keyboard it is a radio group: arrows move the choice. Where three short choices fit side
// by side, a segmented control (./segmented.tsx) is the simpler control.
export function ScopeBar<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  // What is being chosen ("Bereich"), for VoiceOver.
  label: string
  options: readonly ScopeOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // The chosen pill comes into view, also when the choice was made elsewhere.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [value])

  const move = (from: number, by: number) => {
    const next = options[(from + by + options.length) % options.length]
    onChange(next.value)
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[options.indexOf(next)]?.focus()
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={cn("-mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 scrollbar-none [&::-webkit-scrollbar]:hidden", className)}
    >
      {options.map((option, index) => {
        const chosen = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") move(index, 1)
              else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(index, -1)
              else return
              event.preventDefault()
            }}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[0.9375rem] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              chosen ? "bg-primary text-primary-foreground" : "bg-secondary/70 text-foreground hover:bg-secondary",
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
