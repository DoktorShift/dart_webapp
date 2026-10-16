"use client"

import { useLayoutEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { ChartColumn, CircleEllipsis, History, RotateCcw, Share, Trophy, Undo2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { FitText } from "@/components/fit-text"
import { SPLIT, XSHORT, useMediaQuery } from "@/components/common/use-media-query"
import { useT } from "@/components/i18n-provider"
import { ConfettiBurst } from "@/components/game/confetti-burst"
import { PlayerStatsTable, StatsTable, allRows, keyRows, rowValues } from "@/components/game/result-stats"
import { useShareResult } from "@/components/game/use-share-result"
import { SlotItems } from "@/components/shell/slot-items"
import { legsWonInGame, perfectLegDarts, playsSets, type MatchState } from "@/lib/game/engine"
import { legName } from "@/lib/game/words"
import { modeName, type Messages } from "@/lib/i18n"
import type { SavedMatch } from "@/lib/game/types"
import type { FinishedMatch } from "@/lib/shell/registry"
import type { ResultImage } from "@/lib/result-image"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"

interface MatchResultProps {
  state: MatchState
  match: SavedMatch
  onRematch: () => void
  onNewGame: () => void
  onHome: () => void
  onLeaderboard: () => void
  onUndo: () => void
  onReview: () => void
}

// The headline of a finished game: who won, what was played, and the score between two.
function headline(state: MatchState, t: Messages) {
  const players = state.config.players
  const winner = state.winner ?? 0
  const title = players.length === 1 ? t.result.complete : t.result.wins(players[winner].name)
  let score = ""
  if (players.length === 2 && playsSets(state.config)) score = t.result.setScore(state.setsWon[0], state.setsWon[1])
  else if (players.length === 2 && state.config.legsToWin > 1) score = t.result.legScore(legsWonInGame(state, 0), legsWonInGame(state, 1))
  const subtitle = [modeName(t, state.config.modeId, state.config.modeName), score].filter(Boolean).join(", ")
  // A perfect leg (the nine-darter in 501) is the best thing that can happen in darts.
  const badges = state.legResults.flatMap((result, leg) => {
    const dartsUsed = perfectLegDarts(state.config, result)
    if (!dartsUsed) return []
    const by = players.length === 1 ? null : players[result.winner].name
    return [t.result.perfect(t.leg.perfect(dartsUsed), by, state.legResults.length > 1 ? legName(t, state, leg) : null)]
  })
  return { title, subtitle, badges }
}

function SmallAction({
  icon: Icon,
  label,
  onClick,
  ariaLabel,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary xshort:min-h-11"
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <FitText minScale={0.75} className="w-full text-center text-[0.75rem] font-medium">
        {label}
      </FitText>
    </button>
  )
}

// The areas' pieces ("result.actions", lib/shell/registry.ts) on a phone in landscape, where
// the hero and the buttons alone fill the screen: in the free middle of the top bar. One piece
// sits there as a bar button; two or more become one button with their count that opens a sheet
// with the pieces as their rows. How many show something for this game is known only from the
// DOM (a piece renders nothing for a game it has nothing to say about), so the bar's pieces are
// counted there; while the sheet is open they are in the sheet instead, and counted again when
// it closes.
function BarPieces({ match }: { match: FinishedMatch }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(0)
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const count = () => setShown(el.childElementCount)
    count()
    const observer = new MutationObserver(count)
    observer.observe(el, { childList: true })
    return () => observer.disconnect()
  }, [open])
  const several = shown > 1
  // A tap on one of the pieces is the end of the sheet's job, like choosing from a menu.
  const chosen = (event: MouseEvent) => {
    if ((event.target as Element).closest("button, a")) setOpen(false)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center">
      {!open && <SlotItems ref={bar} list="result.actions" props={() => ({ match, placement: "bar" })} className={cn("flex min-w-0 max-w-full items-center justify-center", several && "hidden")} />}
      {several && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t.result.moreLabel(shown)}
          className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[1.0625rem] font-semibold tabular-nums text-primary active:bg-secondary/70"
        >
          <CircleEllipsis className="h-5 w-5" aria-hidden="true" />
          {shown}
        </button>
      )}
      <Sheet open={open} onOpenChange={setOpen} title={t.result.more}>
        <div className="min-h-0 overflow-y-auto overscroll-contain" onClickCapture={chosen}>
          <SlotItems list="result.actions" props={() => ({ match, placement: "row" })} className="grid gap-2" />
        </div>
        <Button variant="ghost" onClick={() => setOpen(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
          {t.common.done}
        </Button>
      </Sheet>
    </div>
  )
}

