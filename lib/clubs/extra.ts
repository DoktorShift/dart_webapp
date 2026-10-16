import type { MatchConfig } from "../game/types.ts"

// Game setup's extra for a club game (lib/shell/registry.ts "setup.extras"): which club it is
// played for. Saved with the game, so the result knows where to record itself. On its own, so
// the result screen's piece can look without loading the clubs.
export const CLUB_EXTRA = "clubs"

export const clubOf = (config: MatchConfig): string | null => {
  const extra = config.extras?.[CLUB_EXTRA] as { club?: unknown } | undefined
  return typeof extra?.club === "string" && /^[0-9a-f]{64}$/.test(extra.club) ? extra.club : null
}
