"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Share, Target } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { ChipMenu, ChipMenus } from "@/components/ui/menu"
import { Segmented } from "@/components/ui/segmented"
import { NavBarItems, NavIconButton } from "@/components/nav/nav-bar-items"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS, type ProfileTexts } from "@/lib/i18n/features/profile.screens"
import { Bars, type Bar } from "@/components/profile/bars"
import { fixed, measure, measureDiff, shortDate } from "@/components/profile/format"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { Arrow, Direction } from "@/components/profile/trend"
import { useShareImage } from "@/components/profile/use-share-image"
import type { GameType } from "@/lib/game/types"
import { addMonths, startOfYear } from "@/lib/calendar"
import { formatDate, formatNumber, formatPercent, type Messages } from "@/lib/i18n"
import { bestsOf, type Best } from "@/lib/profile/bests"
import { renderFiguresImage, type FiguresImage } from "@/lib/profile/figures-image"
import { SITE } from "@/lib/site"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { gamePoints, headline, isTraining, summarizePlayer, type GamePoint, type GameScope, type PlayerSummary, type StatsOptions } from "@/lib/storage/stats"

// A player's statistics on this device (PLAN.md "Profilansicht und verständliche Statistiken"):
// one game type at a time, never mixed into one seeming overall figure; a window of games
// rather than a calendar (a break never empties it; E21) or this year; against others or in
// training, never both. Every figure says what it was before, with an arrow and a word, and
// the footer says what it was worked out from. "—" is explained, never 0. On the own profile
// "Teilen" gives the period as a picture, the year as "Mein Dartjahr" (M17).

type Window = "last10" | "last30" | "last100" | "all" | "year"
const WINDOWS: Window[] = ["last10", "last30", "last100", "all", "year"]
const SIZE: Partial<Record<Window, number>> = { last10: 10, last30: 30, last100: 100 }
const MODES: GameType[] = ["x01", "cricket", "clock"]
const SCOPES: Exclude<GameScope, "all">[] = ["versus", "training"]
// The chart shows at most this many games; more would be too thin to read.
const CHART_MAX = 30
const ICON = "/icon/192"

interface Row {
  label: string
  value: string | null
  // The same figure in the period before, written out, and its difference.
  before?: string | null
  diff?: number | null
  higherIsBetter?: boolean
  subtitle?: string
  onClick?: () => void
}

const Dash = ({ tx }: { tx: ProfileTexts }) => (
  <>
    <span aria-hidden="true">—</span>
    <span className="sr-only">{tx.figures.unknownShort}</span>
  </>
)

function finishedAt(p: GamePoint) {
  return Date.parse(p.match.finishedAt) || 0
}

function selectGames(points: GamePoint[], range: Window, now: number): { recent: GamePoint[]; earlier: GamePoint[] } {
  const n = SIZE[range]
  if (n) {
    const earlier = points.slice(n, 2 * n)
    return { recent: points.slice(0, n), earlier: earlier.length === n ? earlier : [] }
  }
  if (range === "year") {
    const from = startOfYear(now)
    const before = startOfYear(addMonths(from, -1))
    return { recent: points.filter((p) => finishedAt(p) >= from), earlier: points.filter((p) => finishedAt(p) >= before && finishedAt(p) < from) }
  }
  return { recent: points, earlier: [] }
}

