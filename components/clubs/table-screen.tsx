"use client"

import { useState } from "react"
import { Info, Trophy } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { SheetBody, SheetButton, formatDate, formatDateTime, gameLabel, sameNames, shortId } from "@/components/clubs/common"
import { DecideSheet, type Decision } from "@/components/clubs/manage-sheets"
import { ScoringText } from "@/components/clubs/scoring"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { useClub } from "@/components/clubs/use-clubs"
import { useNames } from "@/components/clubs/use-names"
import { VerdictSheet } from "@/components/clubs/verdict-sheet"
import { isLeader, isManager } from "@/lib/clubs/club"
import type { ClubGame } from "@/lib/clubs/games"
import { currentSeason, seasonTable, type Standing } from "@/lib/clubs/table"
import { formatNumber } from "@/lib/i18n"
import { nowSeconds } from "@/lib/nostr/time"
import type { ScreenProps } from "@/lib/shell/registry"
import { cn } from "@/lib/utils"

// How many of the club's games the list below the table shows.
const RECENT_GAMES = 10

// "Tabelle" (PLAN.md): rank, name, games and points; the detail columns on wide screens. Your
// own row is marked, unconfirmed results are listed apart as not counted (a leader decides any
// of them from there), and "So wird gewertet" explains the rules. Below it the club's last
// games, each opening its result. Without a season: what a season is for, how to set one up,
// and the games played so far.
export default function TableScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const { view } = useClub(params.club ?? null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [scoringOpen, setScoringOpen] = useState(false)
  const [shown, setShown] = useState<ClubGame | null>(null)
  const [deciding, setDeciding] = useState<Decision | null>(null)
  const state = view?.state
  const now = nowSeconds()
  const seasons = state ? Object.values(state.seasons).sort((a, b) => b.starts - a.starts) : []
  const season = seasons.find((s) => s.id === chosen) ?? (state && currentSeason(state, now)) ?? seasons[0] ?? null
  const table = state && season ? seasonTable(season, view.games, state.results[season.id]) : null
  const rows = table ? [...table.ranked, ...table.unranked] : []
  const names = useNames(rows.map((r) => r.pubkey))
  if (!view || !state) return null
  const manager = isManager(view.me.role) && !state.info.archived
  const leader = isLeader(view.me.role) && !state.info.archived
  const legs = (game: ClubGame) => (game.result ? tx.game.legs(game.result.legs.join(":")) : undefined)
  // The game as the club reads it now (an answer may have arrived since it was opened).
  const shownGame = shown ? (view.games.find((g) => g.match === shown.match) ?? shown) : null
  const recent = (
    <>
      <Group title={tx.game.recent} footer={view.games.length === 0 ? tx.game.noneHint : undefined}>
        {view.games.length === 0 && <ListRow title={tx.game.none} />}
        {view.games.slice(0, RECENT_GAMES).map((game) => (
          <ListRow
            key={game.match}
            title={gameLabel(game)}
            subtitle={game.result ? [formatDateTime(game.result.at, t), game.result.replaces ? tx.game.corrected : null].filter(Boolean).join(" · ") : undefined}
            value={legs(game)}
            onClick={() => setShown(game)}
          />
        ))}
      </Group>
      <VerdictSheet view={view} state={state} game={shownGame} open={shownGame !== null} onOpenChange={(open) => !open && setShown(null)} />
    </>
  )
  if (!season || !table) {
    return (
      <div className="pb-4">
        <EmptyState
          icon={Trophy}
          title={tx.table.noSeason}
          description={manager ? tx.table.noSeasonLeader : tx.table.noSeasonText}
          primary={manager ? { label: tx.table.setup, onClick: () => nav.push(CLUB_SCREENS.season, { club: view.id, name: params.name ?? "" }) } : undefined}
        />
        {recent}
      </div>
    )
  }
  const nameOf = (row: Standing) => names(row.pubkey).name ?? row.alias
  const dup = sameNames(
    rows.map((r) => r.pubkey),
    (p) => names(p).name ?? rows.find((r) => r.pubkey === p)?.alias ?? tx.unnamed,
  )
  const me = view.me.pubkey
  const latest = season.versions[season.versions.length - 1]
  const cell = "px-3 py-2.5 align-top"
  const wide = "hidden sm:table-cell"

  const Name = ({ row }: { row: Standing }) => (
    <span className="[overflow-wrap:anywhere]">
      {nameOf(row)}
      {row.pubkey === me && <span className="ml-1.5 rounded-full bg-primary px-2 py-0.5 text-[0.75rem] font-semibold text-primary-foreground">{tx.you}</span>}
      {dup.has(row.pubkey) && <span className="block text-[0.8125rem] font-normal text-muted-foreground">{tx.id(shortId(row.pubkey))}</span>}
    </span>
  )

  return (
    <div className="pb-4">
      {seasons.length > 1 && (
        <div className="mt-6">
          <Segmented label={tx.club.season} options={seasons.slice(0, 4).map((s) => ({ value: s.id, label: s.name }))} value={season.id} onChange={setChosen} />
        </div>
      )}
      <p className="mt-6 px-4 text-[0.8125rem] text-muted-foreground [overflow-wrap:anywhere]">
        {season.name} · {tx.table.period(formatDate(season.starts, t), season.ends !== undefined ? formatDate(season.ends, t) : null)}
        {season.ended && ` · ${tx.table.ended}`}
      </p>
      <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-[1.0625rem]">
          <thead>
            <tr className="text-[0.8125rem] font-normal text-muted-foreground">
              <th scope="col" className={cn(cell, "text-left font-normal")}>
                {tx.table.rank}
              </th>
              <th scope="col" className={cn(cell, "w-full text-left font-normal")}>
                {tx.table.name}
              </th>
              <th scope="col" className={cn(cell, "text-right font-normal")}>
                {tx.table.games}
              </th>
              <th scope="col" className={cn(cell, "text-right font-normal")}>
                {tx.table.points}
              </th>
              <th scope="col" className={cn(cell, wide, "text-right font-normal")}>
                {tx.table.wins}-{tx.table.draws}-{tx.table.losses}
              </th>
              <th scope="col" className={cn(cell, wide, "text-right font-normal")}>
                {tx.table.legs}
              </th>
              <th scope="col" className={cn(cell, wide, "text-right font-normal")}>
                {tx.table.average}
              </th>
            </tr>
          </thead>
          <tbody>
            {table.ranked.map((row) => (
              <tr key={row.pubkey} className={cn("border-t border-border", row.pubkey === me && "bg-primary/10 font-semibold")}>
                <td className={cn(cell, "tabular-nums")}>{row.rank}</td>
                <td className={cell}>
                  <Name row={row} />
                </td>
                <td className={cn(cell, "text-right tabular-nums")}>{row.games}</td>
                <td className={cn(cell, "text-right tabular-nums")}>{row.points}</td>
                <td className={cn(cell, wide, "text-right tabular-nums")}>
                  {row.wins}-{row.draws}-{row.losses}
                </td>
                <td className={cn(cell, wide, "text-right tabular-nums")}>
                  {row.legsFor}:{row.legsAgainst}
                </td>
                <td className={cn(cell, wide, "text-right tabular-nums")}>{row.average === null ? "—" : formatNumber(t, row.average)}</td>
              </tr>
            ))}
            {table.ranked.length === 0 && (
              <tr className="border-t border-border">
                <td colSpan={7} className="px-4 py-4 text-center text-[0.9375rem] text-muted-foreground">
                  {tx.table.noGames}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 hidden px-4 text-[0.8125rem] text-muted-foreground sm:block">{tx.table.legend}</p>

      {table.unranked.length > 0 && (
        <Group title={tx.table.unranked} footer={tx.table.unrankedHint(table.rules.minGames)}>
          {table.unranked.map((row) => (
            <ListRow key={row.pubkey} title={<Name row={row} />} subtitle={`${row.games} ${tx.table.games} · ${row.points} ${tx.table.points}`} />
          ))}
        </Group>
      )}
      {table.open.length > 0 && (
        <Group title={tx.table.open} footer={leader ? tx.table.openLeader : undefined}>
          {table.open.map(({ game, why }) => (
            <ListRow key={game.match} title={gameLabel(game)} subtitle={tx.table.why[why]} value={legs(game)} onClick={() => (leader && !season.ended ? setDeciding({ game, why }) : setShown(game))} />
          ))}
        </Group>
      )}
      {leader && <DecideSheet view={view} state={state} season={season} decision={deciding} open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)} />}
      <Group>
        <ListRow icon={Info} iconTone="gray" title={tx.table.scoring} onClick={() => setScoringOpen(true)} />
      </Group>
      {recent}

      <Sheet open={scoringOpen} onOpenChange={setScoringOpen} title={tx.table.scoring}>
        <SheetBody>
          <ScoringText rules={table.rules} />
          <p className="mt-4 text-[0.8125rem] leading-snug text-muted-foreground">
            {tx.table.version(latest.version, formatDate(latest.at, t))}
            {latest.reason && ` · ${tx.table.reason(latest.reason)}`}
          </p>
        </SheetBody>
        <SheetButton onClick={() => setScoringOpen(false)}>{t.common.done}</SheetButton>
      </Sheet>
    </div>
  )
}
