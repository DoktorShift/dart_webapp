"use client"

import { useState, type ReactNode } from "react"
import { History, MoreHorizontal, X } from "lucide-react"
import { ClockScoreboard, CricketScoreboard, X01Scoreboard } from "@/components/game/scoreboards"
import { VisitPanel } from "@/components/game/visit-panel"
import { ClockPad, CricketPad, VisitTotalPad, X01DartPad } from "@/components/game/keypads"
import { LegWonCard } from "@/components/game/leg-won"
import { CalloutFlash } from "@/components/game/callout"
import { MatchResult } from "@/components/game/match-result"
import { CorrectionSheet, HistorySheet, LeaveSheet, OptionsSheet, ThrowerSheet } from "@/components/game/sheets"
import { useMatchController } from "@/components/game/use-match-controller"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import { replay, visitBySeq } from "@/lib/game/engine"
import { modeName } from "@/lib/i18n"
import { gameSubtitle } from "@/lib/game/words"
import type { AppSettings } from "@/lib/game/storage"
import type { SavedMatch } from "@/lib/game/types"
import { useWakeLock } from "@/hooks/use-wake-lock"
import { cn } from "@/lib/utils"

interface GameScreenProps {
  match: SavedMatch
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  onMatchChange: (match: SavedMatch) => void
  onLeave: (how: "save" | "discard") => void
  onRematch: () => void
  onNewGame: () => void
  onHome: () => void
  onLeaderboard: () => void
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary"
    >
      {children}
    </button>
  )
}

// Share of the screen height the score entry takes in portrait; the scoreboard gets the rest.
const ENTRY_HEIGHT = {
  x01: "h-[clamp(17.75rem,57%,38rem)]",
  cricket: "h-[clamp(9rem,30%,22.5rem)]",
  clock: "h-[clamp(8.5rem,27%,18rem)]",
}