export function StatsView({ matches, playerKey, aliases, sameAs, share }: { matches: readonly ArchivedMatch[]; playerKey: string; share?: { name: string } } & Pick<StatsOptions, "aliases" | "sameAs">) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const p = tx.stats
  const nav = useNav()
  const [mode, setMode] = useState<GameType>("x01")
  const [range, setRange] = useState<Window>("last30")
  const [scope, setScope] = useState<Exclude<GameScope, "all">>("versus")
  const now = useMemo(() => Date.now(), [])

  const data = useMemo(() => {
    const options: StatsOptions = { type: mode, scope, aliases, sameAs }
    const points = gamePoints(matches, playerKey, options)
    const { recent, earlier } = selectGames(points, range, now)
    const pooled = (part: GamePoint[]) => (part.length > 0 ? summarizePlayer(part.map((g) => g.match), playerKey, options) : null)
    return { recent, summary: pooled(recent), before: pooled(earlier), bests: bestsOf(recent) }
  }, [matches, playerKey, aliases, sameAs, mode, scope, range, now])
  const { recent, summary, before, bests } = data

  const value = headline(summary, mode)
  const beforeValue = headline(before, mode)
  const diff = value !== null && beforeValue !== null ? value - beforeValue : null
  const valueText = value === null ? null : mode === "x01" ? tx.games.average(measure(t, mode, value) ?? "") : `${measure(t, mode, value)} ${tx.training.measure[mode]}`
  const beforeText = range === "all" ? null : p.beforeWindow[range]
  // "in den letzten 30 Spielen" only when there are 30; with fewer the sentence counts them.
  const size = SIZE[range]
  const periodText = size && recent.length < size ? p.allIn(recent.length) : p.inWindow[range]
  const noBeforeText = range === "year" ? p.noPreviousYear : p.noBefore((size ?? 0) * 2)
  const reset = () => {
    setRange("last30")
    setScope("versus")
  }

  const shownPoints = recent.slice(0, CHART_MAX).slice().reverse()
  const values = shownPoints.map((g) => g.value).filter((v): v is number => v !== null)
  const best = values.length > 0 ? Math.max(...values) : null
  const worst = values.length > 1 ? Math.min(...values) : null
  const bars: Bar[] = shownPoints.map((g) => ({
    value: g.value,
    label: shortDate(t, g.match.finishedAt),
    tone: g.value === null ? "empty" : g.value === best ? "best" : g.value === worst ? "faint" : "normal",
    text: measure(t, mode, g.value) ?? undefined,
  }))
  const trend = values.length > 1 ? (values[values.length - 1] > values[0] ? tx.formCard.trends.up : values[values.length - 1] < values[0] ? tx.formCard.trends.down : tx.formCard.trends.flat) : tx.formCard.trends.flat

  const groups = useMemo(() => (summary ? statGroups(t, tx, mode, scope, summary, before, bests, (match) => nav.push(PROFILE_SCREENS.match, { id: match.id })) : []), [t, tx, mode, scope, summary, before, bests, nav])
  const unknown = groups.some((g) => g.rows.some((r) => r.value === null))
  const directionText = diff === null || !beforeText ? null : diff === 0 ? p.same(beforeText) : diff > 0 ? p.better(measureDiff(t, mode, diff), beforeText) : p.worse(measureDiff(t, mode, diff), beforeText)

  // The period as a picture: the headline, its direction, the chart and three figures of it.
  const headlineLabel = mode === "x01" ? tx.card.average : tx.training.measure[mode]
  const shareName = share?.name
  const image = useMemo<FiguresImage | null>(() => {
    if (shareName === undefined || !summary || value === null) return null
    const points = recent.slice(0, CHART_MAX).slice().reverse()
    const shown = points.map((g) => g.value).filter((v): v is number => v !== null)
    const rows = groups.flatMap((g) => g.rows).filter((r): r is Row & { value: string } => r.value !== null && r.label !== headlineLabel).slice(0, 3)
    return {
      brand: SITE.name,
      date: formatDate(t, now, "long"),
      title: range === "year" ? tx.picture.year(new Date(now).getFullYear()) : tx.picture.stats(p.modes[mode]),
      subtitle: range === "year" ? `${shareName} · ${p.modes[mode]} · ${p.basisScopes[scope]}` : `${shareName} · ${p.basisScopes[scope]}, ${periodText}`,
      headline: { value: measure(t, mode, value) ?? "", label: headlineLabel },
      sentence: directionText ?? undefined,
      bars: shown.length > 1 ? { values: points.map((g) => g.value), first: shortDate(t, points[0].match.finishedAt), last: shortDate(t, points[points.length - 1].match.finishedAt), best: measure(t, mode, Math.max(...shown)) ?? "" } : undefined,
      figures: rows.map((r) => ({ label: r.label, value: r.value })),
      footer: tx.picture.footer,
      site: new URL(SITE.url).host,
    }
  }, [shareName, summary, value, recent, groups, headlineLabel, t, tx, p, now, range, mode, scope, periodText, directionText])
  const make = useMemo(() => (image ? () => renderFiguresImage(image, ICON) : null), [image])
  const shareNow = useShareImage(make, tx.picture.fileName, image?.title ?? "")

  return (
    <>
      {image && (
        <NavBarItems>
          <NavIconButton icon={Share} label={tx.picture.action} onClick={shareNow} className="-mr-1" />
        </NavBarItems>
      )}
      <div className="mt-4">
        <Segmented label={p.mode} options={MODES.map((m) => ({ value: m, label: p.modes[m] }))} value={mode} onChange={setMode} />
      </div>
      <ChipMenus className="mt-3">
        <ChipMenu label={p.window} options={WINDOWS.map((w) => ({ value: w, label: p.windows[w] }))} value={range} onChange={setRange} />
        <ChipMenu label={p.scope} options={SCOPES.map((s) => ({ value: s, label: p.scopes[s] }))} value={scope} onChange={setScope} />
      </ChipMenus>

      {summary && valueText ? (
        <>
          <section className="mt-4 rounded-2xl border border-border bg-card px-4 py-3">
            <p className="text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{p.sentence(valueText, periodText)}</p>
            {beforeText && (
              <p className="mt-0.5 text-[0.9375rem] leading-snug">
                {diff === null ? (
                  <span className="text-muted-foreground">{noBeforeText}</span>
                ) : (
                  <Direction diff={diff}>{directionText}</Direction>
                )}
              </p>
            )}
            {values.length > 1 && (
              <Bars
                bars={bars}
                className="mt-3"
                range={tx.formCard.range(measure(t, mode, Math.min(...values)) ?? "", measure(t, mode, Math.max(...values)) ?? "")}
                legend={recent.length > CHART_MAX ? p.chartOf(CHART_MAX) : undefined}
                summary={tx.formCard.summary(shownPoints.length, measure(t, mode, Math.min(...values)) ?? "", measure(t, mode, Math.max(...values)) ?? "", trend)}
              />
            )}
          </section>

          {groups.map((group) => (
            <Group key={group.title} title={group.title} footer={group.footer}>
              {group.rows.map((row) => (
                <ListRow
                  key={row.label}
                  title={row.label}
                  subtitle={row.subtitle ?? (row.before ? p.before(row.before) : undefined)}
                  onClick={row.onClick}
                  value={
                    row.value === null ? <Dash tx={tx} /> : (
                      <>
                        {row.value}
                        {row.diff != null && <Arrow diff={row.diff} higherIsBetter={row.higherIsBetter} />}
                      </>
                    )
                  }
                />
              ))}
            </Group>
          ))}
          <p className="mt-4 px-4 text-[0.8125rem] leading-snug text-muted-foreground">
            {p.basis(summary.games, summary.detailedGames, p.basisScopes[scope])}
            {mode === "x01" && ` ${p.checkoutNote}`}
            {unknown && ` ${p.unknownNote}`}
          </p>
        </>
      ) : (
        <EmptyState
          icon={Target}
          title={p.none}
          primary={{ label: p.emptyAction, onClick: () => nav.openSetup(mode) }}
          secondary={range !== "last30" || scope !== "versus" ? { label: p.showAll, onClick: reset } : undefined}
        />
      )}
    </>
  )
}

