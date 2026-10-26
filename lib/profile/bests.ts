import type { ArchivedMatch } from "../storage/archive.ts"
import { matchState, type GamePoint } from "../storage/stats.ts"

// The bests among a player's games, each with the game it happened in, so a screen can name the
// opponent and the date and open the game. Finishes and legs are X01; the best game is the one
// with the highest headline figure of its type.

export interface Best<T> {
  value: T
  match: ArchivedMatch
  seat: number
}

export interface Bests {
  bestGame: Best<number> | null
  highestFinish: Best<number> | null
  // Fewest darts to finish a leg won.
  bestLeg: Best<number> | null
  // Visits of 180, and of 100 to 179, over the games with a throw log; null without any.
  tons180: number | null
  tons100: number | null
  tons140: number | null
}

function pick<T>(points: GamePoint[], value: (p: GamePoint) => T | null, better: (a: T, b: T) => boolean): Best<T> | null {
  let found: Best<T> | null = null
  for (const p of points) {
    const v = value(p)
    if (v !== null && (!found || better(v, found.value))) found = { value: v, match: p.match, seat: p.seat }
  }
  return found
}

export function bestsOf(points: GamePoint[]): Bests {
  const x01 = points.filter((p) => p.match.modeType === "x01")
  let detailed = 0
  let tons180 = 0
  let tons140 = 0
  let tons100 = 0
  for (const p of x01) {
    const st = matchState(p.match)?.stats[p.seat]
    if (!st) continue
    detailed++
    tons180 += st.max180s
    tons140 += st.ton40s
    tons100 += st.tons
  }
  return {
    bestGame: pick(
      points,
      (p) => p.value,
      (a, b) => a > b,
    ),
    highestFinish: pick(
      x01,
      (p) => {
        const finish = matchState(p.match)?.stats[p.seat]?.highestCheckout ?? 0
        return finish > 0 ? finish : null
      },
      (a, b) => a > b,
    ),
    bestLeg: pick(
      x01,
      (p) => {
        const legs = matchState(p.match)?.legResults.filter((r) => r.winner === p.seat) ?? []
        return legs.length > 0 ? Math.min(...legs.map((r) => r.dartsUsed)) : null
      },
      (a, b) => a < b,
    ),
    tons180: detailed > 0 ? tons180 : null,
    tons140: detailed > 0 ? tons140 : null,
    tons100: detailed > 0 ? tons100 : null,
  }
}