export function GameScreen({
  match,
  settings,
  onSettingsChange,
  onMatchChange,
  onLeave,
  onRematch,
  onNewGame,
  onHome,
  onLeaderboard,
}: GameScreenProps) {
  const t = useT()
  const game = useMatchController({ match, settings, onMatchChange })
  const { state, correction } = game
  const [sheet, setSheet] = useState<"leave" | "history" | "options" | null>(null)
  const [thrower, setThrower] = useState<number | null>(null)

  const type = match.config.type
  const players = match.config.players
  const target = correction ? visitBySeq(state, correction.seq) : undefined
  const correctingTotal = !!target && correction!.seq !== state.visitSeq && target.enteredAsTotal
  const pickingDart = !!correction && correction.slot === null && !correctingTotal
  // Cards over the board step aside while a correction is made, and come back if the leg or game still ends.
  const showLeg = state.winner === null && state.legResults.length > match.acknowledgedLegs && !correction
  const showResult = state.winner !== null && !correction
  const covered = showLeg || showResult
  const entryMode: "dart" | "visit" = correctingTotal
    ? "visit"
    : correction
      ? "dart"
      : type === "x01" && settings.entryMode === "visit" && state.visitDarts.length === 0
        ? "visit"
        : "dart"
  const keyboard = sheet === null && thrower === null && game.plan === null && !covered && !pickingDart
  // Cricket and Around the Clock keep the visit panel next to the keypad in landscape.
  const visitBesidePad = type !== "x01"

  useWakeLock(state.winner === null)

  // Around the Clock: a correction is scored against the number that player was on at the time.
  let clockTarget = state.clockTargets[state.progress[state.current]] ?? 20
  if (type === "clock" && correction?.slot != null && target) {
    const index = target.throwIndexes[correction.slot]
    if (index !== undefined) {
      const before = replay(match.config, match.throws.slice(0, index))
      clockTarget = before.clockTargets[before.progress[target.player]] ?? clockTarget
    }
  }

  // A total is checked against the score at the start of the visit being entered or corrected.
  const totalRemaining =
    correctingTotal && target
      ? replay(match.config, match.throws.slice(0, target.throwIndexes[0])).scores[target.player]
      : state.scores[state.current]

  const canUndo = game.canUndo
  // "No score" fills the rest of the visit; while a dart is corrected it stands for that one dart.
  const dartsLeft = correction ? 1 : 3 - state.visitDarts.length
  const padProps = { onDart: game.onDart, onNoScore: game.onNoScore, onUndo: game.undo, canUndo, keyboard, dartsLeft }
  let pad: ReactNode
  if (type === "cricket") pad = <CricketPad state={state} {...padProps} />
  else if (type === "clock") pad = <ClockPad target={clockTarget} {...padProps} />
  else if (entryMode === "visit")
    pad = (
      <VisitTotalPad
        typed={game.typed}
        setTyped={game.setTyped}
        remaining={totalRemaining}
        doubleOut={match.config.doubleOut}
        askAtDouble={settings.askAtDouble}
        onSubmit={game.onVisit}
        onUndo={game.undo}
        canUndo={canUndo}
        keyboard={keyboard}
      />
    )
  else pad = <X01DartPad {...padProps} />

  const visitPanel = (
    <VisitPanel
      state={state}
      typedTotal={entryMode === "visit" ? game.typed : null}
      correction={correction}
      onSelectSlot={(seq, slot) => game.setCorrection({ seq, slot })}
      onCorrectLast={() => {
        const last = state.legVisits.at(-1)
        if (last) game.startCorrection(last.seq)
      }}
      onCancelCorrection={game.cancelCorrection}
    />
  )

  return (
    <div className="absolute inset-0 flex touch-manipulation select-none flex-col overflow-hidden bg-background">
      <header inert={covered} className="shrink-0 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
        {/* Landscape phones get the compact 32 pt bar iOS uses there: title and subtitle on one line. */}
        <div className="mx-auto grid h-12 max-w-6xl grid-cols-[6rem_minmax(0,1fr)_6rem] items-center px-1.5 xshort:h-8">
          <div>
            <NavButton label={t.game.leave} onClick={() => setSheet("leave")}>
              <X className="h-6 w-6" />
            </NavButton>
          </div>
          <div className="min-w-0 text-center leading-tight xshort:flex xshort:items-baseline xshort:justify-center xshort:gap-2">
            <h1 className="min-w-0 text-[1.0625rem] font-semibold xshort:shrink-0 xshort:text-[0.9375rem]">
              <FitText minScale={0.7}>{modeName(t, match.config.modeId, match.config.modeName)}</FitText>
            </h1>
            <p className="min-w-0 text-[0.75rem] text-muted-foreground xshort:text-[0.8125rem]">
              <FitText minScale={0.7}>{gameSubtitle(t, state)}</FitText>
            </p>
          </div>
          <div className="flex justify-end">
            <NavButton label={t.game.allVisits} onClick={() => setSheet("history")}>
              <History className="h-[22px] w-[22px]" />
            </NavButton>
            <NavButton label={t.game.options} onClick={() => setSheet("options")}>
              <MoreHorizontal className="h-6 w-6" />
            </NavButton>
          </div>
        </div>
      </header>

      {/* One fixed screen: nothing here scrolls. The keypad gets a fixed share of the height,
          the scoreboard gets the rest and sizes its type from it. */}
      <main
        inert={covered}
        className={cn(
          "mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2 overflow-hidden px-3 pb-[max(env(safe-area-inset-bottom),0.625rem)] xshort:pb-[max(env(safe-area-inset-bottom),0.375rem)] tablet:gap-4 tablet:px-6 [@media(min-width:700px)_and_(min-height:700px)_and_(orientation:portrait)]:max-w-4xl",
          "split:grid split:max-w-6xl split:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] split:grid-rows-[minmax(0,1fr)] split:gap-4 split:pl-[max(env(safe-area-inset-left),0.75rem)] split:pr-[max(env(safe-area-inset-right),0.75rem)]",
        )}
      >
        <section aria-label={t.game.scores} data-area="scores" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden tablet:gap-4">
          <div className="relative min-h-0 flex-1 [container-type:size]">
            {type === "x01" && <X01Scoreboard state={state} onSelectPlayer={correction ? undefined : setThrower} />}
            {type === "cricket" && <CricketScoreboard state={state} onSelectPlayer={correction ? undefined : setThrower} />}
            {type === "clock" && <ClockScoreboard state={state} onSelectPlayer={correction ? undefined : setThrower} />}
            <CalloutFlash callout={game.callout} />
          </div>
          <div className={cn("shrink-0", visitBesidePad && "split:hidden")}>{visitPanel}</div>
        </section>

        <section
          aria-label={t.game.scoreEntry}
          data-area="entry"
          className={cn("flex shrink-0 flex-col gap-2 overflow-hidden tablet:gap-3 split:h-auto split:min-h-0", ENTRY_HEIGHT[type])}
        >
          {visitBesidePad && <div className="hidden shrink-0 split:block">{visitPanel}</div>}
          <div inert={pickingDart} className={cn("min-h-0 flex-1 transition-opacity", pickingDart && "opacity-35")}>
            {pad}
          </div>
        </section>
      </main>

      {showLeg && <LegWonCard state={state} onNext={game.acknowledgeLeg} onUndo={game.undo} onReview={() => setSheet("history")} />}

      {showResult && (
        <MatchResult
          state={state}
          onRematch={onRematch}
          onNewGame={onNewGame}
          onHome={onHome}
          onLeaderboard={onLeaderboard}
          onUndo={game.undo}
          onReview={() => setSheet("history")}
        />
      )}

      <LeaveSheet open={sheet === "leave"} onOpenChange={(open) => setSheet(open ? "leave" : null)} onLeave={onLeave} />

      <HistorySheet
        open={sheet === "history"}
        onOpenChange={(open) => setSheet(open ? "history" : null)}
        state={state}
        onSelect={(visit) => {
          setSheet(null)
          game.startCorrection(visit.seq)
        }}
      />

      <OptionsSheet
        open={sheet === "options"}
        onOpenChange={(open) => setSheet(open ? "options" : null)}
        state={state}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onRestartLeg={game.restartLeg}
        onRetire={game.retire}
      />

      <ThrowerSheet
        player={thrower !== null ? players[thrower].name : null}
        legStart={state.legVisits.length === 0}
        onConfirm={() => {
          if (thrower !== null) game.changeThrower(thrower)
          setThrower(null)
        }}
        onCancel={() => setThrower(null)}
      />

      <CorrectionSheet plan={game.plan} state={state} onChoose={game.applyPlan} onCancel={game.dismissPlan} />
    </div>
  )
}
