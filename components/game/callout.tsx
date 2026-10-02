"use client"

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useT } from "@/components/i18n-provider"
import { CRICKET_TARGETS, type MatchState } from "@/lib/game/engine"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type CalloutKind = "180" | "bust" | "nine-marks"
export interface Callout {
  id: number
  kind: CalloutKind
}

// What the last throw deserves a flash for, if anything. A finished leg has its own card.
export function calloutFor(state: MatchState): CalloutKind | null {
  const o = state.outcome
  if (o.type === "bust") return "bust"
  if (o.type !== "visit") return null
  if (state.config.type === "x01" && o.total === 180) return "180"
  if (state.config.type === "cricket") {
    const visit = state.legVisits.at(-1)
    const marks = visit?.darts.reduce((sum, d) => sum + (CRICKET_TARGETS.includes(d.segment) ? d.multiplier : 0), 0) ?? 0
    if (marks === 9) return "nine-marks"
  }
  return null
}

const COLOR: Record<CalloutKind, string> = {
  "180": "text-warning ring-warning/60",
  bust: "text-danger ring-danger/60",
  "nine-marks": "text-success ring-success/60",
}

const word = (kind: CalloutKind, t: Messages) => (kind === "180" ? "180" : kind === "bust" ? t.callout.bust : t.callout.nineMarks)

// Covers the scoreboard, never the keys, and lets every tap through: the next player can
// start entering darts while it is still showing.
export function CalloutFlash({ callout }: { callout: Callout | null }) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const text = callout ? word(callout.kind, t) : ""
  return (
    <AnimatePresence>
      {callout && (
        <motion.div
          key={callout.id}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-card/95 ring-2 ring-inset backdrop-blur-sm",
            COLOR[callout.kind],
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          transition={{ duration: 0.12 }}
        >
          <motion.span
            initial={reduceMotion ? false : { scale: 0.5 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 20 }}
            // As big as the scoreboard allows: by its height, and by its width for longer words.
            style={{ fontSize: `clamp(2.5rem, min(70cqh, ${Math.round(150 / text.length)}cqw), 14rem)` }}
            className="whitespace-nowrap font-display font-semibold leading-none tracking-tight"
          >
            {text}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
