"use client"

import type { ComponentType } from "react"
import { ChevronRight, X } from "lucide-react"
import { FitText } from "@/components/fit-text"
import { cn } from "@/lib/utils"

// The one row an area's piece in "result.actions" (lib/shell/registry.ts) is made of: the area's
// icon, one line that shrinks before it wraps, a tone that says how things stand, and at the end
// a way to put the row away ("Später", an X) or the chevron of a row that leads on; a row that
// leads nowhere only says how things stand (a status, without onClick). The result is
// one fixed screen, so the row is 48 pt, and 44 pt without the icon on short screens (`short`).
// The icon slot sets the height only, so an icon of two marks (the payment signet) keeps its own
// width beside the label. The row keeps the placement contract itself: in the result's top bar ("bar", a phone in
// landscape) it is one short line in the bar's colour, without box, icon or trailing part.

export type ResultRowTone = "neutral" | "accent" | "success" | "warning"

// What ends the row. Its buttons are at least 44 pt wide.
export type ResultRowTrailing =
  // A short word that puts the row away for this game; `ariaLabel` says for what.
  | { kind: "text"; label: string; ariaLabel?: string; onClick: () => void }
  // An X that puts the row away; `label` is its accessible name.
  | { kind: "dismiss"; label: string; onClick: () => void }
  // The row leads to a sheet.
  | { kind: "chevron" }

export interface ResultRowProps {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  // How things stand, said by the words as well: an invitation to act (accent, in the primary
  // colour), done (success) or something worth a look (warning).
  tone?: ResultRowTone
  // What the row leads to; without one the row only says how things stand (a status).
  onClick?: () => void
  placement: "row" | "bar"
  trailing?: ResultRowTrailing
  ariaLabel?: string
}

const TONES: Record<ResultRowTone, { box: string; pressed: string }> = {
  neutral: { box: "bg-card ring-border divide-border", pressed: "focus-visible:bg-secondary/50 active:bg-secondary/70" },
  accent: { box: "bg-card text-primary ring-border divide-border", pressed: "focus-visible:bg-secondary/50 active:bg-secondary/70" },
  success: { box: "bg-success/10 text-success ring-success/30 divide-success/30", pressed: "focus-visible:bg-success/15 active:bg-success/20" },
  warning: { box: "bg-warning/10 text-warning ring-warning/30 divide-warning/30", pressed: "focus-visible:bg-warning/15 active:bg-warning/20" },
}

export function ResultRow({ icon: Icon, label, tone = "neutral", onClick, placement, trailing, ariaLabel }: ResultRowProps) {
  const Main = onClick ? "button" : "p"
  const main = onClick ? { type: "button" as const, onClick } : { role: "status" }
  if (placement === "bar") {
    return (
      <Main
        {...main}
        aria-label={ariaLabel}
        className="flex h-11 min-w-0 max-w-full items-center rounded-xl px-2 text-[0.9375rem] font-medium text-primary transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary/70"
      >
        <FitText minScale={0.7} className="leading-snug">
          {label}
        </FitText>
      </Main>
    )
  }

  const { box, pressed } = TONES[tone]
  return (
    <div className={cn("flex min-h-12 items-stretch divide-x overflow-hidden rounded-2xl ring-1 ring-inset short:min-h-11", box)}>
      <Main
        {...main}
        aria-label={ariaLabel}
        className={cn("flex min-w-0 flex-1 items-center gap-3 py-1 pl-4 pr-3 text-left text-[1.0625rem] font-medium transition-colors focus-visible:outline-hidden", onClick && pressed)}
      >
        <Icon className="h-5 w-auto shrink-0 short:hidden" aria-hidden />
        <FitText minScale={0.7} className="flex-1 leading-snug">
          {label}
        </FitText>
        {trailing?.kind === "chevron" && <ChevronRight className="-mr-1 h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />}
      </Main>
      {trailing && trailing.kind !== "chevron" && (
        <button
          type="button"
          onClick={trailing.onClick}
          aria-label={trailing.kind === "dismiss" ? trailing.label : trailing.ariaLabel}
          className={cn("flex min-w-11 shrink-0 items-center justify-center px-3 text-[0.9375rem] text-muted-foreground transition-colors focus-visible:outline-hidden", pressed)}
        >
          {trailing.kind === "dismiss" ? <X className="h-5 w-5" aria-hidden="true" /> : trailing.label}
        </button>
      )}
    </div>
  )
}
