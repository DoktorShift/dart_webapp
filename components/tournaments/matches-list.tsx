"use client"

import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { boardName, scoreText, useRoundLabel } from "@/components/tournaments/common"
import { useLiveStanding } from "@/components/tournaments/use-live-matches"
import type { MatchView } from "@/lib/tournaments/engine"
import type { TournamentRead } from "@/lib/tournaments/read"
import { cn } from "@/lib/utils"

export interface Names {
  nameOf: (id: string | null) => string
  hintOf?: (id: string) => string | null
}

// The matches grouped by round, in playing order: the default view on a phone, where a wide
// bracket is no way to find one's opponent and board. One's own matches stand out; a live
// match shows its score; nothing is estimated.
export function MatchesList({ read, names, me, onSelect }: { read: TournamentRead; names: Names; me: string | null; onSelect?: (m: MatchView) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const round = useRoundLabel()
  const view = read.view
  if (!view) return <p className="mt-8 text-center text-[0.9375rem] text-muted-foreground">{tx.tournament.noMatchesText}</p>
  const rounds = new Map<string, MatchView[]>()
  for (const m of view.matches) {
    if (m.state === "void") continue
    const key = round(m)
    rounds.set(key, [...(rounds.get(key) ?? []), m])
  }
  return (
    <>
      {[...rounds.entries()].map(([label, matches]) => (
        <Group key={label} title={label}>
          {matches.map((m) => (
            <MatchRow key={m.id} read={read} m={m} names={names} me={me} onClick={onSelect && (() => onSelect(m))} />
          ))}
        </Group>
      ))}
    </>
  )
}

export function MatchRow({ read, m, names, me, onClick }: { read: TournamentRead; m: MatchView; names: Names; me: string | null; onClick?: () => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const liveMatch = read.live[m.id]?.match ?? null
  const live = useLiveStanding(liveMatch, read.relays)
  const [a, b] = m.slots
  const mine = me !== null && (a.participant === me || b.participant === me)
  const nameOf = (p: string | null, empty: boolean) => (empty ? tx.tournament.bye : names.nameOf(p))
  const value = m.state === "live" && live ? `${live.standing.legs[0]}:${live.standing.legs[1]}` : m.state === "finished" ? scoreText(m) : m.state === "walkover" ? tx.walkover[m.walkover ?? "noShow"] : ""
  const status = m.affected ? tx.affected : m.state === "live" ? tx.tournament.live : m.state === "ready" ? (m.board ? tx.tournament.onBoard(boardName(read.state, m.board)) : tx.state.ready) : m.state === "pending" ? "" : m.board ? boardName(read.state, m.board) : ""
  return (
    <ListRow
      onClick={onClick}
      className={cn(mine && "bg-primary/5")}
      title={
        <span className="flex flex-col gap-0.5">
          <Side name={nameOf(a.participant, a.empty)} hint={a.participant ? names.hintOf?.(a.participant) : null} winner={m.winner !== null && m.winner === a.participant} />
          <Side name={nameOf(b.participant, b.empty)} hint={b.participant ? names.hintOf?.(b.participant) : null} winner={m.winner !== null && m.winner === b.participant} />
        </span>
      }
      subtitle={[tx.matchNumber(m.number), status].filter(Boolean).join(" · ")}
      value={value ? <span className={cn("font-display text-xl font-semibold text-foreground", live?.stale && "opacity-50")}>{value}</span> : undefined}
    />
  )
}

function Side({ name, hint, winner }: { name: string; hint?: string | null; winner: boolean }) {
  return (
    <span className={cn("leading-snug", winner && "font-semibold")}>
      {name}
      {hint && <span className="ml-1.5 text-[0.8125rem] font-normal text-muted-foreground">{hint}</span>}
    </span>
  )
}
