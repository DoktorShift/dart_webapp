"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Dartboard } from "@/components/dartboard"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import { CRICKET_TARGETS, playsSets, setsToWin, type MatchState } from "@/lib/game/engine"
import { formatNumber, type Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Scoreboards fill the space the game screen gives them. Type is sized from that space in
// container units (cqh/cqw = 1% of the scoreboard's height/width), using whichever is smaller,
// so scores never clip in a wide phone row or a tall, narrow tablet panel. When the panel is
// taller than wide, tiles stack instead of sitting side by side. Names shrink, never "…".

// Tile grids: side by side in a wide panel, stacked in a tall one.
const GRID = {
  one: "grid-cols-1",
  two: "grid-cols-2 [@container(orientation:portrait)]:grid-cols-1",
  four: "grid-cols-2 [@container(orientation:portrait)]:grid-cols-1",
  six: "grid-cols-3 [@container(orientation:portrait)]:grid-cols-2 [@container(max-height:8rem)]:grid-cols-2 [@container(max-height:8rem)]:gap-1.5",
}

// Score sizes for each grid, sized from the tile (container share) by height and by width,
// whichever is smaller, so three digits always fit.
const SCORE = {
  one: "text-[clamp(2.5rem,min(45cqh,40cqw),12rem)]",
  two: "text-[clamp(2rem,min(48cqh,24cqw),11rem)] [@container(orientation:portrait)]:text-[clamp(2rem,min(28cqh,40cqw),11rem)]",
  four: "text-[clamp(1.25rem,min(26cqh,13cqw),5rem)] [@container(orientation:portrait)]:text-[clamp(1.25rem,min(16cqh,30cqw),5rem)]",
  six: "text-[clamp(1.1rem,min(26cqh,17cqw),4.5rem)] [@container(orientation:portrait)]:text-[clamp(1.1rem,min(18cqh,26cqw),4.5rem)]",
}

// A very short scoreboard (small phones with the browser bars showing, or many players):
// name and score sit side by side in each tile, and secondary lines step aside.
// Written out in full so Tailwind finds the class names.
const LOW_ROW = "[@container(max-height:8rem)]:flex-row [@container(max-height:8rem)]:items-center [@container(max-height:8rem)]:gap-1.5"
const LOW_SCORE = "[@container(max-height:8rem)]:text-[clamp(1.1rem,min(21cqh,9cqw),2.5rem)]"
const LOW_FILL = "[@container(max-height:8rem)]:flex-1"
const LOW_HIDE = "[@container(max-height:8rem)]:hidden"

const sizeOf = (n: number): keyof typeof GRID => (n === 1 ? "one" : n === 2 ? "two" : n <= 4 ? "four" : "six")

function Pill({ label, strong, children }: { label: string; strong?: boolean; children: string }) {
  return (
    <span
      aria-label={label}
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-[0.75rem] font-semibold tabular-nums tablet:text-[0.9375rem]",
        strong ? "bg-primary text-primary-foreground" : "bg-primary/20 text-foreground",
      )}
    >
      {children}
    </span>
  )
}

// Sets and legs won, as words readable from the oche: "1 Satz", "2 Legs". Each appears once
// the player has won one; the header says where the game stands.
function MatchScore({ state, player }: { state: MatchState; player: number }) {
  const t = useT()
  const c = state.config
  const sets = playsSets(c) ? state.setsWon[player] : 0
  const legs = c.legsToWin > 1 ? state.legsWon[player] : 0
  if (sets === 0 && legs === 0) return null
  return (
    <span className="flex shrink-0 gap-1">
      {sets > 0 && (
        <Pill strong label={t.board.setsWon(sets, setsToWin(c))}>
          {t.board.sets(sets)}
        </Pill>
      )}
      {legs > 0 && <Pill label={t.board.legsWon(legs, c.legsToWin)}>{t.board.legs(legs)}</Pill>}
    </span>
  )
}

function ActiveHighlight({ className }: { className?: string }) {
  return (
    <motion.span
      layoutId="active-player"
      aria-hidden="true"
      className={cn("absolute inset-0 rounded-2xl border-2 border-primary bg-primary/15 tablet:border-[3px]", className)}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
    />
  )
}

