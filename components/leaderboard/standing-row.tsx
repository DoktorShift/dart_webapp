"use client"

import { Avatar } from "@/components/ui/avatar"
import { Chip } from "@/components/ui/chip"
import { useT } from "@/components/i18n-provider"
import { formatNumber, formatPercent, type Messages } from "@/lib/i18n"
import type { Standing, StandingsSort } from "@/lib/leaderboard"
import { cn } from "@/lib/utils"

// One row of the Rangliste, as a list on iOS reads: the rank, the picture, the name with what
// is worth knowing about the row (you, imported results), games and wins in one line, and on
// the right the figure the list is ordered by, large, with a second one small. The first three
// ranks are coloured gold, silver and bronze; the number says it too.
// Light values pass 3:1 on the card; the brighter ones are for dark mode.
export const RANK_COLOURS: Record<number, string> = { 1: "text-[#9a7b14] dark:text-[#c9a227]", 2: "text-[#6e6e73] dark:text-[#8e8e93]", 3: "text-[#9a5a1f] dark:text-[#b5702d]" }

export const roundedAverage = (t: Messages, average: number) => formatNumber(t, Math.round(average * 10) / 10)

function figures(t: Messages, s: Standing, sortBy: StandingsSort, showAverage: boolean) {
  const rate = formatPercent(t, s.winRate)
  const average = s.average === null ? null : `${t.leaderboard.averageShort} ${roundedAverage(t, s.average)}`
  if (sortBy === "average") return { primary: s.average === null ? null : roundedAverage(t, s.average), secondary: rate }
  if (sortBy === "wins") return { primary: String(s.wins), secondary: showAverage ? average : rate }
  return { primary: rate, secondary: showAverage ? average : null }
}

export function StandingRow({
  standing,
  sortBy,
  showAverage,
  you,
  picture,
  hint,
  onClick,
}: {
  standing: Standing
  sortBy: StandingsSort
  // Whether the X01 average has a place in this list (every type or X01 chosen).
  showAverage: boolean
  you: boolean
  picture?: string | null
  // A second line under the name when two rows share it ("Mit Profil", "Gast auf diesem Gerät").
  hint?: string | null
  onClick?: () => void
}) {
  const t = useT()
  const { primary, secondary } = figures(t, standing, sortBy, showAverage)
  const rank = standing.rank
  const body = (
    <>
      <span className={cn("w-7 shrink-0 text-center font-display text-xl font-semibold tabular-nums", rank === null ? "text-muted-foreground/60" : (RANK_COLOURS[rank] ?? "text-muted-foreground"))}>
        <span aria-hidden="true">{rank ?? "–"}</span>
        <span className="sr-only">{rank === null ? t.leaderboard.noRank : t.leaderboard.rank(rank)}</span>
      </span>
      <Avatar seed={standing.playerId ?? standing.key} name={standing.name} src={picture} size={40} />
      <span className="block min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-medium leading-snug [overflow-wrap:anywhere]">{standing.name}</span>
          {you && <Chip tone="accent">{t.leaderboard.you}</Chip>}
          {standing.imported && <Chip>{t.data.importedTag}</Chip>}
          {!standing.imported && standing.includesImported && <Chip>{t.data.withImportedTag}</Chip>}
        </span>
        {hint && <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{hint}</span>}
        <span className="block text-[0.875rem] leading-snug tabular-nums text-muted-foreground">{t.leaderboard.gamesWins(standing.games, standing.wins)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end tabular-nums">
        <span className="font-display text-2xl font-semibold leading-tight">
          <span className="sr-only">{t.leaderboard.figureNames[sortBy === "average" && !showAverage ? "winRate" : sortBy]} </span>
          {primary ?? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">{t.leaderboard.unknown}</span>
            </>
          )}
        </span>
        {secondary && <span className="text-[0.8125rem] leading-snug text-muted-foreground">{secondary}</span>}
      </span>
    </>
  )
  const layout = cn("flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left text-[1.0625rem]", you && "bg-primary/10")
  return (
    <li data-you={you || undefined}>
      {onClick ? (
        <button type="button" onClick={onClick} className={cn(layout, "transition-colors active:bg-secondary/70 focus-visible:bg-secondary/50 focus-visible:outline-none")}>
          {body}
        </button>
      ) : (
        <div className={layout}>{body}</div>
      )}
    </li>
  )
}
