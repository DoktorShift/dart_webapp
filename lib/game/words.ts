import { modeName, type Messages } from "@/lib/i18n"
import { legPosition, playsSets, setsToWin, type MatchState } from "./engine"
import type { MatchConfig } from "./types"

// A game in words, for the screens that show it.

// "Leg 3", or "Satz 2, Leg 1" in a game with sets.
export const legName = (t: Messages, state: MatchState, leg = state.legIndex) => t.game.legName(legPosition(state, leg))

// The rules in one line: "501, Double In, Double Out, First to 3 Legs".
export function rulesSummary(t: Messages, config: MatchConfig) {
  const parts = [modeName(t, config.modeId, config.modeName)]
  if (config.type === "x01") {
    if (config.doubleIn) parts.push(t.game.doubleIn)
    parts.push(config.doubleOut ? t.game.doubleOut : t.game.singleOut)
  }
  if (config.type === "clock" && config.bullFinish) parts.push(t.game.withBull)
  if (playsSets(config)) parts.push(t.game.formatSets(setsToWin(config), config.legsToWin))
  else if (config.legsToWin > 1) parts.push(t.game.formatLegs(config.legsToWin))
  return parts.join(", ")
}

// The line under the game's title: where the game stands, or its rules when one leg decides it.
export function gameSubtitle(t: Messages, state: MatchState) {
  const c = state.config
  if (playsSets(c)) return legName(t, state)
  if (c.legsToWin > 1) return t.game.legOf(state.legIndex + 1, c.legsToWin)
  if (c.type === "x01") return [c.doubleIn && t.game.doubleIn, c.doubleOut ? t.game.doubleOut : t.game.singleOut].filter(Boolean).join(", ")
  if (c.type === "cricket") return c.cutThroat ? t.game.cutThroat : t.game.cricket
  return c.bullFinish ? t.game.clockBull : t.game.clock
}
