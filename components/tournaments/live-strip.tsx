"use client"

import { Chip, Chips } from "@/components/ui/chip"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { boardName, type Names } from "@/components/tournaments/common"
import { useLiveStanding } from "@/components/tournaments/use-live-matches"
import type { MatchView } from "@/lib/tournaments/engine"
import type { TournamentRead } from "@/lib/tournaments/read"
import { cn } from "@/lib/utils"

const MAX_ROWS = 3

// What is on the boards right now, at the top of a running tournament (PLAN.md M15, after the
// pattern of Live Activities): board, pairing and the legs as big digits, one row per match,
// live ones first. A match that is called but not started pulses once a second where motion is
// allowed; nothing else moves. The reader's own called match has its own card above this.
export function LiveStrip({ read, names, className }: { read: TournamentRead; names: Names; className?: string }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const matches = (read.view?.matches ?? [])
    .filter((m) => (m.state === "live" || m.state === "ready") && !m.affected)
    .sort((a, b) => (a.state === b.state ? a.number - b.number : a.state === "live" ? -1 : 1))
    .slice(0, MAX_ROWS)
  if (matches.length === 0) return null
  return (
    <section aria-label={tx.tournament.liveStrip} className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}>
      <h2 className="px-4 pt-3 text-[0.8125rem] text-muted-foreground">{tx.tournament.liveStrip}</h2>
      <ul className="divide-y divide-border">
        {matches.map((m) => (
          <LiveRow key={m.id} read={read} m={m} names={names} />
        ))}
      </ul>
    </section>
  )
}

function LiveRow({ read, m, names }: { read: TournamentRead; m: MatchView; names: Names }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const live = useLiveStanding(m.state === "live" ? (read.live[m.id]?.match ?? null) : null, read.relays)
  const [a, b] = m.slots
  const legs = live ? `${live.standing.legs[0]}:${live.standing.legs[1]}` : m.state === "live" ? "–" : null
  const board = boardName(read.state, m.board)
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      <span className="min-w-0 flex-1">
        <Chips>
          {board && <Chip tone="neutral">{board}</Chip>}
          {m.state === "ready" ? (
            <Chip tone="warning">
              <span className="relative mr-1 inline-flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
              </span>
              {tx.tournament.calledShort}
            </Chip>
          ) : (
            <Chip tone="live">{tx.tournament.live}</Chip>
          )}
        </Chips>
        <span className="mt-1 block text-[1.0625rem] leading-snug wrap-anywhere">
          {names.nameOf(a.participant)} <span className="text-muted-foreground">·</span> {names.nameOf(b.participant)}
        </span>
      </span>
      {legs && <span className={cn("shrink-0 font-display text-[1.75rem] font-semibold tabular-nums leading-none", live?.stale && "opacity-50")}>{legs}</span>}
    </li>
  )
}
