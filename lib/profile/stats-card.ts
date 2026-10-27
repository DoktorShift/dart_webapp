import type { StatsCard } from "../protocol/profile.ts"
import type { ArchivedMatch } from "../storage/archive.ts"
import { summarizePlayer, type StatsOptions } from "../storage/stats.ts"

// The figures a profile shares in its stats card (docs/protocol/families/profile.md), from this
// device's archive: the profile's games against others of every mode, as raw counts. Training
// stays private. Nothing else of a game leaves the device: no opponents, no dates, no single
// results.

export function statsCardOf(matches: readonly ArchivedMatch[], key: string | null, options: Pick<StatsOptions, "aliases" | "sameAs">): StatsCard {
  const summary = (type: "x01" | "cricket" | "clock") => (key ? summarizePlayer(matches, key, { ...options, type, scope: "versus" }) : null)
  const x01 = summary("x01")
  const cricket = summary("cricket")
  const clock = summary("clock")
  const counts = (s: { games: number; versus: number; wins: number }) => ({ games: s.games, versus: s.versus, wins: s.wins })
  return {
    x01:
      x01?.x01 ?
        {
          ...counts(x01),
          darts: x01.x01.darts,
          points: x01.x01.points,
          highestFinish: x01.x01.highestFinish,
          bestLeg: x01.x01.bestLeg,
          visits180: x01.x01.visits180,
          ...(x01.x01.checkoutGames > 0 ? { checkouts: x01.x01.checkouts, dartsAtDouble: x01.x01.dartsAtDouble } : {}),
        }
      : null,
    cricket: cricket?.cricket ? { ...counts(cricket), darts: cricket.cricket.darts, marks: cricket.cricket.marks } : null,
    clock: clock?.clock ? { ...counts(clock), darts: clock.clock.darts, hits: clock.clock.hits } : null,
    refs: [],
  }
}
