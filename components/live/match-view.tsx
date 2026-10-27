"use client"

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { CircleDot, Hourglass, Maximize2, Pause, Trophy, WifiOff, X } from "lucide-react"
import { ClockScoreboard, CricketScoreboard, X01Scoreboard } from "@/components/game/scoreboards"
import { slotLabel } from "@/components/game/visit-panel"
import { Waiting } from "@/components/common/waiting"
import { useAreaT, useT } from "@/components/i18n-provider"
import { LIVE_TEXTS } from "@/lib/i18n/features/live.screens"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { EmptyState } from "@/components/ui/empty-state"
import type { MatchState } from "@/lib/game/engine"
import type { MatchConfig } from "@/lib/game/types"
import { gameSubtitle, rulesSummary } from "@/lib/game/words"
import { watchedGame } from "@/lib/live/content"
import { agreementToConfig } from "@/lib/protocol/match"
import { followMatch, type Followed, type MatchSource } from "@/lib/live/follow"
import { formatClock } from "@/lib/i18n"
import type { LiveSnapshot } from "@/lib/protocol/live"
import { cn } from "@/lib/utils"

// A live match as spectators and seated players see it: the board's own scoreboard, replayed
// by the engine from the latest snapshot, with its status, the time of that snapshot, and a
// clear "Verbindung unterbrochen" when the relays stop answering. Read-only throughout.

const NOT_FOLLOWED: Followed = { state: null, problem: null, connection: "connecting", heardAt: null, settled: false }

// One follow per match on this device, shared by whatever shows the match at the same time (a
// seat's row on the Play tab and the seat's screen) and closed once the last of them is gone.
const follows = new Map<string, { followed: Followed; listeners: Set<() => void>; close: () => void }>()

function subscribeTo(source: MatchSource, listener: () => void) {
  let follow = follows.get(source.match)
  if (!follow) {
    const made = { followed: NOT_FOLLOWED, listeners: new Set<() => void>(), close: () => {} }
    follows.set(source.match, made)
    made.close = followMatch(source, (followed) => {
      made.followed = followed
      for (const tell of made.listeners) tell()
    }).close
    follow = made
  }
  const shared = follow
  shared.listeners.add(listener)
  return () => {
    shared.listeners.delete(listener)
    if (shared.listeners.size > 0) return
    shared.close()
    if (follows.get(source.match) === shared) follows.delete(source.match)
  }
}

export function useFollowed(source: MatchSource | null): Followed {
  const match = source?.match ?? null
  // The source is fixed per match; a new object for the same match changes nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subscribe = useCallback((listener: () => void) => (source ? subscribeTo(source, listener) : () => {}), [match])
  return useSyncExternalStore(
    subscribe,
    () => (match && follows.get(match)?.followed) || NOT_FOLLOWED,
    () => NOT_FOLLOWED,
  )
}

// Loading, missing and unreadable matches, or null once there is something to show.
function MatchProblem({ followed }: { followed: Followed }) {
  const tx = useAreaT(LIVE_TEXTS)
  const w = tx.watch
  if (followed.state) return null
  if (followed.problem === "missing") return <EmptyState icon={CircleDot} title={w.notFound} description={w.notFoundText} />
  if (followed.problem) return <EmptyState icon={CircleDot} title={w.unreadable} description={w.unreadableText} />
  if (followed.connection === "interrupted") return <EmptyState icon={WifiOff} title={w.offline} description={w.offlineText} />
  return <Waiting>{w.connecting}</Waiting>
}

