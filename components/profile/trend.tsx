"use client"

import type { ReactNode } from "react"
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

// A direction: arrow, word and colour together, never colour alone (HIG: accessibility). The
// caller writes the sentence ("1,9 besser als in den 10 davor"); this adds the arrow and tone.
export function Direction({ diff, higherIsBetter = true, children, className }: { diff: number; higherIsBetter?: boolean; children: ReactNode; className?: string }) {
  const better = diff === 0 ? 0 : (diff > 0) === higherIsBetter ? 1 : -1
  const Icon = diff === 0 ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn("inline-flex items-center gap-1", better > 0 ? "text-success" : better < 0 ? "text-danger" : "text-muted-foreground", className)}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </span>
  )
}

// The small arrow next to a figure in a list row, when it has something to be compared with.
export function Arrow({ diff, higherIsBetter = true }: { diff: number; higherIsBetter?: boolean }) {
  if (diff === 0) return null
  const better = (diff > 0) === higherIsBetter
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  return <Icon className={cn("ml-0.5 inline h-4 w-4 shrink-0 align-[-2px]", better ? "text-success" : "text-danger")} aria-hidden />
}
