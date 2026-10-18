import type { MatchConfig } from "../game/types.ts"

// What a tournament game carries in its config (MatchConfig.extras.tournament), so the game
// screen's pieces know the slot it decides and the board scoring it. It names the game itself
// too: a rematch or "play again" copies the config, extras included, and is no tournament game.
// On its own, so the result screen can ask without loading the tournaments.
export interface TournamentExtra {
  id: string
  slot: string
  board: string
  game: string
}

export const EXTRA_ID = "tournament"

// The tournament the game was started for on this board, or null for any other game.
export function tournamentGame(match: { id: string; config: MatchConfig }): TournamentExtra | null {
  const extra = match.config.extras?.[EXTRA_ID] as Partial<TournamentExtra> | undefined
  if (!extra || extra.game !== match.id || typeof extra.id !== "string" || typeof extra.slot !== "string" || typeof extra.board !== "string") return null
  return { id: extra.id, slot: extra.slot, board: extra.board, game: extra.game }
}
