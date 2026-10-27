"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Maximize2, Trophy, X } from "lucide-react"
import { Waiting } from "@/components/common/waiting"
import { useAreaT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { boardName, scoreText, useParticipantNames, useRoundLabel } from "@/components/tournaments/common"
import { useLiveMatches, useLiveStanding } from "@/components/tournaments/use-live-matches"
import { useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import type { MatchView } from "@/lib/tournaments/engine"
import type { ScreenProps } from "@/lib/shell/registry"
import { cn } from "@/lib/utils"

// The spectator and TV view (PLAN.md): released scores, round and the next calls in large type,
// nothing to administer, nothing private. Full screen on a TV with one tap; Escape leaves it.
export default function TvScreen({ params }: ScreenProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const { entry, loaded } = useTournament(params.tournament ?? null)
  useLiveMatches(entry?.read)
  const [full, setFull] = useState(false)
  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFull(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [full])
  if (!loaded) return null
  if (!entry?.read.state) return <Waiting>{tx.tournament.loading}</Waiting>
  const content = <Board entry={entry} large={full} />
  if (!full)
    return (
      <div className="pb-4">
        <div className="mt-2 flex items-start justify-between gap-3">
          <h2 className="text-2xl font-semibold leading-tight wrap-anywhere">{entry.read.state.settings.name}</h2>
          <button type="button" onClick={() => setFull(true)} aria-label={tx.tv.fullScreen} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary active:bg-secondary/70">
            <Maximize2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {content}
      </div>
    )
  return (
    <div role="dialog" aria-modal="true" aria-label={tx.tv.fullScreen} className="fixed inset-0 z-50 overflow-y-auto bg-background px-6 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),0.5rem)]">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-4xl font-semibold leading-tight wrap-anywhere">{entry.read.state.settings.name}</h2>
        <button type="button" onClick={() => setFull(false)} aria-label={tx.tv.closeFullScreen} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-secondary/70">
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
      {content}
    </div>
  )
}

function Board({ entry, large }: { entry: Entry; large: boolean }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const names = useParticipantNames(entry.read)
  const { read } = entry
  const view = read.view
  const live = view?.matches.filter((m) => m.state === "live") ?? []
  const next = view?.matches.filter((m) => m.state === "ready" && m.board !== null) ?? []
  const done = view ? [...view.matches].filter((m) => m.state === "finished" || m.state === "walkover").reverse().slice(0, large ? 6 : 4) : []
  const decided = view?.matches.filter((m) => m.state === "finished" || m.state === "walkover").length ?? 0
  const total = view?.matches.filter((m) => m.state !== "void").length ?? 0
  return (
    <div className={cn("mt-4 grid gap-6", large && "lg:grid-cols-2")}>
      {view?.champion && (
        <p className={cn("flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 font-semibold text-success wrap-anywhere", large ? "text-5xl lg:col-span-2" : "text-2xl")}>
          <Trophy className={cn("shrink-0", large ? "h-12 w-12" : "h-7 w-7")} aria-hidden="true" />
          {tx.tv.champion(names.nameOf(view.champion))}
        </p>
      )}
      <Section title={tx.tv.live} large={large}>
        {live.length === 0 && <Empty large={large}>{tx.tv.noLive}</Empty>}
        {live.map((m) => (
          <LiveTile key={m.id} entry={entry} m={m} names={names} large={large} />
        ))}
      </Section>
      <Section title={tx.tv.next} large={large}>
        {next.length === 0 && <Empty large={large}>{tx.tv.noNext}</Empty>}
        {next.map((m) => (
          <Tile key={m.id} m={m} names={names} large={large} right={boardName(read.state, m.board)} />
        ))}
      </Section>
      <Section title={tx.tv.results} large={large}>
        {done.map((m) => (
          <Tile key={m.id} m={m} names={names} large={large} right={m.state === "walkover" ? tx.walkover[m.walkover ?? "noShow"] : scoreText(m)} />
        ))}
        {!view?.champion && <p className={cn("px-1 text-muted-foreground", large ? "text-2xl" : "text-[0.9375rem]")}>{tx.tv.progress(decided, total)}</p>}
      </Section>
    </div>
  )
}

const Section = ({ title, large, children }: { title: string; large: boolean; children: ReactNode }) => (
  <section>
    <h3 className={cn("mb-2 px-1 font-semibold text-muted-foreground", large ? "text-2xl" : "text-[0.9375rem]")}>{title}</h3>
    <div className="grid gap-2">{children}</div>
  </section>
)

const Empty = ({ large, children }: { large: boolean; children: ReactNode }) => <p className={cn("px-1 text-muted-foreground", large ? "text-2xl" : "text-[1.0625rem]")}>{children}</p>

// One match: each player on a line with, in a live match, the points still to throw and the legs
// (small) at the right; the winner of a finished one carries a trophy as well as the weight.
function Tile({ m, names, large, right, standing }: { m: MatchView; names: { nameOf: (id: string | null) => string }; large: boolean; right: string; standing?: { scores: number[]; legs: number[] } }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const round = useRoundLabel()
  return (
    <div className={cn("rounded-2xl border border-border bg-card px-4 py-3", large && "px-6 py-5")}>
      <p className={cn("text-muted-foreground", large ? "text-xl" : "text-[0.8125rem]")}>{round(m)}</p>
      {[0, 1].map((i) => {
        const won = m.winner !== null && m.winner === m.slots[i].participant
        return (
          <p key={i} className={cn("flex items-baseline justify-between gap-4 leading-snug wrap-anywhere", large ? "text-4xl" : "text-[1.25rem]", won && "font-semibold")}>
            <span className="flex items-baseline gap-2">
              {names.nameOf(m.slots[i].participant)}
              {won && <Trophy className={cn("shrink-0 self-center text-amber-500", large ? "h-8 w-8" : "h-4 w-4")} aria-label={tx.tv.winner} />}
            </span>
            {standing && (
              <span className="flex shrink-0 items-baseline gap-3 font-display tabular-nums">
                <span className="font-semibold">{standing.scores[i]}</span>
                <span className={cn("text-muted-foreground", large ? "text-2xl" : "text-[0.9375rem]")}>{standing.legs[i] ?? 0}</span>
              </span>
            )}
          </p>
        )
      })}
      <p className={cn("mt-1 font-semibold", large ? "text-2xl" : "text-[1.0625rem]")}>{right}</p>
    </div>
  )
}

// A live match's legs, from the board's snapshot through lib/live.
function LiveTile({ entry, m, names, large }: { entry: Entry; m: MatchView; names: { nameOf: (id: string | null) => string }; large: boolean }) {
  const { read } = entry
  const live = useLiveStanding(read.live[m.id]?.match ?? null, read.relays)
  const board = m.board ?? read.live[m.id]?.board ?? null
  return (
    <div className={cn(live?.stale && "opacity-50")}>
      <Tile m={m} names={names} large={large} right={boardName(read.state, board)} standing={live?.standing} />
    </div>
  )
}