function AnimatedScore({ value, className, wrapperClassName }: { value: number; className: string; wrapperClassName?: string }) {
  const reduceMotion = useReducedMotion()
  return (
    <span className={cn("relative block overflow-hidden", wrapperClassName)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: "40%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: "-40%" }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.3, 1] }}
          // leading-none goes last: cn() drops line heights that come before a font size.
          className={cn("block whitespace-nowrap font-display font-semibold tabular-nums tracking-tight", className, "leading-none")}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

// A player tile is a button: tapping it between visits lets that player throw now (wrong
// order, or a different starter). The game screen asks for confirmation first.
function Tile({
  active,
  onSelect,
  label,
  className,
  children,
}: {
  active: boolean
  onSelect?: () => void
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <li className="min-h-0 min-w-0">
      <button
        type="button"
        onClick={onSelect}
        disabled={!onSelect}
        aria-current={active ? "true" : undefined}
        aria-label={label}
        className={cn(
          "relative flex h-full w-full flex-col justify-center overflow-hidden rounded-2xl border border-border bg-card/70 text-left disabled:cursor-default",
          className,
        )}
      >
        {active && <ActiveHighlight />}
        <span className="relative block min-w-0">{children}</span>
      </button>
    </li>
  )
}

interface BoardProps {
  state: MatchState
  // Called with a player index when a tile is tapped between visits.
  onSelectPlayer?: (player: number) => void
}

// What VoiceOver reads for a player: name, score, and whether they're throwing or have left.
function playerLabel(state: MatchState, i: number, detail: string, t: Messages) {
  const parts = [state.config.players[i].name, detail]
  if (i === state.current && state.winner === null) parts.push(t.board.throwing)
  if (!state.active[i]) parts.push(t.board.leftGame)
  return parts.join(", ")
}

export function X01Scoreboard({ state, onSelectPlayer }: BoardProps) {
  const t = useT()
  const players = state.config.players
  const size = sizeOf(players.length)
  const between = state.visitDarts.length === 0 && state.winner === null

  return (
    <ol className={cn("grid h-full auto-rows-[minmax(0,1fr)] gap-2 tablet:gap-3", GRID[size])}>
      {players.map((player, i) => {
        const active = i === state.current && state.winner === null
        const retired = !state.active[i]
        const last = state.lastVisit[i]
        // Live average: include the points of the visit in progress.
        const st = state.stats[i]
        const inVisit = i === state.current ? state.visitStartScore - state.scores[i] : 0
        const avg = st.darts > 0 ? Math.round(((st.points + inVisit) / st.darts) * 3 * 10) / 10 : null
        const select = between && !active && !retired && onSelectPlayer ? () => onSelectPlayer(i) : undefined
        const label = playerLabel(state, i, t.board.left(state.scores[i]), t)
        const average = t.board.avg(avg === null ? "–" : formatNumber(t, avg))
        const name = (
          <FitText minScale={0.75} className={cn("font-semibold leading-tight", !active && "text-muted-foreground", retired && "line-through")}>
            {player.name}
          </FitText>
        )
        const score = (
          <AnimatedScore
            value={state.scores[i]}
            className={cn(SCORE[size], size === "six" && LOW_SCORE, !active && "text-foreground/75")}
            wrapperClassName="shrink-0"
          />
        )

        if (size === "six") {
          return (
            <Tile key={player.id} active={active} onSelect={select} label={label} className="px-2 py-1 tablet:px-4">
              <span className={cn("flex flex-col", LOW_ROW)}>
                <span className={cn("flex min-w-0 items-center gap-1 text-[0.8125rem] tablet:text-lg", LOW_FILL)}>
                  <span className="min-w-0 flex-1">{name}</span>
                  <MatchScore state={state} player={i} />
                </span>
                {score}
                {last?.bust && <span className={cn("block text-[0.75rem] font-medium text-danger", LOW_HIDE)}>{t.board.bust}</span>}
              </span>
            </Tile>
          )
        }

        if (size === "four") {
          return (
            <Tile key={player.id} active={active} onSelect={select} label={label} className="px-3 py-1.5 tablet:px-4">
              {/* Name beside the score; on a very narrow board (but not a short one) name above it. */}
              <span className="flex items-center gap-2 [@container(max-width:20rem)_and_(min-height:8.0625rem)]:flex-col [@container(max-width:20rem)_and_(min-height:8.0625rem)]:items-stretch [@container(max-width:20rem)_and_(min-height:8.0625rem)]:gap-0">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[0.875rem] tablet:text-lg">
                    <span className="min-w-0 flex-1">{name}</span>
                    <MatchScore state={state} player={i} />
                  </span>
                  <span className={cn("block text-[0.75rem] tabular-nums text-muted-foreground tablet:text-[0.9375rem]", LOW_HIDE)}>
                    {last?.bust ? <span className="font-medium text-danger">{t.board.bust}</span> : average}
                  </span>
                </span>
                <span className="shrink-0 text-right">{score}</span>
              </span>
            </Tile>
          )
        }

        return (
          <Tile key={player.id} active={active} onSelect={select} label={label} className="px-3 py-2 tablet:px-5 tablet:py-3">
            <span className="flex items-center gap-2 text-[0.9375rem] tablet:text-xl">
              <span className="min-w-0 flex-1">{name}</span>
              <MatchScore state={state} player={i} />
            </span>
            <span className="block py-0.5">{score}</span>
            <span className={cn("flex items-center justify-between gap-2 text-[0.8125rem] tabular-nums text-muted-foreground tablet:text-base", LOW_HIDE)}>
              <span>{average}</span>
              {last && <span className={cn(last.bust && "font-medium text-danger")}>{last.bust ? t.board.bust : t.board.last(last.total)}</span>}
            </span>
          </Tile>
        )
      })}
    </ol>
  )
}

function Marks({ count, dimmed, decorative }: { count: number; dimmed?: boolean; decorative?: boolean }) {
  const t = useT()
  const label = count === 0 ? t.board.noMarks : count >= 3 ? t.board.closed : t.board.marks(count)
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("aspect-square h-[78%] max-h-9 w-auto max-w-full tablet:max-h-14", dimmed && "opacity-40")}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none">
        {count >= 1 && <line x1="6" y1="18" x2="18" y2="6" />}
        {count >= 2 && <line x1="6" y1="6" x2="18" y2="18" />}
        {count >= 3 && <circle cx="12" cy="12" r="9.5" strokeWidth="2.2" />}
      </g>
    </svg>
  )
}

// Width of an element, measured before paint and kept up to date.
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

// A column per player needs about this much width for a name and its marks.
const CRICKET_COLUMN = 104

export function CricketScoreboard(props: BoardProps) {
  // Two players: mirrored around the numbers, like a chalkboard. More players: a column each
  // while there is room for names, otherwise a row each (as a pub board for a big group).
  const [ref, width] = useWidth<HTMLDivElement>()
  const n = props.state.config.players.length
  const rows = n >= 5 || (n >= 3 && width !== null && (width - 60) / n < CRICKET_COLUMN)
  return (
    <div ref={ref} className="h-full">
      {rows ? <CricketRows {...props} /> : <CricketColumns {...props} />}
    </div>
  )
}

const targetName = (target: number, t: Messages) => (target === 25 ? t.common.bull : `${target}`)

// What VoiceOver reads for a player's row: "closed 20 and 19, 2 on 18".
function marksSummary(state: MatchState, i: number, t: Messages) {
  const marks = state.marks[i]
  const closed = CRICKET_TARGETS.filter((target) => marks[target] >= 3).map((target) => targetName(target, t))
  const partial = CRICKET_TARGETS.filter((target) => marks[target] > 0 && marks[target] < 3).map((target) =>
    t.board.partial(marks[target], targetName(target, t)),
  )
  const parts = [...(closed.length ? [t.board.closedList(closed.join(t.board.and))] : []), ...partial]
  return parts.length ? parts.join(", ") : t.board.noMarks
}

// Closed by every player still in the game: hits there no longer count.
const closedByAll = (state: MatchState, target: number) =>
  state.config.players.every((_, i) => !state.active[i] || state.marks[i][target] >= 3)

function CricketRows({ state, onSelectPlayer }: BoardProps) {
  const t = useT()
  const players = state.config.players
  const between = state.visitDarts.length === 0 && state.winner === null

  return (
    <div className="h-full rounded-2xl border border-border bg-card/70 p-1.5 tablet:p-2.5">
      <div
        className="grid h-full items-stretch"
        style={{
          // Names take the width they need (up to 7.5rem), the targets share the rest.
          gridTemplateColumns: "fit-content(7.5rem) repeat(6, minmax(1rem, 1fr)) minmax(1.5rem, 1.3fr) minmax(2rem, auto)",
          gridTemplateRows: `auto repeat(${players.length}, minmax(0, 1fr))`,
        }}
      >
        <div />
        {CRICKET_TARGETS.map((target) => (
          <div
            key={target}
            className={cn(
              "flex items-center justify-center pb-0.5 font-display text-[clamp(0.875rem,min(7cqh,4.5cqw),1.75rem)] font-semibold tabular-nums",
              closedByAll(state, target) && "text-muted-foreground/50 line-through",
            )}
          >
            {targetName(target, t)}
          </div>
        ))}
        <div className="flex items-center justify-end pb-0.5 pr-2 text-[0.75rem] text-muted-foreground tablet:text-[0.9375rem]">
          {t.board.pointsHeader}
        </div>

        {players.map((player, i) => {
          const active = i === state.current && state.winner === null
          const select = between && !active && state.active[i] && onSelectPlayer ? () => onSelectPlayer(i) : undefined
          return (
            <button
              key={player.id}
              type="button"
              onClick={select}
              disabled={!select}
              aria-current={active ? "true" : undefined}
              aria-label={playerLabel(state, i, `${t.board.points(state.points[i])}, ${marksSummary(state, i, t)}`, t)}
              className="relative col-span-full grid min-h-0 grid-cols-subgrid items-center border-t border-border/60 text-left disabled:cursor-default"
            >
              {active && <ActiveHighlight className="rounded-xl" />}
              <span className="relative flex min-w-0 items-center gap-1.5 pl-2 pr-1 text-[0.875rem] font-semibold tablet:text-lg">
                <span className={cn("min-w-0 flex-1", !active && "text-muted-foreground", !state.active[i] && "line-through")}>
                  <FitText minScale={0.75} className="leading-tight">
                    {player.name}
                  </FitText>
                </span>
                <MatchScore state={state} player={i} />
              </span>
              {CRICKET_TARGETS.map((target) => (
                <span key={target} className="relative flex h-full min-h-0 items-center justify-center">
                  <Marks count={state.marks[i][target]} dimmed={closedByAll(state, target)} decorative />
                </span>
              ))}
              <span className="relative whitespace-nowrap pr-2 text-right font-display text-[clamp(1rem,min(9cqh,6cqw),2.5rem)] font-semibold leading-none tabular-nums">
                {state.points[i]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CricketColumns({ state, onSelectPlayer }: BoardProps) {
  const t = useT()
  const players = state.config.players
  const mirrored = players.length === 2
  const between = state.visitDarts.length === 0 && state.winner === null
  // Sets and legs appear under the points once someone has won one; the row changes while the leg card is up.
  const anyWon = state.legsWon.some((won) => won > 0) || state.setsWon.some((won) => won > 0)

  const header = (i: number) => {
    const active = i === state.current && state.winner === null
    const select = between && !active && state.active[i] && onSelectPlayer ? () => onSelectPlayer(i) : undefined
    return (
      <button
        key={players[i].id}
        type="button"
        onClick={select}
        disabled={!select}
        aria-current={active ? "true" : undefined}
        aria-label={playerLabel(state, i, t.board.points(state.points[i]), t)}
        className="relative min-w-0 rounded-xl px-1 py-0.5 text-center disabled:cursor-default"
      >
        {active && <ActiveHighlight className="rounded-xl" />}
        <span className="relative block">
          <FitText minScale={0.75} className={cn("text-[0.75rem] font-semibold leading-tight tablet:text-base", !active && "text-muted-foreground", !state.active[i] && "line-through")}>
            {players[i].name}
          </FitText>
          <span className="block whitespace-nowrap font-display text-[clamp(1.1rem,min(8cqh,9cqw),3rem)] font-semibold leading-tight tabular-nums">
            {state.points[i]}
          </span>
          {anyWon && (
            <span className="flex min-h-5 items-center justify-center">
              <MatchScore state={state} player={i} />
            </span>
          )}
        </span>
      </button>
    )
  }

  const number = (target: number) => (
    <div
      key={`n${target}`}
      className={cn(
        "flex min-h-0 items-center justify-center border-t border-border/60 font-display text-[clamp(1rem,6cqh,2.25rem)] font-semibold tabular-nums",
        closedByAll(state, target) && "text-muted-foreground/50 line-through",
      )}
    >
      {targetName(target, t)}
    </div>
  )
  const cell = (target: number, i: number) => (
    <div key={`${target}-${i}`} className="flex min-h-0 items-center justify-center border-t border-border/60">
      <Marks count={state.marks[i][target]} dimmed={closedByAll(state, target)} />
    </div>
  )

  return (
    <div className="h-full rounded-2xl border border-border bg-card/70 p-1.5 tablet:p-2.5">
      <div
        className="grid h-full grid-rows-[auto_repeat(7,minmax(0,1fr))] items-stretch gap-x-1"
        style={{
          gridTemplateColumns: mirrored ? "minmax(0,1fr) 3.5rem minmax(0,1fr)" : `3.25rem repeat(${players.length}, minmax(0, 1fr))`,
        }}
      >
        {mirrored ? [header(0), <div key="corner" />, header(1)] : [<div key="corner" />, ...players.map((_, i) => header(i))]}
        {CRICKET_TARGETS.map((target) =>
          mirrored ? [cell(target, 0), number(target), cell(target, 1)] : [number(target), ...players.map((_, i) => cell(target, i))],
        )}
      </div>
    </div>
  )
}

// Around the Clock tiles are a row each (name, number, progress): one column on a tall
// scoreboard, two side by side otherwise, three only where names still fit.
const CLOCK_GRID = {
  one: "grid-cols-1",
  two: "grid-cols-2 [@container(max-aspect-ratio:17/20)]:grid-cols-1",
  four: "grid-cols-2 [@container(max-aspect-ratio:17/20)]:grid-cols-1",
  six: "grid-cols-3 [@container(max-aspect-ratio:17/20)]:grid-cols-2 [@container(max-width:36rem)]:grid-cols-2",
}

export function ClockScoreboard({ state, onSelectPlayer }: BoardProps) {
  const t = useT()
  const players = state.config.players
  const size = sizeOf(players.length)
  const total = state.clockTargets.length
  const target = state.clockTargets[state.progress[state.current]]
  const between = state.visitDarts.length === 0 && state.winner === null
  // The target is what everyone looks at: with few players it gets most of the space.
  const cardShare = players.length <= 2 ? "flex-[3]" : players.length <= 4 ? "flex-[2]" : "flex-[1.4]"

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 tablet:gap-3">
      {/* The number to aim for, shown on the board itself. */}
      <div className={cn("flex min-h-0 items-center gap-3 rounded-2xl border border-border bg-card/70 px-3 py-1.5 tablet:gap-5 tablet:px-5", cardShare)}>
        {/* Never more than 45% of the card's width, so the name and number beside it always fit. */}
        <Dartboard
          variant="mini"
          className="aspect-square h-full max-h-[min(10rem,40cqw)] w-auto shrink-0 py-1 tablet:max-h-[min(20rem,45cqw)]"
          target={target === 25 ? "bull" : target}
        />
        <div className="min-w-0 flex-1">
          <FitText className="text-[0.9375rem] text-muted-foreground tablet:text-lg">{t.board.aimFor(players[state.current].name)}</FitText>
          <p className="whitespace-nowrap font-display text-[clamp(2rem,min(30cqh,24cqw),8rem)] font-semibold leading-none tabular-nums">
            {targetName(target, t)}
          </p>
        </div>
      </div>
      <ol className={cn("grid min-h-0 flex-[2] auto-rows-[minmax(0,1fr)] gap-2 tablet:gap-3", CLOCK_GRID[size])}>
        {players.map((player, i) => {
          const active = i === state.current && state.winner === null
          const done = state.progress[i]
          const next = state.clockTargets[done]
          const select = between && !active && state.active[i] && onSelectPlayer ? () => onSelectPlayer(i) : undefined
          const nextName = next === undefined ? t.board.finished : targetName(next, t)
          return (
            <Tile key={player.id} active={active} onSelect={select} label={playerLabel(state, i, t.board.on(nextName), t)} className="px-3 py-1 tablet:px-4">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[0.875rem] tablet:text-lg">
                  <FitText minScale={0.75} className={cn("font-semibold leading-tight", !active && "text-muted-foreground", !state.active[i] && "line-through")}>
                    {player.name}
                  </FitText>
                </span>
                <MatchScore state={state} player={i} />
                <span className="whitespace-nowrap font-display text-[clamp(1.25rem,min(9cqh,8cqw),3rem)] font-semibold leading-none tabular-nums">
                  {nextName}
                </span>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted-foreground/20">
                <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
              </span>
            </Tile>
          )
        })}
      </ol>
    </div>
  )
}
