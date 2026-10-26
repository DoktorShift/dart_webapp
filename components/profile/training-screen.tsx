"use client"

import { useMemo, useState } from "react"
import { Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { ChipMenu, ChipMenus } from "@/components/ui/menu"
import { Segmented } from "@/components/ui/segmented"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { Bars, type Bar } from "@/components/profile/bars"
import { fixed, measure, measureDiff, monthName, shortDate } from "@/components/profile/format"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { monthHeadline, trainedMost } from "@/components/profile/training-card"
import { Arrow, Direction } from "@/components/profile/trend"
import { useOwnProfile, type OwnProfile } from "@/components/profile/use-profile"
import type { GameType } from "@/lib/game/types"
import { addDays, startOfWeek, startOfYear } from "@/lib/calendar"
import { formatNumber, formatPercent, formatWhen, modeName } from "@/lib/i18n"
import { trainingBuckets, trainingOf, TRAINING_MIN, type Grain, type TrainingMonth } from "@/lib/profile/training"
import { matchState, type GamePoint } from "@/lib/storage/stats"

// Profil › Training: the games played alone, as growth over time (the owner's "Königsdisziplin",
// 2026-10-26). The chart is the hero: the monthly (or weekly) mean through the year, the best in
// orange, months to come empty, too few trainings marked as such rather than shown as a mean of
// one game. One sentence gives the direction against the month before (Fitness pattern); below
// it this month's count and streak, the bests in training, the last trainings, and the one
// action that adds to all of it. Training never meets the figures against others.
const MODES: GameType[] = ["x01", "clock", "cricket"]
const WEEKS = 26
const RECENT = 5

export default function TrainingScreen() {
  const tx = useAreaT(PROFILE_TEXTS)
  const nav = useNav()
  const own = useOwnProfile()
  if (!own || !own.history.loaded) return null
  if (!own.key) return <EmptyState icon={Target} title={tx.training.none} description={tx.training.noneText} primary={{ label: tx.training.start, onClick: () => nav.openSetup("x01") }} />
  return <TrainingView own={own} playerKey={own.key} />
}

function TrainingView({ own, playerKey }: { own: OwnProfile; playerKey: string }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const r = tx.training
  const nav = useNav()
  const { history, sameAs, player, session } = own
  const matches = history.all
  const aliases = history.aliases
  const now = useMemo(() => Date.now(), [])
  const [mode, setMode] = useState<GameType>(() => trainedMost(matches, playerKey, { aliases, sameAs }))
  const [grain, setGrain] = useState<Grain>("month")
  const training = useMemo(() => trainingOf(matches, playerKey, { type: mode, aliases, sameAs, now }), [matches, playerKey, mode, aliases, sameAs, now])
  const years = useMemo(() => [...new Set(training.points.map((p) => new Date(p.match.finishedAt).getFullYear()))].sort((a, b) => b - a), [training.points])
  const [chosenYear, setYear] = useState<string | null>(null)
  const year = chosenYear && years.includes(Number(chosenYear)) ? Number(chosenYear) : (years[0] ?? new Date(now).getFullYear())
  const buckets = useMemo(() => {
    const options = { type: mode, aliases, sameAs }
    if (grain === "week") return trainingBuckets(training.points, playerKey, options, "week", addDays(startOfWeek(now), -7 * (WEEKS - 1)), now + 1)
    const from = startOfYear(new Date(year, 0, 1).getTime())
    return trainingBuckets(training.points, playerKey, options, "month", from, startOfYear(new Date(year + 1, 0, 1).getTime()))
  }, [training.points, playerKey, mode, aliases, sameAs, grain, year, now])

  const start = () => nav.openSetup(mode, player ? { players: [{ name: player.name, pubkey: session.pubkey }] } : undefined)

  if (training.points.length === 0) {
    return (
      <>
        <div className="mt-4">
          <Segmented label={tx.stats.mode} options={MODES.map((m) => ({ value: m, label: tx.stats.modes[m] }))} value={mode} onChange={setMode} />
        </div>
        <EmptyState icon={Target} title={r.none} description={r.noneText} primary={{ label: r.start, onClick: start }} />
      </>
    )
  }

  const { month, previous, bests } = training
  const thisName = monthName(t, month.start)
  const prevName = monthName(t, previous.start)
  const diff = month.value !== null && previous.value !== null ? month.value - previous.value : null
  const values = buckets.map((b) => b.value).filter((v): v is number => v !== null)
  const best = values.length > 0 ? Math.max(...values) : null
  const bars: Bar[] = buckets.map((b) => ({
    value: b.value,
    label: grain === "month" ? monthName(t, b.start).slice(0, 3) : shortDate(t, new Date(b.start).toISOString()),
    tone: b.value === null ? (b.games > 0 ? "tooFew" : "empty") : b.value === best ? "best" : "normal",
    text: b.value === null ? (b.games > 0 ? r.tooFew : undefined) : (measure(t, mode, b.value) ?? undefined),
  }))
  const bestBucket = buckets.find((b) => b.value === best)
  const legsOf = (p: GamePoint) => matchState(p.match)?.legResults.length ?? 0
  const minutesOf = (p: GamePoint) => {
    const ms = (Date.parse(p.match.finishedAt) || 0) - (p.match.startedAt ? Date.parse(p.match.startedAt) || 0 : 0)
    return ms > 0 && ms < 6 * 3_600_000 ? Math.round(ms / 60_000) : null
  }

  return (
    <>
      <div className="mt-4">
        <Segmented label={tx.stats.mode} options={MODES.map((m) => ({ value: m, label: tx.stats.modes[m] }))} value={mode} onChange={setMode} />
      </div>
      <ChipMenus className="mt-3">
        <ChipMenu label={r.grain} options={(["month", "week"] as const).map((g) => ({ value: g, label: r.grains[g] }))} value={grain} onChange={setGrain} />
        {grain === "month" && years.length > 1 && <ChipMenu label={r.year} options={years.map((y) => ({ value: String(y), label: String(y) }))} value={String(year)} onChange={setYear} />}
      </ChipMenus>

      <section className="mt-4 rounded-2xl border border-border bg-card px-4 py-3">
        {month.value !== null ? (
          <>
            <p className="text-[0.8125rem] font-medium text-muted-foreground">{r.month(r.measure[mode], thisName)}</p>
            <p className="mt-1 font-display text-5xl font-semibold tabular-nums leading-none">{measure(t, mode, month.value)}</p>
          </>
        ) : (
          <p className="text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{monthHeadline(t, r, training)}</p>
        )}
        <p className="mt-1.5 text-[0.9375rem] leading-snug">
          {diff !== null ? (
            <Direction diff={diff}>{diff === 0 ? r.same(prevName) : diff > 0 ? r.better(measureDiff(t, mode, diff), prevName) : r.worse(measureDiff(t, mode, diff), prevName)}</Direction>
          ) : month.value !== null ? (
            <span className="text-muted-foreground">{r.noPrevious(prevName)}</span>
          ) : (
            <span className="text-muted-foreground">{r.tooFewThisMonth(TRAINING_MIN)}</span>
          )}
        </p>
        {values.length > 0 ? (
          <>
            <p className="mt-4 text-[0.8125rem] text-muted-foreground">{r.chart(r.measure[mode], r.grainMeans[grain])}</p>
            <Bars
              bars={bars}
              height={112}
              className="mt-2"
              legend={buckets.some((b) => b.value === null && b.games > 0) ? r.legend(TRAINING_MIN) : undefined}
              summary={values.length > 0 ? r.summary(values.length, measure(t, mode, Math.min(...values)) ?? "", measure(t, mode, Math.max(...values)) ?? "", bestBucket ? (grain === "month" ? monthName(t, bestBucket.start) : shortDate(t, new Date(bestBucket.start).toISOString())) : "") : r.tooFewThisMonth(TRAINING_MIN)}
            />
          </>
        ) : (
          <p className="mt-3 text-[0.9375rem] leading-snug text-muted-foreground">{r.chartFrom(TRAINING_MIN)}</p>
        )}
      </section>

      <Group title={r.thisMonth}>
        <ListRow title={r.trainings} value={formatNumber(t, month.games)} subtitle={month.games > 0 ? [r.days(month.days), training.streak > 0 ? r.streak(training.streak) : null].filter(Boolean).join(" · ") : undefined} />
        <MonthRows mode={mode} month={gated(month)} previous={gated(previous)} prevName={prevName} />
      </Group>

      <Group title={r.bests}>
        <ListRow title={r.bestGame} value={bests.bestGame ? measure(t, mode, bests.bestGame.value) : undefined} subtitle={bests.bestGame ? shortDate(t, bests.bestGame.match.finishedAt) : undefined} onClick={bests.bestGame ? () => nav.push(PROFILE_SCREENS.match, { id: bests.bestGame!.match.id }) : undefined} />
        {mode === "x01" && (
          <>
            <ListRow title={r.bestLeg} value={bests.bestLeg ? tx.stats.bestLegValue(bests.bestLeg.value) : undefined} subtitle={bests.bestLeg ? shortDate(t, bests.bestLeg.match.finishedAt) : undefined} onClick={bests.bestLeg ? () => nav.push(PROFILE_SCREENS.match, { id: bests.bestLeg!.match.id }) : undefined} />
            <ListRow title={r.highestFinish} value={bests.highestFinish ? formatNumber(t, bests.highestFinish.value) : undefined} subtitle={bests.highestFinish ? shortDate(t, bests.highestFinish.match.finishedAt) : undefined} onClick={bests.highestFinish ? () => nav.push(PROFILE_SCREENS.match, { id: bests.highestFinish!.match.id }) : undefined} />
          </>
        )}
      </Group>

      <Group title={r.recent}>
        {training.points.slice(0, RECENT).map((p) => {
          const minutes = minutesOf(p)
          return (
            <ListRow
              key={p.match.id}
              title={legsOf(p) > 0 ? `${modeName(t, p.match.modeId, p.match.modeName)} · ${r.legs(legsOf(p))}` : modeName(t, p.match.modeId, p.match.modeName)}
              subtitle={[formatWhen(p.match.finishedAt, t), minutes === null ? null : r.minutes(minutes)].filter(Boolean).join(" · ")}
              value={p.value === null ? undefined : mode === "x01" ? tx.games.average(fixed(t, p.value)) : measure(t, mode, p.value)}
              onClick={() => nav.push(PROFILE_SCREENS.match, { id: p.match.id })}
            />
          )
        })}
      </Group>

      <Button onClick={start} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        {r.start}
      </Button>
      <p className="mt-3 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{r.rule}</p>
    </>
  )
}

// A month's figures count only from TRAINING_MIN trainings, like its headline value.
const gated = (m: TrainingMonth): TrainingMonth => (m.games >= TRAINING_MIN ? m : { ...m, summary: null })

// This month's figures beside the count: in X01 the checkout rate and the darts per leg, in the
// other types the headline figure, each with the month before.
function MonthRows({ mode, month, previous, prevName }: { mode: GameType; month: TrainingMonth; previous: TrainingMonth; prevName: string }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const r = tx.training
  const row = (label: string, now: number | null, before: number | null, write: (n: number) => string, higherIsBetter = true) => (
    <ListRow
      title={label}
      value={
        now === null ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{tx.figures.unknownShort}</span>
          </>
        ) : (
          <>
            {write(now)}
            {before !== null && <Arrow diff={now - before} higherIsBetter={higherIsBetter} />}
          </>
        )
      }
      subtitle={before === null ? undefined : r.previous(prevName, write(before))}
    />
  )
  if (mode === "x01") {
    const x = month.summary?.x01 ?? null
    const y = previous.summary?.x01 ?? null
    const dartsPerLeg = (s: TrainingMonth) => {
      const f = s.summary?.x01
      return f && s.summary && s.summary.legsPlayed && f.detailedGames === f.games ? f.darts / s.summary.legsPlayed : null
    }
    return (
      <>
        {row(r.checkout, x?.checkoutRate ?? null, y?.checkoutRate ?? null, (n) => formatPercent(t, n))}
        {row(r.dartsPerLeg, dartsPerLeg(month), dartsPerLeg(previous), (n) => fixed(t, n), false)}
      </>
    )
  }
  if (mode === "cricket") return row(r.measure.cricket, month.summary?.cricket?.marksPerRound ?? null, previous.summary?.cricket?.marksPerRound ?? null, (n) => fixed(t, n, 2))
  return row(r.measure.clock, month.summary?.clock?.hitRate ?? null, previous.summary?.clock?.hitRate ?? null, (n) => formatPercent(t, n))
}