// `compact`: a smaller board, so the actions below it (a verdict) stay in view.
export function MatchView({ followed, actions, compact }: { followed: Followed; actions?: ReactNode; compact?: boolean }) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  const [fullScreen, setFullScreen] = useState(false)
  const state = followed.state
  if (!state) return <MatchProblem followed={followed} />
  const live = state.live
  const config = agreementToConfig(state.agreement)
  const game = live ? watchedGame(state.agreement, live.content) : null
  const status = live?.content.status ?? null
  // A score that may be out of date is shown as such, never as the current one.
  const stale = followed.connection === "interrupted"

  return (
    <div className="mt-2">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold leading-tight wrap-anywhere">{rulesSummary(t, config)}</h2>
          <Freshness followed={followed} status={status} />
        </div>
        {game?.state && (
          <button
            type="button"
            onClick={() => setFullScreen(true)}
            aria-label={tx.watch.fullScreen}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary active:bg-secondary/70"
          >
            <Maximize2 className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </header>

      {!live ? (
        <p className="mt-6 text-[0.9375rem] text-muted-foreground">{tx.watch.waiting}</p>
      ) : game?.state ? (
        // On a phone in landscape (xshort) a lower board keeps the current visit above the tab bar.
        !fullScreen && <Board state={game.state} stale={stale} className={cn("mt-4", compact ? "h-[clamp(11rem,34dvh,20rem)]" : "h-[clamp(13rem,52dvh,30rem)] xshort:h-[clamp(8rem,45dvh,30rem)]")} />
      ) : (
        <div className={cn("transition-opacity", stale && "opacity-50")}>
          <Standing config={config} snapshot={live.content} />
        </div>
      )}

      {actions}

      {fullScreen && game?.state && (
        <FullScreen onClose={() => setFullScreen(false)}>
          <div className="min-w-0 px-1">
            <p className="text-2xl font-semibold leading-tight tablet:text-4xl wrap-anywhere">{rulesSummary(t, config)}</p>
            <Freshness followed={followed} status={status} large />
          </div>
          <Board state={game.state} stale={stale} className="min-h-0 flex-1" large />
        </FullScreen>
      )}
    </div>
  )
}

// Status in words with a symbol, and how current the score is: the time the board signed it, or,
// when the connection broke, since when nothing new came ("Verbindung unterbrochen · zuletzt
// aktualisiert 21:14"). Before the first score there is no "Stand von": only a broken connection
// names a time then, the last a relay answered.
function Freshness({ followed, status, large }: { followed: Followed; status: LiveSnapshot["status"] | null; large?: boolean }) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  const w = tx.watch
  const interrupted = followed.connection === "interrupted"
  const live = followed.state?.live ?? null
  const at = live ? live.at * 1000 : interrupted ? followed.heardAt : null
  const Icon = interrupted ? WifiOff : status === "finished" ? Trophy : status === "playing" ? CircleDot : status ? Pause : Hourglass
  return (
    <p className={cn("mt-1 text-[0.9375rem] leading-snug text-muted-foreground", large && "tablet:text-xl")}>
      <span className={cn("font-medium", interrupted ? "text-warning" : status === "playing" ? "text-danger" : "text-foreground")}>
        <Icon className="mr-1.5 inline h-4 w-4 -translate-y-px align-middle" aria-hidden="true" />
        {interrupted ? w.interrupted : status ? w.status[status] : w.connecting}
      </span>
      {at !== null && ` · ${interrupted ? w.lastUpdated(formatClock(t, at)) : w.updatedAt(formatClock(t, at))}`}
    </p>
  )
}

// A stale board is faded, so an old score never reads as the current one.
function Board({ state, stale, className, large }: { state: MatchState; stale: boolean; className?: string; large?: boolean }) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  const players = state.config.players
  const winner = state.winner !== null ? players[state.winner].name : null
  return (
    <section aria-label={gameSubtitle(t, state)} className={cn("flex flex-col gap-2 transition-opacity", stale && "opacity-50", className)}>
      <div className="relative min-h-0 flex-1 @container-size">
        {state.config.type === "x01" && <X01Scoreboard state={state} />}
        {state.config.type === "cricket" && <CricketScoreboard state={state} />}
        {state.config.type === "clock" && <ClockScoreboard state={state} />}
      </div>
      <p aria-live="polite" className={cn("rounded-2xl border border-border bg-card px-4 py-3 text-[1.0625rem]", large && "tablet:py-5 tablet:text-3xl")}>
        {winner ? (
          <span className="flex items-center gap-2 font-semibold">
            <Trophy className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            {tx.watch.wins(winner)}
          </span>
        ) : (
          <CurrentVisit state={state} />
        )}
      </p>
    </section>
  )
}

function CurrentVisit({ state }: { state: MatchState }) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  const name = state.config.players[state.current].name
  const darts = state.visitDarts.map((d) => slotLabel(state, d, t))
  const points = state.config.type === "x01" ? state.visitStartScore - state.scores[state.current] : null
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-semibold wrap-anywhere">{tx.watch.throwing(name)}</span>
      <span className="text-muted-foreground">{tx.watch.current}</span>
      <span className="font-display font-semibold tabular-nums">{darts.length > 0 ? darts.join("  ") : "–"}</span>
      {points !== null && darts.length > 0 && <span className="ml-auto font-display font-semibold tabular-nums">{points}</span>}
    </span>
  )
}

// A very long game's snapshot carries only the end of its log: the score stands, the board can't
// be redrawn from it.
function Standing({ config, snapshot }: { config: MatchConfig; snapshot: LiveSnapshot }) {
  const tx = useAreaT(LIVE_TEXTS)
  const s = snapshot.standing
  return (
    <Group footer={tx.watch.standingOnly}>
      {config.players.map((p, i) => (
        <ListRow
          key={p.id}
          title={p.name}
          subtitle={[s.sets ? tx.watch.sets(`${s.sets[i]}`) : null, tx.watch.legs(`${s.legs[i]}`), s.current === i && s.winner === null ? tx.watch.throwing(p.name) : null].filter(Boolean).join(" · ")}
          value={<span className="font-display text-2xl font-semibold text-foreground">{s.scores[i]}</span>}
        />
      ))}
    </Group>
  )
}

// The TV view: the whole screen for the scoreboard, in large type; Escape or the button closes it.
function FullScreen({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.live.titles.watch}
      className="fixed inset-0 z-50 flex flex-col gap-3 bg-background px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pl-[max(env(safe-area-inset-left),0.75rem)] pr-[max(env(safe-area-inset-right),0.75rem)] pt-[max(env(safe-area-inset-top),0.5rem)] tablet:gap-5 tablet:px-6"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={tx.watch.closeFullScreen}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-secondary/70"
      >
        <X className="h-6 w-6" aria-hidden="true" />
      </button>
      {children}
    </div>
  )
}