// One fixed screen worth a screenshot: the winner, the key numbers per player, then Rematch.
// Everything else is a small tap away: the full statistics, sharing a picture of the result,
// the visits, the leaderboard. Undo (the winning dart was wrong) and Done sit in the top bar.
export function MatchResult({ state, match, onRematch, onNewGame, onHome, onLeaderboard, onUndo, onReview }: MatchResultProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const [statsOpen, setStatsOpen] = useState(false)
  const { title, subtitle, badges } = useMemo(() => headline(state, t), [state, t])
  // Tailwind's `split` (side by side in landscape) and `xshort` (a phone in landscape).
  const split = useMediaQuery(SPLIT)
  const xshort = useMediaQuery(XSHORT)
  const finished = useMemo<FinishedMatch>(
    () => ({
      id: match.id,
      config: match.config,
      players: match.config.players,
      winner: state.winner ?? 0,
      solo: match.config.players.length === 1,
      throws: match.throws,
    }),
    [match, state.winner],
  )

  const picture = useMemo<ResultImage>(
    () => ({
      brand: SITE.name,
      title,
      subtitle,
      badges,
      date: new Date().toLocaleDateString(t.intl, { day: "numeric", month: "long", year: "numeric" }),
      players: state.config.players.map((p) => p.name),
      winner: state.config.players.length > 1 ? state.winner : null,
      rows: keyRows(state, t).map((row) => ({ label: row.label, short: row.short, values: rowValues(state, row, t) })),
      footer: t.result.imageFooter,
      site: new URL(SITE.url).host,
    }),
    [state, t, title, subtitle, badges],
  )
  const share = useShareResult(picture, `${t.result.shareText(`${title}: ${subtitle}`)} ${SITE.url}`)

  const hero = (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.3, 1] }}
      className="text-center split:text-left"
    >
      <Trophy className="mx-auto h-[clamp(1.75rem,5dvh,3.25rem)] w-auto text-amber-500 split:mx-0" aria-hidden="true" />
      <h1 id="result-title" className="mt-1.5 font-display text-[clamp(2.25rem,6.5dvh,4rem)] font-semibold leading-none tracking-tight">
        <FitText minScale={0.55}>{title}</FitText>
      </h1>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground tablet:text-[1.0625rem]">{subtitle}</p>
      {badges.map((line) => (
        <p key={line} className="mt-2 inline-block rounded-full bg-warning/15 px-3 py-1 text-[0.9375rem] font-semibold text-warning">
          {line}
        </p>
      ))}
    </motion.div>
  )

  // Areas' pieces are rendered once, next to the buttons on screen, not in both copies of them.
  // An empty list costs no room: a guest's result looks exactly as before.
  const pieces = <SlotItems list="result.actions" props={() => ({ match: finished, placement: "row" })} className="mb-2 grid gap-2 empty:hidden short:mb-1 short:gap-1" />
  const actions = (withPieces: boolean) => (
    <div>
      {withPieces && !xshort && pieces}
      <Button onClick={onRematch} className="h-14 w-full gap-2 rounded-2xl text-[1.0625rem] font-semibold xshort:h-12">
        <RotateCcw className="h-5 w-5" aria-hidden="true" />
        {t.result.rematch}
      </Button>
      <Button variant="secondary" onClick={onNewGame} className="mt-2 h-12 w-full gap-2 rounded-2xl text-[1.0625rem] xshort:h-11">
        <Users className="h-5 w-5" aria-hidden="true" />
        {t.result.newGame}
      </Button>
      <div className="mt-1 grid grid-cols-4 gap-1">
        <SmallAction icon={Share} label={t.result.share} onClick={share} />
        <SmallAction icon={ChartColumn} label={t.result.allStats} onClick={() => setStatsOpen(true)} />
        <SmallAction icon={History} label={t.result.visits} ariaLabel={t.result.visitsLabel} onClick={onReview} />
        <SmallAction icon={Trophy} label={t.nav.leaderboard} onClick={onLeaderboard} />
      </div>
    </div>
  )

  // Fits one screen like the game itself: stacked on phones, side by side in landscape.
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="result-title" className="absolute inset-0 z-40 overflow-hidden bg-background">
      <ConfettiBurst />
      <div className="relative z-10 mx-auto flex h-full max-w-2xl flex-col px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-[env(safe-area-inset-top)] split:max-w-5xl split:pl-[max(env(safe-area-inset-left),1rem)] split:pr-[max(env(safe-area-inset-right),1rem)]">
        <header className="flex h-11 shrink-0 items-center justify-between">
          <Button variant="ghost" onClick={onUndo} aria-label={t.common.undoLastDart} className="-ml-3 h-11 gap-1.5 px-3 text-[1.0625rem] font-normal text-primary">
            <Undo2 className="h-5 w-5" aria-hidden="true" />
            {t.result.undoDart}
          </Button>
          {xshort && <BarPieces match={finished} />}
          <Button variant="ghost" onClick={onHome} className="-mr-3 h-11 px-3 text-[1.0625rem] font-semibold text-primary">
            {t.common.done}
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-[clamp(0.5rem,2dvh,1.25rem)] split:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] split:grid-rows-[minmax(0,1fr)] split:items-center split:gap-8">
          <div className="flex flex-col gap-[clamp(0.5rem,3dvh,2rem)] split:justify-center">
            {hero}
            <div className="hidden split:block">{actions(split)}</div>
          </div>
          {/* One or two players side by side, like a TV graphic; more get a row each, so every name and number fits. */}
          {state.config.players.length > 2 ? (
            <PlayerStatsTable state={state} rows={keyRows(state, t)} className="max-h-full self-center" />
          ) : (
            <StatsTable state={state} rows={keyRows(state, t)} large className="max-h-full self-center" />
          )}
          <div className="split:hidden">{actions(!split)}</div>
        </div>
      </div>

      <Sheet open={statsOpen} onOpenChange={setStatsOpen} title={t.result.allStats} description={t.result.allStatsDescription}>
        <StatsTable state={state} rows={allRows(state, t)} />
        <Button variant="ghost" onClick={() => setStatsOpen(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
          {t.common.done}
        </Button>
      </Sheet>
    </div>
  )
}
