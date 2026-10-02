"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { Dartboard } from "@/components/dartboard"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import { formatNumber, formatPercent, modeName, type Messages } from "@/lib/i18n"
import { computeStandings, useMatchHistory, type MatchRecord, type StandingsFilter } from "@/lib/leaderboard"
import { cn } from "@/lib/utils"

const FILTERS: StandingsFilter[] = ["all", "x01", "cricket", "clock"]

// Podium: second, first, third.
const PODIUM_HEIGHT = ["h-28", "h-20", "h-14"]
const PODIUM_COLUMN = ["col-start-2", "col-start-1", "col-start-3"]
const PODIUM_ORDER = [1, 0, 2]

function formatWhen(iso: string, t: Messages) {
  const date = new Date(iso)
  const now = new Date()
  const time = date.toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit" })
  if (date.toDateString() === now.toDateString()) return t.leaderboard.today(time)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return t.leaderboard.yesterday(time)
  return date.toLocaleDateString(t.intl, { day: "numeric", month: "short", year: "numeric" })
}

function MatchRow({ match }: { match: MatchRecord }) {
  const t = useT()
  const winner = match.players.find((p) => p.won)
  const others = match.players.filter((p) => !p.won).map((p) => p.name)
  const mode = modeName(t, match.modeId, match.modeName)
  return (
    <li className="flex items-start gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium [overflow-wrap:anywhere]">{winner ? t.leaderboard.won(winner.name, mode) : mode}</p>
        {others.length > 0 && <p className="text-[0.875rem] text-muted-foreground [overflow-wrap:anywhere]">{t.leaderboard.against(others.join(", "))}</p>}
      </div>
      <time dateTime={match.finishedAt} className="shrink-0 pt-0.5 text-[0.875rem] tabular-nums text-muted-foreground">
        {formatWhen(match.finishedAt, t)}
      </time>
    </li>
  )
}

// The Leaderboard tab: a list, so it scrolls on its own like any iOS list screen.
export function LeaderboardScreen({ onPlay }: { onPlay: () => void }) {
  const t = useT()
  const { matches, loaded } = useMatchHistory()
  const [filter, setFilter] = useState<StandingsFilter>("all")

  const standings = computeStandings(matches, filter)
  const filteredMatches = filter === "all" ? matches : matches.filter((m) => m.modeType === filter)
  // Only winners stand on the podium, and it takes two to make one: with a single winner the
  // list below says it all.
  const winners = PODIUM_ORDER.map((rank) => ({ rank, player: standings.at(rank) })).filter((p) => p.player && p.player.wins > 0)
  const podium = winners.length >= 2 ? winners : []
  const showAverage = filter === "all" || filter === "x01"

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-2xl px-4 pb-10 pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pt-[max(env(safe-area-inset-top),0.5rem)] lg:pt-10">
        <h1 className="pt-3 font-display text-4xl font-semibold tracking-tight">{t.leaderboard.title}</h1>
        <p className="mt-1 text-[0.875rem] text-muted-foreground">{t.leaderboard.subtitle}</p>

        <div className="mt-5">
          <Segmented
            label={t.leaderboard.filter}
            options={FILTERS.map((f) => ({ value: f, label: t.leaderboard.filters[f] }))}
            value={filter}
            onChange={setFilter}
          />
        </div>

        {loaded && standings.length === 0 && (
          <div className="mt-12 flex flex-col items-center text-center">
            <Dartboard variant="mini" highlight={() => 0.25} className="h-20 w-20" />
            <h2 className="mt-5 text-lg font-semibold">{t.leaderboard.emptyTitle}</h2>
            <p className="mt-1 max-w-xs text-[0.875rem] text-muted-foreground">
              {filter === "all" ? t.leaderboard.emptyAll : t.leaderboard.emptyFilter}
            </p>
            <Button onClick={onPlay} className="mt-6 h-12 rounded-xl px-8 text-base">
              {t.leaderboard.emptyAction}
            </Button>
          </div>
        )}

        {standings.length > 0 && (
          <>
            {podium.length > 0 && (
            <ol aria-label={t.leaderboard.topThree} className="mt-8 grid grid-cols-3 items-end gap-3">
              {podium.map(({ rank, player }) => (
                <li key={player!.key} className={cn("flex min-w-0 flex-col items-center", PODIUM_COLUMN[rank])}>
                  <span className="w-full px-1 text-center font-semibold">
                    <FitText minScale={0.7}>{player!.name}</FitText>
                  </span>
                  <span className="mb-2 text-[0.875rem] tabular-nums text-muted-foreground">
                    {t.leaderboard.wins(player!.wins)}
                  </span>
                  <div
                    className={cn(
                      "flex w-full items-start justify-center rounded-t-2xl border border-b-0 pt-2",
                      PODIUM_HEIGHT[rank],
                      rank === 0 ? "border-primary/50 bg-primary/15" : "border-border bg-secondary/50",
                    )}
                  >
                    <span className={cn("font-display text-4xl font-semibold tabular-nums", rank === 0 ? "text-primary" : "text-muted-foreground")}>
                      {rank + 1}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            )}

            <section aria-labelledby="standings" className="mt-8">
              <h2 id="standings" className="sr-only">
                {t.leaderboard.allPlayers}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-border bg-card/70">
                <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-[0.75rem] font-medium text-muted-foreground">
                  <span className="w-7">#</span>
                  <span className="flex-1">{t.leaderboard.player}</span>
                  {showAverage && <span className="w-14 text-right">{t.leaderboard.avg}</span>}
                  <span className="w-12 text-right">{t.leaderboard.winsHeader}</span>
                </div>
                <ol className="divide-y divide-border">
                  {standings.map((player, index) => (
                    <li key={player.key} className="flex min-h-14 items-center gap-3 px-4 py-2">
                      <span className="w-7 font-display text-xl font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium [overflow-wrap:anywhere]">{player.name}</p>
                        <p className="text-[0.875rem] tabular-nums text-muted-foreground">
                          {t.leaderboard.games(player.matches, formatPercent(t, player.winRate))}
                        </p>
                      </div>
                      {showAverage && (
                        <span className="w-14 text-right tabular-nums text-muted-foreground" title={t.leaderboard.avgNote}>
                          {player.average === null ? "–" : formatNumber(t, player.average)}
                        </span>
                      )}
                      <span className="w-12 text-right font-display text-2xl font-semibold tabular-nums">{player.wins}</span>
                    </li>
                  ))}
                </ol>
              </div>
              {showAverage && <p className="mt-2 px-1 text-[0.75rem] text-muted-foreground">{t.leaderboard.avgNote}</p>}
            </section>

            <section aria-labelledby="recent" className="mt-8">
              <h2 id="recent" className="mb-2 px-1 text-[0.875rem] font-medium text-muted-foreground">
                {t.leaderboard.recent}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/70">
                {filteredMatches.slice(0, 10).map((match) => (
                  <MatchRow key={match.id} match={match} />
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
