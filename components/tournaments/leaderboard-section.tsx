"use client"

import { Medal, Trophy } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { useClubs } from "@/components/clubs/use-clubs"
import { useTournaments, type Entry } from "@/components/tournaments/use-tournaments"
import { formatDate } from "@/lib/i18n"
import { useSession } from "@/lib/profile/session"
import { SCREENS } from "@/lib/shell/registry"
import type { Placement } from "@/lib/tournaments/types"
import { cn } from "@/lib/utils"

// The tournaments' area of the Rangliste tab (registry "leaderboard.sections"): the balance in
// three numbers, then the profile's placings by year, newest first; a shared place reads "5.–8.".
// Only what happened: no points across tournaments, no ranking of players (decision: no world
// ranking). Each row opens the tournament.

interface Placing {
  entry: Entry
  placement: Placement
  // When it counts: the finishing, else the start, in seconds.
  at: number
}

const PLACE_COLOURS: Record<number, string> = { 1: "text-[#9a7b14] dark:text-[#c9a227]", 2: "text-[#6e6e73] dark:text-[#8e8e93]", 3: "text-[#9a5a1f] dark:text-[#b5702d]" }

function placingsOf(entries: readonly Entry[]): Placing[] {
  const placings: Placing[] = []
  for (const entry of entries) {
    const { state, view, me } = entry.read
    if (!state || !view || !me.participant) continue
    const placement = view.placements.find((p) => p.participant === me.participant!.id)
    if (!placement) continue
    placings.push({ entry, placement, at: state.finished?.at ?? state.settings.starts ?? Math.floor((entry.stored.openedAt ?? 0) / 1000) })
  }
  return placings.sort((a, b) => b.at - a.at)
}

export default function TournamentsLeaderboard() {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const l = tx.leaderboard
  const nav = useNav()
  const session = useSession()
  const { entries, loaded } = useTournaments()
  const clubs = useClubs()
  if (session === undefined || !loaded) return null
  const placings = placingsOf(entries)
  if (placings.length === 0) {
    return <EmptyState icon={Medal} title={t.leaderboard.tournamentsEmptyTitle} description={t.leaderboard.tournamentsEmptyText} primary={{ label: t.leaderboard.tournamentsOpen, onClick: () => nav.selectTab("tournaments") }} />
  }
  const won = placings.filter((p) => p.placement.place === 1).length
  const podium = placings.filter((p) => p.placement.place <= 3).length
  const years = [...new Set(placings.map((p) => new Date(p.at * 1000).getFullYear()))]
  const clubName = (id: string | undefined) => (id ? clubs.views.find((v) => v.id === id)?.info?.name : undefined)
  const figures: [number, string][] = [
    [placings.length, l.tournaments(placings.length)],
    [won, l.won],
    [podium, l.podium(podium)],
  ]
  return (
    <>
      <p className="mt-3 px-1 text-[0.8125rem] leading-snug text-muted-foreground">{l.scope}</p>
      <dl className="mt-3 grid grid-cols-3 rounded-2xl border border-border bg-card px-4 py-3">
        {figures.map(([value, label], i) => (
          <div key={label} className={cn("flex min-w-0 flex-col", i > 0 && "border-l border-border pl-3")}>
            <dt className="order-2 text-[0.8125rem] leading-snug text-muted-foreground">{label}</dt>
            <dd className="order-1 font-display text-3xl font-semibold tabular-nums leading-tight">{value}</dd>
          </div>
        ))}
      </dl>
      {years.map((year) => (
        <Group key={year} title={String(year)}>
          {placings
            .filter((p) => new Date(p.at * 1000).getFullYear() === year)
            .map(({ entry, placement, at }) => {
              const state = entry.read.state!
              const players = state.draw?.order.length ?? Object.keys(state.participants).length
              const details = [clubName(state.club?.id), formatDate(t, at * 1000), l.players(players), state.phase !== "finished" ? l.running : null].filter(Boolean).join(" · ")
              const Icon = placement.place === 1 ? Trophy : placement.place <= 3 ? Medal : null
              return (
                <button
                  key={entry.stored.tournament}
                  type="button"
                  onClick={() => nav.push(SCREENS.tournamentView, { tournament: entry.stored.tournament, name: state.settings.name })}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left text-[1.0625rem] transition-colors active:bg-secondary/70"
                >
                  <span className={cn("w-12 shrink-0 text-center font-display text-xl font-semibold tabular-nums", PLACE_COLOURS[placement.place] ?? "text-muted-foreground")} >
                    <span aria-hidden="true">{l.place(placement.place, placement.placeTo)}</span>
                    <span className="sr-only">{l.placeLabel(placement.place, placement.placeTo)}</span>
                  </span>
                  <span className="block min-w-0 flex-1 wrap-anywhere">
                    <span className="block font-medium leading-snug">{state.settings.name}</span>
                    <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{details}</span>
                  </span>
                  {Icon && <Icon className={cn("h-6 w-6 shrink-0", PLACE_COLOURS[placement.place])} aria-hidden />}
                </button>
              )
            })}
        </Group>
      ))}
    </>
  )
}
