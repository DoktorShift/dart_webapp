"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Pencil } from "lucide-react"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import { CRICKET_TARGETS, dartLabel, visitBySeq, type MatchState, type Visit } from "@/lib/game/engine"
import type { Messages } from "@/lib/i18n"
import { suggestCheckout } from "@/lib/game/checkout"
import { legName } from "@/lib/game/words"
import type { Dart } from "@/lib/game/types"
import { cn } from "@/lib/utils"

export interface CorrectionTarget {
  // Visit number being corrected (the visit in progress, or any earlier visit of this leg).
  seq: number
  // Dart being replaced; null while the player picks which dart.
  slot: number | null
}

// How a dart reads on screen: "T20", "D16", "Bull", or the word for a miss. In Around the
// Clock only the number matters.
export function slotLabel(state: MatchState, dart: Dart, t: Messages) {
  if (dart.segment === 0) return t.common.miss
  if (state.config.type === "clock") return dart.segment === 25 ? t.common.bull : `${dart.segment}`
  return dartLabel(dart)
}

// What a finished visit scored: "60", "Bust", "2 marks", "2 of 3 hit".
export function visitResult(state: MatchState, visit: Visit, t: Messages) {
  if (state.config.type === "x01") {
    if (visit.bust) return t.board.bust
    return visit.total === 0 ? t.visit.noScoreResult : `${visit.total}`
  }
  if (state.config.type === "cricket") {
    return t.board.marks(visit.darts.reduce((sum, d) => sum + (CRICKET_TARGETS.includes(d.segment) ? d.multiplier : 0), 0))
  }
  return t.visit.hitsOf(visit.darts.filter((d) => d.segment > 0).length, visit.darts.length)
}

// One line about a finished visit: "Mia: 60", "Leo: 2 marks".
export const visitSummary = (state: MatchState, visit: Visit, t: Messages) =>
  t.visit.summary(state.config.players[visit.player].name, visitResult(state, visit, t))

interface VisitPanelProps {
  state: MatchState
  typedTotal: string | null
  correction: CorrectionTarget | null
  onSelectSlot: (seq: number, slot: number) => void
  onCorrectLast: () => void
  onCancelCorrection: () => void
}

