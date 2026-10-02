"use client"

import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import {
  checkoutRate,
  first9Average,
  hitRate,
  legsWonInGame,
  marksPerRound,
  playsSets,
  threeDartAverage,
  type MatchState,
  type PlayerStats,
} from "@/lib/game/engine"
import { formatNumber, formatPercent, type Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface StatRow {
  label: string
  // For a column head; rows without one don't fit a column (several numbers in one cell).
  short?: string
  // null while there is nothing to count yet (shown as a dash); several numbers read "1 / 0 / 2".
  value: (st: PlayerStats, i: number) => number | number[] | null
  percent?: boolean
  // Higher is better: the top value in the row is highlighted.
  best?: boolean
}

function wonRows(state: MatchState, t: Messages): StatRow[] {
  const label = t.result.stats
  const short = t.result.short
  const sets: StatRow = { label: label.setsWon, short: short.setsWon, value: (_, i) => state.setsWon[i], best: true }
  const legs: StatRow = { label: label.legsWon, short: short.legsWon, value: (_, i) => legsWonInGame(state, i), best: true }
  return [...(playsSets(state.config) ? [sets] : []), ...(state.config.legsToWin > 1 ? [legs] : [])]
}

// The numbers that tell the story of a game: big on the result screen and in the shared picture.
export function keyRows(state: MatchState, t: Messages): StatRow[] {
  const label = t.result.stats
  const short = t.result.short
  const darts: StatRow = { label: label.darts, short: short.darts, value: (st) => st.darts }
  if (state.config.type === "x01") {
    return [
      { label: label.average, short: short.average, value: threeDartAverage, best: true },
      { label: label.first9, short: short.first9, value: first9Average, best: true },
      { label: label.highestCheckout, short: short.highestCheckout, value: (st) => st.highestCheckout || null, best: true },
      { label: label.checkoutRate, short: short.checkoutRate, value: checkoutRate, percent: true },
      { label: label.maxes, value: (st) => [st.max180s, st.ton40s, st.tons] },
    ]
  }
  if (state.config.type === "cricket") {
    return [
      { label: label.marksPerRound, short: short.marksPerRound, value: marksPerRound, best: true },
      { label: label.points, short: short.points, value: (_, i) => state.points[i] },
      ...wonRows(state, t),
      darts,
    ]
  }
  return [{ label: label.hitRate, short: short.hitRate, value: hitRate, percent: true, best: true }, ...wonRows(state, t), darts]
}

// Everything, for the statistics sheet.
export function allRows(state: MatchState, t: Messages): StatRow[] {
  const label = t.result.stats
  const darts: StatRow = { label: label.darts, value: (st) => st.darts }
  if (state.config.type === "x01") {
    return [
      { label: label.average, value: threeDartAverage, best: true },
      { label: label.first9, value: first9Average, best: true },
      { label: label.highestVisit, value: (st) => st.highestVisit || null, best: true },
      { label: label.highestCheckout, value: (st) => st.highestCheckout || null, best: true },
      { label: label.checkoutRate, value: checkoutRate, percent: true },
      { label: label.tons180, value: (st) => st.max180s, best: true },
      { label: label.tons140, value: (st) => st.ton40s, best: true },
      { label: label.tons100, value: (st) => st.tons, best: true },
      ...wonRows(state, t),
      darts,
    ]
  }
  if (state.config.type === "cricket") {
    return [{ label: label.marksPerRound, value: marksPerRound, best: true }, { label: label.points, value: (_, i) => state.points[i] }, ...wonRows(state, t), darts]
  }
  return [{ label: label.hitRate, value: hitRate, percent: true, best: true }, ...wonRows(state, t), darts]
}

// A row's values for each player, as text, and which players have the best one.
export function rowValues(state: MatchState, row: StatRow, t: Messages) {
  const values = state.stats.map((st, i) => row.value(st, i))
  const numbers = values.filter((v): v is number => typeof v === "number")
  const top = row.best && values.length > 1 && numbers.length > 0 ? Math.max(...numbers) : null
  return values.map((v) => ({
    text: v === null ? "–" : Array.isArray(v) ? v.map((n) => formatNumber(t, n)).join(" / ") : row.percent ? formatPercent(t, v) : formatNumber(t, v),
    best: top !== null && top > 0 && v === top,
    several: Array.isArray(v),
  }))
}

// Stats with a column per player. Labels get the room they need, every player a column wide
// enough for "100 %" (in em, so the widths follow the font size). When that's wider than the
// screen, or the rows are taller, the table scrolls inside its card with names and labels
// pinned: never clipped. "large" is the result screen's version, numbers first.
export function StatsTable({ state, rows, large = false, className }: { state: MatchState; rows: StatRow[]; large?: boolean; className?: string }) {
  const t = useT()
  const players = state.config.players
  const winner = state.winner
  const many = players.length > 3
  const labelWidth = many ? 8 : 9.5
  const columnWidth = many ? 3.85 : 4.2
  const cell = many ? "pl-0.5 pr-1.5" : "pl-1 pr-2"
  const pinned = "sticky bg-card"
  const rowPadding = large ? "py-[clamp(0.125rem,0.9dvh,0.6rem)]" : "py-[clamp(0.2rem,0.9dvh,0.7rem)]"
  const bigValue = many ? "font-display text-[clamp(1.125rem,3dvh,1.75rem)] leading-none" : "font-display text-[clamp(1.25rem,3.8dvh,2.25rem)] leading-none"

  return (
    <div className={cn("min-h-0 overflow-auto overscroll-contain rounded-2xl border border-border bg-card", className)}>
      <table
        className={cn("w-full table-fixed", many ? "text-[0.8125rem]" : "text-[0.9375rem] tablet:text-[1.0625rem]")}
        style={{ minWidth: `${labelWidth + players.length * columnWidth}em` }}
      >
        <thead>
          <tr>
            <th scope="col" className={cn(pinned, "left-0 top-0 z-[2] shadow-[0_1px_0_hsl(var(--border))]")} style={{ width: `${labelWidth}em` }}>
              <span className="sr-only">{t.result.statistic}</span>
            </th>
            {players.map((p, i) => (
              <th
                key={p.id}
                scope="col"
                className={cn(pinned, cell, "top-0 z-[1] py-2 text-right font-semibold shadow-[0_1px_0_hsl(var(--border))]", i === winner && "text-primary")}
              >
                <FitText minScale={0.65}>{p.name}</FitText>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className={cn(pinned, rowPadding, "left-0 z-[1] pl-3 pr-1 text-left font-normal text-muted-foreground")}>
                {row.label}
              </th>
              {rowValues(state, row, t).map((value, i) => (
                <td
                  key={i}
                  className={cn(
                    cell,
                    rowPadding,
                    "whitespace-nowrap text-right font-semibold tabular-nums",
                    large && !value.several && bigValue,
                    value.best && "text-success",
                  )}
                >
                  {value.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The key numbers with a row per player and a column per number, for games with more players
// than fit side by side on a phone. Column heads are short; each reads out its full name.
export function PlayerStatsTable({ state, rows, className }: { state: MatchState; rows: StatRow[]; className?: string }) {
  const t = useT()
  const columns = rows.filter((row) => row.short)
  const values = columns.map((row) => rowValues(state, row, t))
  const head = "sticky top-0 bg-card py-2 font-normal shadow-[0_1px_0_hsl(var(--border))]"

  // Number columns are as wide as their numbers; names get the rest and shrink or wrap inside it.
  return (
    <div className={cn("min-h-0 overflow-auto overscroll-contain rounded-2xl border border-border bg-card", className)}>
      <table className="w-full text-[0.9375rem] tablet:text-[1.0625rem]">
        <thead>
          <tr className="text-[0.8125rem] text-muted-foreground tablet:text-[0.9375rem]">
            <th scope="col" className={cn(head, "w-full max-w-0 pl-3 text-left")}>
              {t.leaderboard.player}
            </th>
            {columns.map((row) => (
              <th key={row.label} scope="col" aria-label={row.label} title={row.label} className={cn(head, "whitespace-nowrap px-1.5 text-right tablet:pl-4 tablet:pr-2")}>
                {row.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {state.config.players.map((player, i) => (
            <tr key={player.id}>
              <th scope="row" className={cn("w-full max-w-0 py-[clamp(0.25rem,1dvh,0.625rem)] pl-3 pr-1 text-left font-semibold", i === state.winner && "text-primary")}>
                <FitText minScale={0.65}>{player.name}</FitText>
              </th>
              {values.map((column, c) => (
                <td
                  key={columns[c].label}
                  className={cn(
                    "whitespace-nowrap px-1.5 text-right font-display text-[clamp(1.125rem,3.2dvh,1.625rem)] font-semibold leading-none tabular-nums tablet:pl-4 tablet:pr-2",
                    column[i].best && "text-success",
                  )}
                >
                  {column[i].text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
