"use client"

import { useId, useMemo } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { Bars, type Bar } from "@/components/profile/bars"
import { measure, measureDiff, monthName } from "@/components/profile/format"
import { Direction } from "@/components/profile/trend"
import { useTrainingGoals } from "@/components/profile/use-goals"
import type { GameType } from "@/lib/game/types"
import { addMonths, startOfMonth } from "@/lib/calendar"
import { reachedCount } from "@/lib/profile/goal"
import { trainingBuckets, trainingOf, TRAINING_MIN, type Training } from "@/lib/profile/training"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { gamePoints, type StatsOptions } from "@/lib/storage/stats"

// The training on the Profile tab: this month against the one before, in the game type the
// player trains most, and the last six months as bars with the player's goal line, when one is
// set. The head is the button into the training screen; the chart sits beside it. Without any
// training it says what starts the record and offers to start one.
const CARD_MONTHS = 6

// The type with the most trainings, X01 when none.
export function trainedMost(matches: readonly ArchivedMatch[], key: string, options: Pick<StatsOptions, "aliases" | "sameAs">): GameType {
  const counts = new Map<GameType, number>()
  for (const p of gamePoints(matches, key, { ...options, scope: "training" })) counts.set(p.match.modeType, (counts.get(p.match.modeType) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "x01"
}

// "Ø 49,8 im Oktober", "Noch kein Training im Oktober · 12 insgesamt": the month's headline,
// shared by the card and the screen.
export function monthHeadline(t: ReturnType<typeof useT>, r: ReturnType<typeof useAreaT<typeof PROFILE_TEXTS.de>>["training"], training: Training) {
  const { type, month, points } = training
  const name = monthName(t, month.start)
  if (month.value !== null) return r.month(type === "x01" ? `Ø ${measure(t, type, month.value)}` : `${measure(t, type, month.value)} ${r.measure[type]}`, name)
  if (month.games > 0) return r.month(r.count(month.games), name)
  return r.noneThisMonth(name, points.length)
}

export function TrainingCard({ matches, playerKey, aliases, sameAs, onOpen, onStart }: { matches: readonly ArchivedMatch[]; playerKey: string; onOpen: () => void; onStart: () => void } & Pick<StatsOptions, "aliases" | "sameAs">) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const r = tx.training
  const titleId = useId()
  const lineId = useId()
  const now = useMemo(() => Date.now(), [])
  const type = useMemo(() => trainedMost(matches, playerKey, { aliases, sameAs }), [matches, playerKey, aliases, sameAs])
  const goal = useTrainingGoals()[type] ?? null
  const training = useMemo(() => trainingOf(matches, playerKey, { type, aliases, sameAs, now }), [matches, playerKey, type, aliases, sameAs, now])
  const buckets = useMemo(
    () => trainingBuckets(training.points, playerKey, { type, aliases, sameAs }, "month", addMonths(startOfMonth(now), 1 - CARD_MONTHS), addMonths(startOfMonth(now), 1)),
    [training.points, playerKey, type, aliases, sameAs, now],
  )

  if (training.points.length === 0) {
    return (
      <section aria-labelledby={titleId} className="mt-4 rounded-2xl border border-border bg-card px-4 py-3">
        <p id={titleId} className="text-[0.8125rem] font-medium text-muted-foreground">{r.title}</p>
        <p className="mt-0.5 text-[1.0625rem] font-semibold leading-snug">{r.none}</p>
        <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{r.noneText}</p>
        <Button variant="secondary" onClick={onStart} className="mt-3 h-11 w-full rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20">
          {r.start}
        </Button>
      </section>
    )
  }

  const { month, previous } = training
  const prevName = monthName(t, previous.start)
  const diff = month.value !== null && previous.value !== null ? month.value - previous.value : null
  const second =
    diff !== null ? <Direction diff={diff}>{diff === 0 ? r.same(prevName) : diff > 0 ? r.better(measureDiff(t, type, diff), prevName) : r.worse(measureDiff(t, type, diff), prevName)}</Direction>
    : month.value !== null ? <span className="text-muted-foreground">{r.noPrevious(prevName)}</span>
    : month.games > 0 ? <span className="text-muted-foreground">{r.tooFewThisMonth(TRAINING_MIN)}</span>
    : training.streak > 0 ? <span className="text-muted-foreground">{r.streak(training.streak)}</span>
    : null
  const values = buckets.map((b) => b.value).filter((v): v is number => v !== null)
  const best = values.length > 0 ? Math.max(...values) : null
  const bars: Bar[] = buckets.map((b) => ({
    value: b.value,
    label: monthName(t, b.start).slice(0, 3),
    tone: b.value === null ? (b.games > 0 ? "tooFew" : "empty") : b.value === best ? "best" : "normal",
    text: b.value === null ? (b.games > 0 ? r.tooFew : undefined) : (measure(t, type, b.value) ?? undefined),
  }))

  return (
    <section aria-labelledby={titleId} className="mt-4 rounded-2xl border border-border bg-card px-4 py-3">
      <button type="button" onClick={onOpen} aria-labelledby={`${titleId} ${lineId}`} className="-mx-4 -mt-3 flex w-[calc(100%+2rem)] items-center gap-3 rounded-t-2xl px-4 pt-3 text-left transition-colors active:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="block min-w-0 flex-1">
          <span id={titleId} className="block text-[0.8125rem] font-medium text-muted-foreground">{r.title}</span>
          <span id={lineId} className="mt-0.5 block text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{monthHeadline(t, r, training)}</span>
          {second && (
            <span className="mt-0.5 block text-[0.9375rem] leading-snug">
              {second}
              {diff !== null && month.games > 0 && <span className="text-muted-foreground"> · {r.count(month.games)}</span>}
            </span>
          )}
        </span>
        <ChevronRight className="-mr-1 h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      </button>
      {values.length > 0 && (
        <Bars
          bars={bars}
          height={40}
          className="mt-2"
          goal={goal === null ? undefined : { value: goal, label: r.goalValue(measure(t, type, goal) ?? ""), text: measure(t, type, goal) ?? "" }}
          range={goal === null ? undefined : r.goalValue(measure(t, type, goal) ?? "")}
          summary={[r.summary(values.length, measure(t, type, Math.min(...values)) ?? "", measure(t, type, Math.max(...values)) ?? "", monthName(t, buckets.find((b) => b.value === best)?.start ?? now)), goal === null ? null : r.goalReachedIn(reachedCount(values, goal), values.length, r.periods.month)].filter(Boolean).join(". ")}
        />
      )}
    </section>
  )
}
