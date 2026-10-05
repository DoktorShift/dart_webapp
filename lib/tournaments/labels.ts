import type { Messages } from "../i18n/index.ts"
import type { MatchView } from "./types.ts"

// The name of a match's round as players know it. Knockout rounds are named from the end
// (final, semi-final, …) by the size of the bracket, so a first round with byes is still the
// quarter-final of a bracket of eight.
export function roundLabel(texts: Messages["tournaments"], m: Pick<MatchView, "bracket" | "group" | "round" | "rounds" | "reset">): string {
  const r = texts.round
  switch (m.bracket) {
    case "group":
      return m.group === null ? r.numbered(m.round) : r.group(m.group, m.round)
    case "final":
      return m.reset ? r.reset : r.grandFinal
    case "winners":
      return m.round === m.rounds ? r.winnersFinal : r.winners(m.round)
    case "losers":
      return m.round === m.rounds ? r.losersFinal : r.losers(m.round)
    case "main":
      return [r.final, r.semiFinal, r.quarterFinal, r.lastSixteen][m.rounds - m.round] ?? r.numbered(m.round)
  }
}
