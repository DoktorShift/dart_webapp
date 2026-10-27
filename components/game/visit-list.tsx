"use client"

import { slotLabel, visitResult } from "@/components/game/visit-panel"
import { useT } from "@/components/i18n-provider"
import type { MatchState, Visit } from "@/lib/game/engine"
import { legName } from "@/lib/game/words"
import { cn } from "@/lib/utils"

// The legs of a game that have visits, newest first.
export const playedLegs = (state: MatchState) =>
  [...state.pastLegs.map((visits, leg) => ({ leg, visits })), { leg: state.legIndex, visits: state.legVisits }].filter((l) => l.visits.length > 0).reverse()

// Every visit of a game, newest leg and visit first: who threw, the darts (or the total typed)
// and what it scored. In the running game's history each one can be picked to correct it
// (onSelect); in a finished game's details they are read only.
export function LegVisits({ state, legs = playedLegs(state), onSelect }: { state: MatchState; legs?: ReturnType<typeof playedLegs>; onSelect?: (visit: Visit) => void }) {
  const t = useT()
  const players = state.config.players
  return legs.map(({ leg, visits }) => {
    const result = state.legResults[leg]
    return (
      <section key={leg} aria-label={legName(t, state, leg)}>
        <h3 className="mb-1.5 px-1 text-[0.8125rem] text-muted-foreground">{t.sheets.history.leg(legName(t, state, leg), result ? players[result.winner].name : null)}</h3>
        <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {[...visits].reverse().map((v) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[1.0625rem] font-medium wrap-anywhere">{players[v.player].name}</span>
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    {v.enteredAsTotal ? t.sheets.history.totalOf(v.dartCount) : v.darts.map((d) => slotLabel(state, d, t)).join("  ")}
                    {v.edited && <span className="ml-2 text-warning">{t.sheets.history.corrected}</span>}
                    {v.keptResult && <span className="ml-2 text-warning">{t.sheets.history.kept}</span>}
                  </span>
                </span>
                <span className={cn("shrink-0 text-right text-[0.9375rem] tabular-nums", v.bust && "font-medium text-danger")}>{visitResult(state, v, t)}</span>
              </>
            )
            const layout = "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
            return (
              <li key={v.seq}>
                {onSelect ? (
                  <button type="button" onClick={() => onSelect(v)} className={cn(layout, "active:bg-secondary/70")}>
                    {body}
                  </button>
                ) : (
                  <div className={layout}>{body}</div>
                )}
              </li>
            )
          })}
        </ol>
      </section>
    )
  })
}
