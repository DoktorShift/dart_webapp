"use client"

import { useRef, useState } from "react"
import { Crosshair, Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { scoreText, useRoundLabel } from "@/components/tournaments/common"
import type { Names } from "@/components/tournaments/matches-list"
import type { Bracket, MatchView, Standings } from "@/lib/tournaments/engine"
import type { TournamentRead } from "@/lib/tournaments/read"
import { cn } from "@/lib/utils"

const ZOOMS = [0.6, 0.8, 1, 1.25]
const BRACKET_ORDER: Bracket[] = ["winners", "main", "losers", "final"]

// The bracket (knockout formats) as columns of rounds, zoomable, with "Zu meinem Spiel", and
// the tables of a round robin or group stage. The matches list is the way to opponent and
// board on a phone; this is the overview.
export function BracketView({ read, names, me }: { read: TournamentRead; names: Names; me: string | null }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const view = read.view
  if (!view) return <p className="mt-8 text-center text-[0.9375rem] text-muted-foreground">{tx.tournament.noMatchesText}</p>
  const knockout = view.matches.filter((m) => m.bracket !== "group" && m.state !== "void")
  return (
    <>
      {view.standings.map((s) => (
        <Table key={s.group ?? "all"} standings={s} names={names} me={me} />
      ))}
      {knockout.length > 0 && <Tree matches={knockout} names={names} me={me} />}
    </>
  )
}

function Table({ standings, names, me }: { standings: Standings; names: Names; me: string | null }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const h = tx.tournament.table
  return (
    <Group title={standings.group ? tx.round.group(standings.group, 0).replace(/,.*$/, "") : undefined} footer={tx.tournament.tableFooter}>
      <table className="w-full text-[0.9375rem]">
        <thead>
          <tr className="text-left text-[0.8125rem] text-muted-foreground">
            <th className="py-2 pl-4 pr-2 font-normal">{h.rank}</th>
            <th className="py-2 pr-2 font-normal">{h.player}</th>
            <th className="py-2 pr-2 text-right font-normal tabular-nums">{h.played}</th>
            <th className="py-2 pr-2 text-right font-normal tabular-nums">{h.wins}</th>
            <th className="py-2 pr-2 text-right font-normal tabular-nums">{h.losses}</th>
            <th className="py-2 pr-2 text-right font-normal tabular-nums">{h.legs}</th>
            <th className="py-2 pr-4 text-right font-normal tabular-nums">{h.points}</th>
          </tr>
        </thead>
        <tbody>
          {standings.rows.map((row) => (
            <tr key={row.participant} className={cn("border-t border-border", row.participant === me && "bg-primary/5 font-semibold", row.inactive && "text-muted-foreground")}>
              <td className="py-2 pl-4 pr-2 tabular-nums">{row.rank}</td>
              <td className="py-2 pr-2 wrap-anywhere">{names.nameOf(row.participant)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{row.played}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{row.wins}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{row.losses}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{row.legsFor - row.legsAgainst}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Group>
  )
}

function Tree({ matches, names, me }: { matches: MatchView[]; names: Names; me: string | null }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const round = useRoundLabel()
  const [zoom, setZoom] = useState(2)
  const scroller = useRef<HTMLDivElement>(null)
  const mine = me ? matches.find((m) => m.slots.some((s) => s.participant === me) && (m.state === "ready" || m.state === "live" || m.state === "pending")) ?? matches.find((m) => m.slots.some((s) => s.participant === me)) : null
  const brackets = BRACKET_ORDER.filter((b) => matches.some((m) => m.bracket === b))
  const toMine = () => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-match="${mine?.id}"]`)
    el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" })
  }
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Button variant="secondary" size="icon" aria-label={tx.tournament.zoomOut} onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} className="h-11 w-11 rounded-xl">
          <Minus className="h-5 w-5" aria-hidden="true" />
        </Button>
        <Button variant="secondary" size="icon" aria-label={tx.tournament.zoomIn} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} className="h-11 w-11 rounded-xl">
          <Plus className="h-5 w-5" aria-hidden="true" />
        </Button>
        {mine && (
          <Button variant="secondary" onClick={toMine} className="ml-auto h-11 gap-2 rounded-xl px-4 text-[0.9375rem] font-semibold">
            <Crosshair className="h-4 w-4" aria-hidden="true" />
            {tx.tournament.toMyMatch}
          </Button>
        )}
      </div>
      <div ref={scroller} className="overflow-auto overscroll-contain rounded-2xl border border-border bg-card p-3">
        <div style={{ zoom: ZOOMS[zoom] }} className="flex flex-col gap-6">
          {brackets.map((bracket) => {
            const rounds = [...new Set(matches.filter((m) => m.bracket === bracket).map((m) => m.round))].sort((a, b) => a - b)
            return (
              <div key={bracket} className="flex items-stretch gap-4">
                {rounds.map((r) => {
                  const column = matches.filter((m) => m.bracket === bracket && m.round === r)
                  return (
                    <div key={r} className="flex w-44 shrink-0 flex-col justify-around gap-3">
                      <p className="text-[0.8125rem] text-muted-foreground">{round(column[0])}</p>
                      {column.map((m) => (
                        <MatchBox key={m.id} m={m} names={names} me={me} />
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function MatchBox({ m, names, me }: { m: MatchView; names: Names; me: string | null }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const mine = me !== null && m.slots.some((s) => s.participant === me)
  const side = (i: 0 | 1) => {
    const s = m.slots[i]
    const name = s.empty ? tx.tournament.bye : names.nameOf(s.participant)
    const won = m.winner !== null && m.winner === s.participant
    return (
      <span className={cn("flex items-baseline justify-between gap-2 leading-snug wrap-anywhere", won && "font-semibold", s.participant === null && !s.empty && "text-muted-foreground")}>
        <span>{name}</span>
        {m.score && <span className="tabular-nums">{m.score.sets ? m.score.sets[i] : m.score.legs[i]}</span>}
      </span>
    )
  }
  return (
    <div data-match={m.id} className={cn("rounded-xl border px-3 py-2 text-[0.9375rem]", mine ? "border-primary bg-primary/10" : "border-border bg-background", m.affected && "border-dashed border-warning")}>
      {side(0)}
      {side(1)}
      <span className="mt-1 block text-[0.75rem] text-muted-foreground">
        {tx.matchNumber(m.number)}
        {m.state === "live" && ` · ${tx.tournament.live}`}
        {m.state === "walkover" && ` · ${tx.walkover[m.walkover ?? "noShow"]}`}
        {m.state === "finished" && !m.score?.sets && m.score && ` · ${scoreText(m)}`}
      </span>
    </div>
  )
}
