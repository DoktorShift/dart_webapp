"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceRow } from "@/components/ui/group"
import { Sheet } from "@/components/ui/sheet"
import { LegVisits, playedLegs } from "@/components/game/visit-list"
import { GamePreferences } from "@/components/game-preferences"
import { useT } from "@/components/i18n-provider"
import { useRegistryVersion } from "@/components/nav/use-registry"
import type { CorrectionPlan, MatchState, Visit } from "@/lib/game/engine"
import type { AppSettings } from "@/lib/game/storage"
import type { SavedMatch } from "@/lib/game/types"
import { getGameMenuItems } from "@/lib/shell/registry"
import { legName, rulesSummary } from "@/lib/game/words"
import { cn } from "@/lib/utils"

// Bottom sheets for secondary tasks during a game (HIG: sheets for focused, dismissible tasks).

function Actions({ children }: { children: ReactNode }) {
  return <div className="grid gap-2">{children}</div>
}

const primary = "h-14 rounded-2xl text-[1.0625rem] font-semibold"
const secondary = "h-12 rounded-2xl text-[1.0625rem]"
const rowButton = "flex min-h-12 w-full items-center px-4 text-left text-[1.0625rem] active:bg-secondary/70"

export function LeaveSheet({
  open,
  onOpenChange,
  onLeave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLeave: (how: "save" | "discard") => void
}) {
  const t = useT()
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t.sheets.leave.title} description={t.sheets.leave.description}>
      <Actions>
        <Button onClick={() => onLeave("save")} className={primary}>
          {t.sheets.leave.save}
        </Button>
        <Button variant="secondary" onClick={() => onLeave("discard")} className={cn(primary, "text-danger")}>
          {t.sheets.leave.discard}
        </Button>
        <Button variant="ghost" onClick={() => onOpenChange(false)} className={secondary}>
          {t.sheets.leave.stay}
        </Button>
      </Actions>
    </Sheet>
  )
}

// Every visit of the match, newest leg first, so any of them can be corrected.
export function HistorySheet({
  open,
  onOpenChange,
  state,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: MatchState
  onSelect: (visit: Visit) => void
}) {
  const t = useT()
  const legs = playedLegs(state)

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t.sheets.history.title} description={t.sheets.history.description}>
      {legs.length === 0 ? (
        <p className="pb-4 text-[0.9375rem] text-muted-foreground">{t.sheets.history.empty}</p>
      ) : (
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <LegVisits state={state} legs={legs} onSelect={onSelect} />
        </div>
      )}
      <Button variant="ghost" onClick={() => onOpenChange(false)} className={cn(secondary, "mt-2 w-full shrink-0")}>
        {t.common.done}
      </Button>
    </Sheet>
  )
}