interface RowGroup {
  title: string
  rows: Row[]
  footer?: ReactNode
}

const rate = (part: number | null, whole: number | null) => (part !== null && whole !== null && whole > 0 ? part / whole : null)

function compared(label: string, now: number | null, before: number | null, write: (n: number) => string, higherIsBetter = true): Row {
  return { label, value: now === null ? null : write(now), before: before === null ? null : write(before), diff: now !== null && before !== null ? now - before : null, higherIsBetter }
}

// Where a best happened, for its second line: against whom and when, or in training.
function where(t: Messages, tx: ProfileTexts, best: Best<unknown>) {
  const others = best.match.players.filter((_, i) => i !== best.seat).map((pl) => pl.name.trim())
  const date = shortDate(t, best.match.finishedAt)
  return isTraining(best.match) ? tx.stats.inTraining(date) : tx.stats.against(others.join(", "), date)
}

function statGroups(t: Messages, tx: ProfileTexts, mode: GameType, scope: GameScope, s: PlayerSummary, b: PlayerSummary | null, bests: ReturnType<typeof bestsOf>, openMatch: (match: ArchivedMatch) => void): RowGroup[] {
  const p = tx.stats
  const label = t.result.stats
  const pct = (n: number) => formatPercent(t, n)
  const results: Row[] =
    scope === "versus" ?
      [
        compared(p.wins, s.winRate, b?.winRate ?? null, pct),
        { label: p.games, value: formatNumber(t, s.games), subtitle: p.won(s.wins) },
        compared(p.legs, rate(s.legsWon, s.legsPlayed), rate(b?.legsWon ?? null, b?.legsPlayed ?? null), pct),
      ]
    : [
        { label: p.games, value: formatNumber(t, s.games) },
        { label: p.legs, value: s.legsPlayed === null ? null : formatNumber(t, s.legsPlayed) },
      ]
  const groups: RowGroup[] = [{ title: p.results, rows: results }]
  if (mode === "x01") {
    const x = s.x01
    const y = b?.x01 ?? null
    groups.push({
      title: p.scoring,
      rows: [
        compared(tx.card.average, x?.average ?? null, y?.average ?? null, (n) => fixed(t, n)),
        compared(p.first9, x?.first9 ?? null, y?.first9 ?? null, (n) => fixed(t, n)),
        compared(tx.card.checkout, x?.checkoutRate ?? null, y?.checkoutRate ?? null, pct),
      ],
    })
    groups.push({
      title: p.best,
      rows: [
        { label: p.highestFinish, value: bests.highestFinish ? formatNumber(t, bests.highestFinish.value) : null, subtitle: bests.highestFinish ? where(t, tx, bests.highestFinish) : undefined, onClick: bests.highestFinish ? () => openMatch(bests.highestFinish!.match) : undefined },
        { label: p.bestLeg, value: bests.bestLeg ? p.bestLegValue(bests.bestLeg.value) : null, subtitle: bests.bestLeg ? where(t, tx, bests.bestLeg) : undefined, onClick: bests.bestLeg ? () => openMatch(bests.bestLeg!.match) : undefined },
        { label: p.tons180, value: bests.tons180 === null ? null : formatNumber(t, bests.tons180) },
        { label: p.tons, value: bests.tons100 === null || bests.tons140 === null ? null : `${formatNumber(t, bests.tons100)} · ${formatNumber(t, bests.tons140)}` },
      ],
    })
  } else if (mode === "cricket") {
    groups.push({ title: p.scoring, rows: [compared(label.marksPerRound, s.cricket?.marksPerRound ?? null, b?.cricket?.marksPerRound ?? null, (n) => fixed(t, n, 2))] })
  } else {
    groups.push({ title: p.scoring, rows: [compared(label.hitRate, s.clock?.hitRate ?? null, b?.clock?.hitRate ?? null, pct)] })
  }
  if (bests.bestGame && mode !== "x01") {
    groups.push({
      title: p.best,
      rows: [{ label: tx.formCard.best, value: measure(t, mode, bests.bestGame.value), subtitle: where(t, tx, bests.bestGame), onClick: () => openMatch(bests.bestGame!.match) }],
    })
  }
  return groups
}
