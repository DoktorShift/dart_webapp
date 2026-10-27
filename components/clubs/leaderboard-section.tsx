"use client"

import { ChevronRight, Users } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty-state"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { useClubs } from "@/components/clubs/use-clubs"
import { useProfileNames } from "@/components/profile/use-profile-names"
import type { ClubView } from "@/lib/clubs/club"
import { currentSeason, seasonTable, type SeasonTable, type Standing } from "@/lib/clubs/table"
import { formatClock } from "@/lib/i18n"
import { nowSeconds } from "@/lib/nostr/time"
import { useSession } from "@/lib/profile/session"
import { cn } from "@/lib/utils"

// The clubs' area of the Rangliste tab (registry "leaderboard.sections"): one card per club
// the player is a member of, with the running season's first three and the player's own row,
// points large; the chip says at once where the player stands. A table that can't be read yet
// says so instead of showing empty rows (HIG: loading). "Ganze Tabelle" opens the club's table.

const TOP = 3
const RANK_COLOURS: Record<number, string> = { 1: "text-[#9a7b14] dark:text-[#c9a227]", 2: "text-[#6e6e73] dark:text-[#8e8e93]", 3: "text-[#9a5a1f] dark:text-[#b5702d]" }

export default function ClubsLeaderboard() {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const session = useSession()
  const { views, loaded } = useClubs()
  if (session === undefined || !loaded) return null
  const mine = views.filter((v) => v.me.status === "member")
  if (mine.length === 0) {
    return <EmptyState icon={Users} title={t.leaderboard.clubsEmptyTitle} description={t.leaderboard.clubsEmptyText} primary={{ label: t.leaderboard.clubsOpen, onClick: () => nav.selectTab("clubs") }} />
  }
  return (
    <>
      <p className="mt-3 px-1 text-[0.8125rem] leading-snug text-muted-foreground">{tx.leaderboard.scope}</p>
      <div className="mt-3 flex flex-col gap-3">
        {mine.map((view) => (
          <ClubTableCard key={view.id} view={view} />
        ))}
      </div>
    </>
  )
}

function ClubTableCard({ view }: { view: ClubView }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const l = tx.leaderboard
  const nav = useNav()
  const state = view.state
  const season = state ? currentSeason(state, nowSeconds()) : null
  const table = state && season ? seasonTable(season, view.games, state.results[season.id]) : null
  const me = view.me.pubkey
  const rows = table ? [...table.ranked, ...table.unranked] : []
  const names = useProfileNames(rows.map((r) => r.pubkey))
  const mineRow = me ? rows.find((r) => r.pubkey === me) : undefined
  const shown = table ? table.ranked.slice(0, TOP) : []
  if (mineRow && !shown.includes(mineRow)) shown.push(mineRow)
  const name = view.info?.name ?? tx.unnamed
  const openTable = () => nav.push(CLUB_SCREENS.table, { club: view.id, name })

  const standing = !table ? null : !mineRow ? l.youNoGame : mineRow.rank === null ? l.youUnranked(table.rules.minGames) : l.you(mineRow.rank)
  const line = !state ? (view.problem ? l.sealed : l.loading) : !season || !table ? l.noSeason : [l.season(season.name, rows.length), view.loadedAt ? l.asOf(formatClock(t, view.loadedAt)) : null].filter(Boolean).join(" · ")

  return (
    <section aria-label={name} className="overflow-hidden rounded-2xl border border-border bg-card">
      <button type="button" onClick={openTable} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-secondary/70">
        <Avatar seed={view.id} name={name} src={view.info?.picture} size={40} />
        <span className="min-w-0 flex-1 wrap-anywhere">
          <span className="block text-[1.0625rem] font-semibold leading-snug">{name}</span>
          <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{line}</span>
        </span>
        {standing && <Chip tone={mineRow?.rank !== null && mineRow ? "accent" : "neutral"}>{standing}</Chip>}
      </button>
      {table && (
        <ol className="divide-y divide-border border-t border-border">
          {shown.map((row) => (
            <TableRow key={row.pubkey} row={row} you={row.pubkey === me} name={names(row.pubkey).name ?? row.alias} picture={names(row.pubkey).picture} table={table} onClick={openTable} />
          ))}
          {shown.length === 0 && <li className="px-4 py-3 text-[0.9375rem] text-muted-foreground">{l.noGames}</li>}
        </ol>
      )}
      {table && (
        <button type="button" onClick={openTable} className="flex min-h-11 w-full items-center justify-between border-t border-border px-4 py-2 text-left text-[0.9375rem] font-semibold text-primary transition-colors active:bg-secondary/70">
          {l.fullTable}
          <ChevronRight className="-mr-1 h-5 w-5 shrink-0" aria-hidden="true" />
        </button>
      )}
    </section>
  )
}

function TableRow({ row, you, name, picture, table, onClick }: { row: Standing; you: boolean; name: string; picture: string | null; table: SeasonTable; onClick: () => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const l = tx.leaderboard
  return (
    <li>
      <button type="button" onClick={onClick} className={cn("flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left text-[1.0625rem] transition-colors active:bg-secondary/70", you && "bg-primary/10")}>
        <span className={cn("w-7 shrink-0 text-center font-display text-xl font-semibold tabular-nums", row.rank === null ? "text-muted-foreground/60" : (RANK_COLOURS[row.rank] ?? "text-muted-foreground"))}>
          <span aria-hidden="true">{row.rank ?? "–"}</span>
          <span className="sr-only">{row.rank === null ? t.leaderboard.noRank : t.leaderboard.rank(row.rank)}</span>
        </span>
        <Avatar seed={row.pubkey} name={name} src={picture} size={40} />
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-medium leading-snug wrap-anywhere">{name}</span>
            {you && <Chip tone="accent">{tx.you}</Chip>}
          </span>
          <span className="block text-[0.875rem] leading-snug tabular-nums text-muted-foreground">
            {l.gamesWins(row.games, row.wins)}
            {row.rank === null && ` · ${tx.table.unrankedHint(table.rules.minGames)}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end tabular-nums">
          <span className="font-display text-2xl font-semibold leading-tight">{row.points}</span>
          <span className="text-[0.8125rem] leading-snug text-muted-foreground">{l.points}</span>
        </span>
      </button>
    </li>
  )
}
