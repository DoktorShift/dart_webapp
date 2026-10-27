"use client"

import { useMemo, useState } from "react"
import { CircleCheck, Share, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { ChipMenu, ChipMenus } from "@/components/ui/menu"
import { Segmented } from "@/components/ui/segmented"
import { NavBarItems, NavIconButton } from "@/components/nav/nav-bar-items"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { Bars, type Bar, type Goal } from "@/components/profile/bars"
import { fixed, measure, measureDiff, monthName, shortDate } from "@/components/profile/format"
import { GoalSheet } from "@/components/profile/goal-sheet"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { monthHeadline, trainedMost } from "@/components/profile/training-card"
import { Arrow, Direction } from "@/components/profile/trend"
import { ShareImageSheet } from "@/components/profile/share-image-sheet"
import { useTrainingGoals } from "@/components/profile/use-goals"
import { useOwnProfile, type OwnProfile } from "@/components/profile/use-profile"
import type { GameType } from "@/lib/game/types"
import { addDays, startOfWeek, startOfYear } from "@/lib/calendar"
import { formatDate, formatNumber, formatPercent, formatWhen, modeName } from "@/lib/i18n"
import { renderFiguresImage, type FiguresImage } from "@/lib/profile/figures-image"
import { reachedCount } from "@/lib/profile/goal"
import { trainingBuckets, trainingOf, TRAINING_MIN, type Grain, type TrainingMonth } from "@/lib/profile/training"
import { SITE } from "@/lib/site"
import { matchState, type GamePoint } from "@/lib/storage/stats"

// Profil › Training: the games played alone, as growth over time (the owner's "Königsdisziplin",
// 2026-10-26). The chart is the hero: the monthly (or weekly) mean through the year, the best in
// orange, months to come empty, too few trainings marked as such rather than shown as a mean of
// one game, and the player's own goal as a line through it (M18). One sentence gives the
// direction against the month before (Fitness pattern); below it this month's count and streak,
// the goal, the bests in training, the last trainings, and the one action that adds to all of
// it. "Teilen" in the bar gives the month as a picture (M17). Training never meets the figures
// against others.
const MODES: GameType[] = ["x01", "clock", "cricket"]
const WEEKS = 26
const RECENT = 5
const ICON = "/icon/192"

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
  const goals = useTrainingGoals()
  const goal = goals[mode] ?? null
  const [goalSheet, setGoalSheet] = useState({ open: false, round: 0 })

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
  const bestLabel = bestBucket ? (grain === "month" ? monthName(t, bestBucket.start) : shortDate(t, new Date(bestBucket.start).toISOString())) : ""
  const goalLine: Goal | undefined = goal === null ? undefined : { value: goal, label: r.goalValue(measure(t, mode, goal) ?? ""), text: measure(t, mode, goal) ?? "" }
  // Enough trainings but no figure: totals from a file know no hit rate or marks.
  const noFigure = month.value === null && month.games >= TRAINING_MIN
  const directionText = diff !== null ? (diff === 0 ? r.same(prevName) : diff > 0 ? r.better(measureDiff(t, mode, diff), prevName) : r.worse(measureDiff(t, mode, diff), prevName)) : month.value !== null ? r.noPrevious(prevName) : noFigure ? r.noFigure(r.measure[mode]) : r.tooFewThisMonth(TRAINING_MIN)
  const reached = goal !== null && month.value !== null && month.value >= goal
  const goalText = goal !== null && month.value !== null ? (reached ? r.goalReached : r.goalLeft(gap(t, r, mode, goal - month.value), measure(t, mode, goal) ?? "")) : null
  const summary = values.length > 0 ? [r.summary(values.length, measure(t, mode, Math.min(...values)) ?? "", measure(t, mode, Math.max(...values)) ?? "", bestLabel), goal !== null ? r.goalReachedIn(reachedCount(values, goal), values.length, r.periods[grain]) : null].filter(Boolean).join(". ") : noFigure ? r.noFigure(r.measure[mode]) : r.tooFewThisMonth(TRAINING_MIN)

  // The view as a picture: the month, the chosen year or the last weeks, with the chart as
  // shown; nothing when there is no figure to show. The trend is its sentence, the goal its line.
  const name = own.name ?? player?.name ?? ""
  const thisYear = new Date(now).getFullYear()
  const [shareOpen, setShareOpen] = useState(false)
  const image = useMemo<FiguresImage | null>(() => {
    if (values.length === 0) return null
    const lastWithValue = [...buckets].reverse().find((b) => b.value !== null)
    const headline =
      grain === "month" && year === thisYear && month.value !== null ? { value: measure(t, mode, month.value) ?? "", label: r.month(r.measure[mode], thisName) }
      : grain === "week" && lastWithValue ? { value: measure(t, mode, lastWithValue.value) ?? "", label: r.chart(r.measure[mode], r.grainMeans.week) }
      : { value: measure(t, mode, best ?? 0) ?? "", label: `${r.measure[mode]} · ${bestLabel}` }
    return {
      brand: SITE.name,
      date: formatDate(t, now, "long"),
      title: grain === "week" ? tx.picture.trainingWeeks(WEEKS) : year !== thisYear ? tx.picture.trainingYear(year) : tx.picture.training(thisName),
      subtitle: [name, r.chart(r.measure[mode], r.grainMeans[grain])].filter(Boolean).join(" · "),
      headline,
      sentence: grain === "month" && year === thisYear ? directionText : undefined,
      bars: { values: buckets.map((b) => b.value), first: bars[0]?.label ?? "", last: bars[bars.length - 1]?.label ?? "", best: measure(t, mode, best ?? 0) ?? "", goal: goalLine },
      figures: [
        { label: `${r.trainings} · ${thisName}`, value: formatNumber(t, month.games) },
        { label: r.total, value: formatNumber(t, training.points.length) },
        ...(bests.bestGame ? [{ label: r.bestGame, value: measure(t, mode, bests.bestGame.value) ?? "" }] : []),
      ],
      footer: tx.picture.footer,
      site: new URL(SITE.url).host,
    }
    // Everything the picture shows is derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [training, buckets, mode, grain, year, goal, name, t, tx])
  const make = useMemo(() => (image ? () => renderFiguresImage(image, ICON) : null), [image])
  const fileDate = grain === "month" ? `${year}-${String(new Date(now).getMonth() + 1).padStart(2, "0")}` : new Date(now).toISOString().slice(0, 10)

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

  const legsOf = (p: GamePoint) => matchState(p.match)?.legResults.length ?? 0
  const minutesOf = (p: GamePoint) => {
    const ms = (Date.parse(p.match.finishedAt) || 0) - (p.match.startedAt ? Date.parse(p.match.startedAt) || 0 : 0)
    return ms > 0 && ms < 6 * 3_600_000 ? Math.round(ms / 60_000) : null
  }

  return (
    <>
      {image && (
        <NavBarItems>
          <NavIconButton icon={Share} label={tx.picture.shareTraining} onClick={() => setShareOpen(true)} className="-mr-1" />
        </NavBarItems>
      )}
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
          <p className="text-[1.0625rem] font-semibold leading-snug wrap-anywhere">{monthHeadline(t, r, training)}</p>
        )}
        <p className="mt-1.5 text-[0.9375rem] leading-snug">{diff !== null ? <Direction diff={diff}>{directionText}</Direction> : <span className="text-muted-foreground">{directionText}</span>}</p>
        {goalText && (
          <p className={reached ? "mt-0.5 flex items-center gap-1 text-[0.9375rem] leading-snug text-success" : "mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground"}>
            {reached && <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {goalText}
          </p>
        )}
        {values.length > 0 ? (
          <>
            <p className="mt-4 text-[0.8125rem] text-muted-foreground">{r.chart(r.measure[mode], r.grainMeans[grain])}</p>
            <Bars bars={bars} height={112} className="mt-2" goal={goalLine} legend={buckets.some((b) => b.value === null && b.games > 0) ? r.legend(TRAINING_MIN) : undefined} summary={summary} />
          </>
        ) : (
          // No chart yet: the sentence above already says so when the figure is unknown.
          !noFigure && <p className="mt-3 text-[0.9375rem] leading-snug text-muted-foreground">{grain === "week" ? r.chartFromWeek(TRAINING_MIN) : r.chartFrom(TRAINING_MIN)}</p>
        )}
      </section>

      <Group title={r.thisMonth}>
        <ListRow title={r.trainings} value={formatNumber(t, month.games)} subtitle={month.games > 0 ? [r.days(month.days), training.streak > 0 ? r.streak(training.streak) : null].filter(Boolean).join(" · ") : undefined} />
        <MonthRows mode={mode} month={gated(month)} previous={gated(previous)} prevName={prevName} />
      </Group>

      <Group title={r.goal} footer={r.goalFooter}>
        <ListRow title={r.goal} value={goal === null ? r.goalSet : measure(t, mode, goal)} onClick={() => setGoalSheet((s) => ({ open: true, round: s.round + 1 }))} />
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

      <GoalSheet key={`${mode}-${goalSheet.round}`} type={mode} value={goal} current={month.value} open={goalSheet.open} onOpenChange={(open) => setGoalSheet((s) => ({ ...s, open }))} />
      <ShareImageSheet open={shareOpen} onOpenChange={setShareOpen} make={make} fileName={tx.picture.trainingFileName(fileDate)} title={image?.title ?? ""} />
    </>
  )
}

// "9,9 Punkte", "0,50 Treffer", "12 %": the gap to the goal with its unit.
function gap(t: ReturnType<typeof useT>, r: ReturnType<typeof useAreaT<typeof PROFILE_TEXTS.de>>["training"], mode: GameType, diff: number) {
  const d = measureDiff(t, mode, diff)
  return mode === "clock" ? d : `${d} ${r.units[mode]}`
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