export function VisitPanel({ state, typedTotal, correction, onSelectSlot, onCorrectLast, onCancelCorrection }: VisitPanelProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const x01 = state.config.type === "x01"
  const last = state.visitDarts.length === 0 ? state.legVisits.at(-1) : undefined
  const target = correction ? visitBySeq(state, correction.seq) : undefined
  const reviewing = !!target && correction!.seq !== state.visitSeq
  const shown: { darts: Dart[]; player: number; seq: number } = reviewing
    ? target!
    : { darts: state.visitDarts, player: state.current, seq: state.visitSeq }
  const darts = shown.darts
  const shownName = state.config.players[shown.player].name

  const remaining = state.scores[state.current]
  const dartsLeft = 3 - state.visitDarts.length
  const route = x01 ? suggestCheckout(remaining, typedTotal !== null ? 3 : dartsLeft, state.config.doubleOut) : null
  const visitPoints = !x01 ? null : reviewing ? (target!.bust ? 0 : target!.total) : state.visitStartScore - remaining

  let status: ReactNode
  if (correction) {
    const leg = target && target.leg !== state.legIndex ? t.visit.legPrefix(legName(t, state, target.leg)) : ""
    const task =
      correction.slot !== null
        ? t.visit.correctDart(correction.slot + 1)
        : reviewing && target!.enteredAsTotal
          ? t.visit.correctTotal(shownName)
          : t.visit.whichDart(shownName)
    status = leg + task
  } else {
    const thrower = state.config.players[state.current].name
    // Double In: until the player hits a double, that's what they need to know.
    status = !state.opened[state.current]
      ? t.visit.needsDouble(thrower)
      : state.legVisits.length === 0 && state.legIndex > 0
        ? t.visit.toThrowIn(thrower, legName(t, state))
        : t.visit.toThrow(thrower)
  }

  // The checkout route shows where the darts go: in the empty dart slots, or next to a typed
  // total. Only while a visit is being thrown, never during a correction.
  const ghost = x01 && !correction ? route : null

  // While a visit total is typed, say what it will do: bust, no finish possible, or checkout.
  let typedNote: { text: string; tone: "warning" | "success" } | null = null
  if (x01 && typedTotal && !correction) {
    const left = remaining - Number(typedTotal)
    const doubleOut = state.config.doubleOut
    if (left < 0 || (doubleOut && left === 1)) typedNote = { text: t.visit.typedBust(remaining), tone: "warning" }
    else if (left === 0 && [1, 2, 3].every((n) => !suggestCheckout(remaining, n, doubleOut)))
      typedNote = { text: t.visit.typedNoFinish(remaining), tone: "warning" }
    else if (left === 0) typedNote = { text: t.visit.checkout, tone: "success" }
  }

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/70 px-3 py-2 short:py-1.5 xshort:py-1 tablet:px-4 tablet:py-3",
        correction ? "border-warning/60" : "border-border",
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-3 text-[0.9375rem] xshort:min-h-6 tablet:text-[1.125rem]">
        <span className={cn("min-w-0 flex-1 font-semibold", correction && "text-warning")}>
          <FitText minScale={0.75} className="leading-tight">
            {status}
          </FitText>
        </span>
        {correction ? (
          <button type="button" onClick={onCancelCorrection} className="-my-2 -mr-2 flex min-h-11 shrink-0 items-center rounded-lg px-3 font-medium text-primary">
            {t.common.cancel}
          </button>
        ) : (
          last && (
            <button
              type="button"
              onClick={onCorrectLast}
              aria-label={t.visit.correctThis(visitSummary(state, last, t))}
              className={cn(
                "-my-2 -mr-2 flex min-h-11 min-w-0 max-w-[55%] items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] text-muted-foreground active:bg-secondary tablet:text-[0.9375rem]",
                last.bust && "text-danger",
              )}
            >
              <span className="min-w-0 flex-1">
                <FitText minScale={0.75}>{visitSummary(state, last, t)}</FitText>
              </span>
              <Pencil className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
            </button>
          )
        )}
      </div>

      <div className="mt-1 flex items-center gap-2">
        {typedTotal !== null ? (
          <div className="flex h-12 flex-1 items-center rounded-xl border border-primary/40 bg-primary/10 px-3 short:h-11 tablet:h-16">
            {typedNote ? (
              <span className={cn("text-[0.9375rem] font-semibold tablet:text-lg", typedNote.tone === "warning" ? "text-warning" : "text-success")}>
                {typedNote.text}
              </span>
            ) : ghost ? (
              <span className="flex min-w-0 gap-1.5" aria-hidden="true">
                {ghost.map((label, i) => (
                  <span key={i} className="rounded-md bg-success/10 px-1.5 dark:bg-success/15 font-display text-lg font-semibold text-success tablet:text-2xl">
                    {label}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-[0.8125rem] text-muted-foreground">{reviewing ? t.visit.correctedTotal : t.visit.total}</span>
            )}
            <span className="ml-auto font-display text-3xl font-semibold tabular-nums tablet:text-5xl">
              {typedTotal || <span className="text-muted-foreground/50">0</span>}
            </span>
          </div>
        ) : (
          <>
            {[0, 1, 2].map((i) => {
              const dart = darts.at(i)
              const suggestion = !dart && ghost ? ghost[i - darts.length] : undefined
              const selected = correction?.slot === i
              const editable = !!dart && !(reviewing && target!.enteredAsTotal)
              const slotClass = cn(
                "flex h-12 min-w-0 flex-1 items-center justify-center rounded-xl border font-display text-2xl font-semibold tabular-nums short:h-11 tablet:h-16 tablet:text-4xl",
                selected
                  ? "border-warning bg-warning/15 ring-2 ring-warning/50"
                  : dart
                    ? cn("border-primary/40 bg-primary/10", reviewing && "border-warning/40 bg-warning/5")
                    : suggestion
                      ? "border-dashed border-success/60 bg-success/5 text-success"
                      : i === darts.length && !reviewing
                        ? "border-dashed border-primary/60 text-muted-foreground/50"
                        : "border-dashed border-border text-muted-foreground/40",
              )
              const content = dart ? (
                <motion.span
                  key={`${shown.seq}-${i}-${dart.segment}-${dart.multiplier}`}
                  initial={reduceMotion ? false : { scale: 1.35, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 600, damping: 30 }}
                  className={cn(dart.segment === 0 && "text-lg text-muted-foreground")}
                >
                  {slotLabel(state, dart, t)}
                </motion.span>
              ) : suggestion ? (
                <span aria-hidden="true">{suggestion}</span>
              ) : (
                <span className="text-base">{i + 1}</span>
              )
              return editable ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectSlot(shown.seq, i)}
                  aria-label={t.visit.dartSlot(i + 1, slotLabel(state, dart!, t))}
                  aria-pressed={selected}
                  className={cn(slotClass, "active:scale-[0.97]")}
                >
                  {content}
                </button>
              ) : (
                <div key={i} className={slotClass}>
                  {content}
                </div>
              )
            })}
            {visitPoints !== null && (
              <div className="w-14 shrink-0 text-right font-display text-3xl font-semibold tabular-nums tablet:w-20 tablet:text-5xl">
                {visitPoints}
              </div>
            )}
          </>
        )}
      </div>

      {x01 && (
        <p className="sr-only" aria-live="polite">
          {typedNote ? typedNote.text : ghost ? t.visit.checkoutRoute(ghost.join(" ")) : ""}
        </p>
      )}
    </div>
  )
}