export function ThrowerSheet({
  player,
  legStart,
  onConfirm,
  onCancel,
}: {
  player: string | null
  legStart: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useT()
  return (
    <Sheet
      open={player !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={player ? t.sheets.thrower.title(player) : ""}
      description={legStart ? t.sheets.thrower.legStart : t.sheets.thrower.wrongPlayer}
    >
      <Actions>
        <Button onClick={onConfirm} className={primary}>
          {player ? t.sheets.thrower.confirm(player) : ""}
        </Button>
        <Button variant="ghost" onClick={onCancel} className={secondary}>
          {t.common.cancel}
        </Button>
      </Actions>
    </Sheet>
  )
}

// Shown when a correction removes darts or would change how a finished leg ended.
export function CorrectionSheet({
  plan,
  state,
  onChoose,
  onCancel,
}: {
  plan: CorrectionPlan | null
  state: MatchState
  onChoose: (choice: "keep" | "rescore") => void
  onCancel: () => void
}) {
  const t = useT()
  const kept = plan?.keepResult
  const winner = kept ? state.config.players[kept.winner].name : ""
  const leg = kept ? legName(t, state, kept.leg) : ""
  const texts = t.sheets.correction

  return (
    <Sheet
      open={plan !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={kept ? texts.changesLeg(leg) : texts.apply}
      description={kept ? texts.keptDescription(leg, winner) : plan ? texts.droppedDescription(plan.dropped) : ""}
    >
      <Actions>
        {kept ? (
          <>
            <Button onClick={() => onChoose("keep")} className={primary}>
              {texts.keepWinner(winner)}
            </Button>
            <Button variant="secondary" onClick={() => onChoose("rescore")} className={cn(secondary, "h-auto min-h-12 whitespace-normal py-2 text-center leading-snug")}>
              {texts.rescore(leg, plan?.dropped ?? 0)}
            </Button>
          </>
        ) : (
          <Button onClick={() => onChoose("rescore")} className={primary}>
            {texts.applyButton}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} className={secondary}>
          {t.common.cancel}
        </Button>
      </Actions>
    </Sheet>
  )
}

type OptionsView = "main" | "leaving" | "restart"

const card = "divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"

// The game's settings while it runs: how scores are entered (X01), sounds, the caller. Also
// restarting the leg and a player leaving, which are rare enough to sit one level down, and
// what areas add for other devices (lib/shell/registry.ts). The cards scroll on small phones;
// the tip and Fertig stay put.
export function OptionsSheet({
  open,
  onOpenChange,
  state,
  match,
  settings,
  onSettingsChange,
  onRestartLeg,
  onRetire,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: MatchState
  match: SavedMatch
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  onRestartLeg: () => void
  onRetire: (player: number) => void
}) {
  const t = useT()
  const [view, setView] = useState<OptionsView>("main")
  const players = state.config.players
  // Entries areas added (lib/shell/registry.ts, game menu items), after the game's own.
  useRegistryVersion()
  const extraItems = getGameMenuItems()
  const change = (next: boolean) => {
    onOpenChange(next)
    if (!next) setView("main")
  }

  const texts = t.sheets.options
  const title = view === "leaving" ? texts.leavingTitle : view === "restart" ? texts.restartTitle(legName(t, state)) : texts.title
  const description =
    view === "leaving" ? texts.leavingDescription : view === "restart" ? texts.restartDescription : `${rulesSummary(t, state.config)}.`

  return (
    <Sheet open={open} onOpenChange={change} title={title} description={description}>
      {view === "main" && (
        <>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div className={card}>
              {state.config.type === "x01" && (
                <ChoiceRow
                  title={t.game.entry}
                  options={[
                    { value: "dart", label: t.game.perDart },
                    // Totals start with a new visit.
                    { value: "visit", label: t.game.perVisit, disabled: state.visitDarts.length > 0 },
                  ]}
                  value={settings.entryMode}
                  onChange={(entryMode) => onSettingsChange({ ...settings, entryMode })}
                />
              )}
              <GamePreferences
                settings={settings}
                onSettingsChange={onSettingsChange}
                showAskAtDouble={state.config.type === "x01" && state.config.doubleOut && settings.entryMode === "visit"}
              />
            </div>
            <div className={cn(card, "mt-3")}>
              <button type="button" onClick={() => setView("restart")} className={cn(rowButton, "text-primary")}>
                {texts.restartLeg}
              </button>
              {state.active.filter(Boolean).length > 1 && (
                <button type="button" onClick={() => setView("leaving")} className={cn(rowButton, "text-primary")}>
                  {texts.playerLeaves}
                </button>
              )}
            </div>
            {extraItems.length > 0 && (
              <section className="mt-4" aria-label={texts.devices}>
                <h3 className="mb-1.5 px-1 text-[0.8125rem] text-muted-foreground">{texts.devices}</h3>
                <div className={card}>
                  {extraItems.map(({ id, label, icon: Icon, onSelect }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        change(false)
                        onSelect({ match })
                      }}
                      className={cn(rowButton, "gap-3 text-primary")}
                    >
                      {Icon && <Icon className="h-5 w-5 shrink-0" aria-hidden />}
                      {label(t)}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
          <p className="mt-3 shrink-0 px-1 text-[0.8125rem] text-muted-foreground">{texts.tip}</p>
          <Button variant="ghost" onClick={() => change(false)} className={cn(secondary, "mt-2 w-full shrink-0")}>
            {t.common.done}
          </Button>
        </>
      )}

      {view === "restart" && (
        <Actions>
          <Button
            onClick={() => {
              onRestartLeg()
              change(false)
            }}
            className={primary}
          >
            {texts.restartButton}
          </Button>
          <Button variant="ghost" onClick={() => setView("main")} className={secondary}>
            {t.common.back}
          </Button>
        </Actions>
      )}

      {view === "leaving" && (
        <Actions>
          <div className={card}>
            {players.map((p, i) =>
              state.active[i] ? (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onRetire(i)
                    change(false)
                  }}
                  className={cn(rowButton, "wrap-anywhere")}
                >
                  {p.name}
                </button>
              ) : null,
            )}
          </div>
          <Button variant="ghost" onClick={() => setView("main")} className={secondary}>
            {t.common.back}
          </Button>
        </Actions>
      )}
    </Sheet>
  )
}
