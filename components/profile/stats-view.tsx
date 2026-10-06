"use client"

import { useMemo, useState } from "react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS, type ProfileTexts } from "@/lib/i18n/features/profile.screens"
import type { GameType } from "@/lib/game/types"
import { formatNumber, formatPercent, type Messages } from "@/lib/i18n"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { playerKey as keyOf, summarizePlayer, type PlayerSummary, type StatsOptions } from "@/lib/storage/stats"

// A player's statistics on this device (PLAN.md "Profilansicht und verständliche Statistiken"):
// one game type at a time, never mixed into one seeming overall figure, for a chosen period,
// always with the games they come from. What the data can't tell shows "—" and is explained.

type Period = "all" | "year" | "month"
const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = { year: 365, month: 30 }
const MODES: GameType[] = ["x01", "cricket", "clock"]

// "Verlauf", X01 only: beside the period's average, the average of the newest games (all time)
// or of the same length of time before the period. Below a few games it is "—", never a trend
// read into two results.
const TREND_GAMES = 10
const TREND_MIN = 5

function trendOf(matches: ArchivedMatch[], key: string, options: Pick<StatsOptions, "aliases" | "sameAs">, period: Period): number | null {
  if (period === "all") {
    const mine = matches
      .filter((m) => m.modeType === "x01" && m.players.some((p) => keyOf(m, p, options.aliases, options.sameAs) === key))
      .sort((a, b) => (Date.parse(b.finishedAt) || 0) - (Date.parse(a.finishedAt) || 0))
    if (mine.length < TREND_GAMES + TREND_MIN) return null
    return summarizePlayer(mine.slice(0, TREND_GAMES), key, { ...options, type: "x01" })?.x01?.average ?? null
  }
  const length = PERIOD_DAYS[period] * 86_400_000
  const before = summarizePlayer(matches, key, { ...options, type: "x01", from: new Date(Date.now() - 2 * length).toISOString(), to: new Date(Date.now() - length).toISOString() })
  return before && before.games >= TREND_MIN ? (before.x01?.average ?? null) : null
}

interface Row {
  label: string
  value: string | null
}

const one = (t: Messages, n: number | null, digits = 1) => (n === null ? null : formatNumber(t, Math.round(n * 10 ** digits) / 10 ** digits))
const percent = (t: Messages, n: number | null) => (n === null ? null : formatPercent(t, n))
const count = (t: Messages, n: number | null) => (n === null ? null : formatNumber(t, n))

function resultRows(t: Messages, tx: ProfileTexts, s: PlayerSummary): Row[] {
  const p = tx.stats
  return [
    { label: tx.figures.games, value: count(t, s.games) },
    { label: tx.figures.won, value: s.versus > 0 ? p.ofTotal(s.wins, s.versus) : null },
    { label: p.winRate, value: percent(t, s.winRate) },
    { label: p.legsWon, value: s.legsWon === null || s.legsPlayed === null ? null : p.ofTotal(s.legsWon, s.legsPlayed) },
  ]
}

function groups(t: Messages, tx: ProfileTexts, s: PlayerSummary): { title: string; rows: Row[]; footer?: string }[] {
  const label = t.result.stats
  const p = tx.stats
  if (s.x01) {
    const x = s.x01
    return [
      { title: p.results, rows: resultRows(t, tx, s) },
      {
        title: p.scoring,
        rows: [
          { label: tx.figures.average, value: one(t, x.average) },
          { label: label.first9, value: one(t, x.first9) },
          { label: label.checkoutRate, value: percent(t, x.checkoutRate) },
        ],
        footer: p.checkoutNote,
      },
      {
        title: p.best,
        rows: [
          { label: label.highestCheckout, value: count(t, x.highestFinish) },
          { label: p.bestLeg, value: x.bestLeg === null ? null : p.bestLegValue(x.bestLeg) },
          { label: label.highestVisit, value: count(t, x.highestVisit) },
          { label: label.tons180, value: count(t, x.visits180) },
          { label: label.tons140, value: count(t, x.visits140) },
          { label: label.tons100, value: count(t, x.visits100) },
        ],
      },
    ]
  }
  if (s.cricket) return [{ title: p.results, rows: resultRows(t, tx, s) }, { title: p.scoring, rows: [{ label: label.marksPerRound, value: one(t, s.cricket.marksPerRound, 2) }] }]
  return [{ title: p.results, rows: resultRows(t, tx, s) }, { title: p.scoring, rows: [{ label: label.hitRate, value: percent(t, s.clock?.hitRate ?? null) }] }]
}

export function StatsView({ matches, playerKey, aliases, sameAs }: { matches: ArchivedMatch[]; playerKey: string } & Pick<StatsOptions, "aliases" | "sameAs">) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const p = tx.stats
  const [mode, setMode] = useState<GameType>("x01")
  const [period, setPeriod] = useState<Period>("all")
  const summary = useMemo(() => {
    const from = period === "all" ? undefined : new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString()
    return summarizePlayer(matches, playerKey, { aliases, sameAs, type: mode, from })
  }, [matches, playerKey, aliases, sameAs, mode, period])
  const trend = useMemo(() => (summary?.x01 ? trendOf(matches, playerKey, { aliases, sameAs }, period) : undefined), [summary, matches, playerKey, aliases, sameAs, period])

  const shown = summary ? groups(t, tx, summary) : []
  if (trend !== undefined) {
    shown.push({
      title: p.trend,
      rows: [{ label: period === "all" ? p.lastGames(TREND_GAMES) : p.beforePeriod[period], value: one(t, trend) }],
      footer: trend === null ? (period === "all" ? p.trendFromGames(TREND_GAMES + TREND_MIN) : p.trendFromBefore(TREND_MIN)) : undefined,
    })
  }
  const unknown = shown.some((g) => g.rows.some((r) => r.value === null))

  return (
    <>
      <div className="mt-4 grid gap-2">
        <Segmented label={p.mode} options={MODES.map((m) => ({ value: m, label: p.modes[m] }))} value={mode} onChange={setMode} />
        <Segmented label={p.period} options={(["all", "year", "month"] as const).map((v) => ({ value: v, label: p.periods[v] }))} value={period} onChange={setPeriod} />
      </div>
      {summary ? (
        <>
          <p className="mt-3 px-4 text-[0.8125rem] text-muted-foreground">
            {p.modes[mode]} · {p.periods[period]} · {p.basis(summary.games, summary.detailedGames)}
          </p>
          {shown.map((group) => (
            <Group key={group.title} title={group.title} footer={group.footer}>
              {group.rows.map((row) => (
                <ListRow
                  key={row.label}
                  title={row.label}
                  value={
                    row.value ?? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{tx.figures.unknownShort}</span>
                      </>
                    )
                  }
                />
              ))}
            </Group>
          ))}
          {unknown && <p className="mt-4 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{p.unknownNote}</p>}
        </>
      ) : (
        <p className="mt-6 px-4 text-[1.0625rem] leading-snug text-muted-foreground">{p.none}</p>
      )}
    </>
  )
}
