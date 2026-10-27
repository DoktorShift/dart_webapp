"use client"

import { useId, useMemo } from "react"
import { ChevronRight } from "lucide-react"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { Bars, type Bar } from "@/components/profile/bars"
import { fixed, measureDiff, shortDate } from "@/components/profile/format"
import { Direction } from "@/components/profile/trend"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { FORM_MIN, formOf, type StatsOptions } from "@/lib/storage/stats"

// The form on the Profile tab: the X01 average of the last games against others as a sentence
// with its direction, and one bar per game, the best in orange (Apple Fitness: trends say "now
// against before" with an arrow, a word and a colour, and only from enough data). The head is
// the button into the statistics; the chart sits beside it, so VoiceOver names the button by
// its two lines, not by every bar. Before the first game against others there is nothing to
// say, and the card stays away; from then on it counts down to the first form.
export const FORM_WINDOW = 10

export function FormCard({ matches, playerKey, aliases, sameAs, onOpen }: { matches: readonly ArchivedMatch[]; playerKey: string; onOpen: () => void } & Pick<StatsOptions, "aliases" | "sameAs">) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const f = tx.formCard
  const titleId = useId()
  const lineId = useId()
  const form = useMemo(() => formOf(matches, playerKey, FORM_WINDOW, { type: "x01", scope: "versus", aliases, sameAs }), [matches, playerKey, aliases, sameAs])
  if (form.games === 0) return null
  const enough = form.value !== null
  const values = form.points.map((p) => p.value).filter((v): v is number => v !== null)
  const best = values.length > 0 ? Math.max(...values) : null
  const bars: Bar[] = form.points.map((p) => ({ value: p.value, label: shortDate(t, p.match.finishedAt), tone: p.value === best ? "best" : "normal", text: p.value === null ? undefined : fixed(t, p.value) }))
  const trend = values.length > 1 ? (values[values.length - 1] > values[0] ? f.trends.up : values[values.length - 1] < values[0] ? f.trends.down : f.trends.flat) : f.trends.flat
  const diff = form.value !== null && form.before !== null ? form.value - form.before : null

  if (!enough) {
    return (
      <section aria-labelledby={titleId} className="mt-4 rounded-2xl border border-border bg-card px-4 py-3">
        <p id={titleId} className="text-[0.8125rem] font-medium text-muted-foreground">{f.title}</p>
        <p className="mt-0.5 text-[1.0625rem] leading-snug text-muted-foreground">{f.countdown(FORM_MIN - form.games)}</p>
      </section>
    )
  }
  return (
    <section aria-labelledby={titleId} className="mt-4 rounded-2xl border border-border bg-card px-4 py-3">
      <button type="button" onClick={onOpen} aria-labelledby={`${titleId} ${lineId}`} className="-mx-4 -mt-3 flex w-[calc(100%+2rem)] items-center gap-3 rounded-t-2xl px-4 pt-3 text-left transition-colors active:bg-secondary/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        <span className="block min-w-0 flex-1">
          <span id={titleId} className="block text-[0.8125rem] font-medium text-muted-foreground">{f.title}</span>
          <span id={lineId} className="mt-0.5 block text-[1.0625rem] font-semibold leading-snug wrap-anywhere">{f.sentence(fixed(t, form.value!), form.points.length)}</span>
          <span className="mt-0.5 block text-[0.9375rem] leading-snug">
            {diff === null ? (
              <span className="text-muted-foreground">{f.noBefore(FORM_WINDOW * 2)}</span>
            ) : (
              <Direction diff={diff}>{diff === 0 ? f.same(FORM_WINDOW) : diff > 0 ? f.better(measureDiff(t, "x01", diff), FORM_WINDOW) : f.worse(measureDiff(t, "x01", diff), FORM_WINDOW)}</Direction>
            )}
          </span>
        </span>
        <ChevronRight className="-mr-1 h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      </button>
      <Bars bars={bars} height={48} className="mt-2" range={values.length > 1 ? f.range(fixed(t, Math.min(...values)), fixed(t, Math.max(...values))) : undefined} summary={f.summary(form.points.length, fixed(t, Math.min(...values)), fixed(t, Math.max(...values)), trend)} />
    </section>
  )
}
