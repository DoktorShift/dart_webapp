"use client"

import { motion, useReducedMotion } from "framer-motion"
import { History, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfettiBurst } from "@/components/game/confetti-burst"
import { useT } from "@/components/i18n-provider"
import { dartLabel, perfectLegDarts, playsSets, setScore, type MatchState } from "@/lib/game/engine"
import { legName } from "@/lib/game/words"
import { cn } from "@/lib/utils"

// Shown between legs so players can collect their darts before the next leg starts.
export function LegWonCard({
  state,
  onNext,
  onUndo,
  onReview,
}: {
  state: MatchState
  onNext: () => void
  onUndo: () => void
  onReview: () => void
}) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const result = state.legResults.at(-1)
  if (!result) return null
  const players = state.config.players
  const winner = players[result.winner]
  const starter = players[state.legStarter]
  const lastDart = result.lastVisit.darts.at(-1)
  const finishingDart = lastDart ? dartLabel(lastDart) : null
  const sets = playsSets(state.config)
  const newSet = sets && result.wonSet
  // Legs of the set this leg belonged to: once a set is won, the board already shows the next one.
  const legs = setScore(state, result.set)

  const perfect = perfectLegDarts(state.config, result)
  let detail: string
  if (perfect) detail = t.leg.perfectDetail(winner.name, result.dartsUsed, finishingDart)
  else if (state.config.type === "x01") detail = t.leg.checkedOut(result.checkout, finishingDart, result.dartsUsed)
  else if (state.config.type === "cricket") detail = t.leg.closedBoard(result.dartsUsed)
  else detail = t.leg.aroundBoard(result.dartsUsed)

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-background/70 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur-md sm:items-center">
      {perfect && <ConfettiBurst />}
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leg-won-title"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="relative z-10 w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl"
      >
        <p className="text-[0.9375rem] font-medium text-primary">{legName(t, state, state.legResults.length - 1)}</p>
        <h2 id="leg-won-title" className={cn("mt-1 font-display text-4xl font-semibold tracking-tight", perfect && "text-warning")}>
          {perfect ? `${t.leg.perfect(perfect)}!` : newSet ? t.leg.winsSet(winner.name) : t.leg.wins(winner.name)}
        </h2>
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">{detail}</p>

        <div className="mt-5 overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-[0.8125rem] text-muted-foreground">
                <th scope="col" className="px-4 py-1.5 font-normal">
                  <span className="sr-only">{t.leaderboard.player}</span>
                </th>
                {sets && (
                  <th scope="col" className="w-16 py-1.5 text-center font-normal">
                    {t.leg.setsHeader}
                  </th>
                )}
                <th scope="col" className="w-20 py-1.5 pr-4 text-right font-normal">
                  {t.leg.legsHeader}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {players.map((player, i) => (
                <tr key={player.id}>
                  <th scope="row" className="px-4 py-2.5 text-[1.0625rem] font-normal [overflow-wrap:anywhere]">
                    {player.name}
                  </th>
                  {sets && <td className="text-center font-display text-2xl font-semibold tabular-nums">{state.setsWon[i]}</td>}
                  <td className="whitespace-nowrap pr-4 text-right font-display text-2xl font-semibold tabular-nums">
                    {legs[i]}
                    <span className="text-base text-muted-foreground"> / {state.config.legsToWin}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button onClick={onNext} className="mt-6 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold" autoFocus>
          {newSet ? t.leg.nextSet(starter.name) : t.leg.next(starter.name)}
        </Button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onUndo} aria-label={t.common.undoLastDart} className="h-11 gap-2 text-[0.9375rem] text-muted-foreground">
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            {t.common.undo}
          </Button>
          <Button variant="ghost" onClick={onReview} className="h-11 gap-2 text-[0.9375rem] text-muted-foreground">
            <History className="h-4 w-4" aria-hidden="true" />
            {t.leg.review}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
