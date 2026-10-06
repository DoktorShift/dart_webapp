"use client"

import { useMemo, useState } from "react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { useT } from "@/components/i18n-provider"
import type { GameType } from "@/lib/game/types"
import { formatNumber, formatPercent, type Messages } from "@/lib/i18n"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { summarizePlayer, type PlayerSummary, type StatsOptions } from "@/lib/storage/stats"

// A player's statistics on this device (PLAN.md "Profilansicht und verständliche Statistiken"):
// one game type at a time, never mixed into one seeming overall figure, for a chosen period,
// always with the games they come from. What the data can't tell shows "—" and is explained.

type Period = "all" | "year" | "month"
const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = { year: 365, month: 30 }
const MODES: GameType[] = ["x01", "cricket", "clock"]

interface Row {
  label: string
  value: string | null
}

const one = (t: Messages, n: number | null, digits = 1) => (n === null ? null : formatNumber(t, Math.round(n * 10 ** digits) / 10 ** digits))
const percent = (t: Messages, n: number | null) => (n === null ? null : formatPercent(t, n))
const count = (t: Messages, n: number | null) => (n === null ? null : formatNumber(t, n))

function resultRows(t: Messages, s: PlayerSummary): Row[] {
  const p = t.profile.stats
  return [
    { label: t.profile.figures.games, value: count(t, s.games) },
    { label: t.profile.figures.won, value: s.versus > 0 ? p.ofTotal(s.wins, s.versus) : null },
    { label: p.winRate, value: percent(t, s.winRate) },
    { label: p.legsWon, value: s.legsWon === null || s.legsPlayed === null ? null : p.ofTotal(s.legsWon, s.legsPlayed) },
  ]
}

function groups(t: Messages, s: PlayerSummary): { title: string; rows: Row[]; footer?: string }[] {
  const label = t.result.stats
  const p = t.profile.stats
  if (s.x01) {
    const x = s.x01
    return [
      { title: p.results, rows: resultRows(t, s) },
      {
        title: p.scoring,
        rows: [
          { label: t.profile.figures.average, value: one(t, x.average) },
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
  if (s.cricket) return [{ title: p.results, rows: resultRows(t, s) }, { title: p.scoring, rows: [{ label: label.marksPerRound, value: one(t, s.cricket.marksPerRound, 2) }] }]
  return [{ title: p.results, rows: resultRows(t, s) }, { title: p.scoring, rows: [{ label: label.hitRate, value: percent(t, s.clock?.hitRate ?? null) }] }]
}

export function StatsView({ matches, playerKey, aliases, sameAs }: { matches: ArchivedMatch[]; playerKey: string } & Pick<StatsOptions, "aliases" | "sameAs">) {
  const t = useT()
  const p = t.profile.stats
  const [mode, setMode] = useState<GameType>("x01")
  const [period, setPeriod] = useState<Period>("all")
  const summary = useMemo(() => {
    const from = period === "all" ? undefined : new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString()
    return summarizePlayer(matches, playerKey, { aliases, sameAs, type: mode, from })
  }, [matches, playerKey, aliases, sameAs, mode, period])

  const shown = summary ? groups(t, summary) : []
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
                        <span className="sr-only">{t.profile.figures.unknownShort}</span>
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
