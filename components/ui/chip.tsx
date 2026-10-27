import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type ChipTone = "neutral" | "accent" | "success" | "warning" | "live"

const TONES: Record<ChipTone, string> = {
  neutral: "bg-secondary/80 text-muted-foreground",
  accent: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  live: "bg-danger/10 text-danger",
}

// A short state word on a card or under a title ("Anmeldung offen", "Du leitest", "Live"):
// one vocabulary for the whole app. Colour says how things stand, the words say it too. "live"
// carries a dot that pulses, unless motion is reduced.
export function Chip({ tone = "neutral", icon: Icon, children, className }: { tone?: ChipTone; icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[0.75rem] font-semibold leading-5 wrap-anywhere", TONES[tone], className)}>
      {tone === "live" && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger motion-safe:animate-pulse" />}
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0">{children}</span>
    </span>
  )
}

// Chips in a row, wrapping on narrow screens. A span, so it may sit inside a button.
export function Chips({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("flex flex-wrap items-center gap-1.5", className)}>{children}</span>
}
