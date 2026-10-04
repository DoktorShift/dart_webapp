import { POINTS_PER_WIN } from "./types.ts"
import type { MatchView, StandingRow, Standings, Tiebreak } from "./types.ts"

// Tables for round robin and groups. Order, applied one after the other:
//   1. points (2 per win)
//   2. set difference (only when the matches are played in sets)
//   3. leg difference
//   4. legs won
//   5. head-to-head: wins in the matches among the players still level, step by step
//   6. lot from the draw seed (lotKey), fixed before the first dart
// Withdrawn and disqualified players are listed after everyone still playing. A walkover counts
// as a win for the opponent without legs; when both sides forfeit, both get a loss.

interface TableOptions {
  group: string | null
  sets: boolean
  lot: (participant: string) => string
  inactive: (participant: string) => boolean
}

type Row = Omit<StandingRow, "rank" | "decidedBy">

// A decided match between two players level on criteria 1–4.
interface Game {
  a: string
  b: string
  winner: string
}

const decided = (m: MatchView) => m.state === "finished" || m.state === "walkover"

export function computeStandings(members: string[], matches: MatchView[], options: TableOptions): Standings {
  const rows = new Map<string, Row>(
    members.map((participant) => [
      participant,
      { participant, played: 0, wins: 0, losses: 0, points: 0, legsFor: 0, legsAgainst: 0, setsFor: 0, setsAgainst: 0, inactive: options.inactive(participant) },
    ]),
  )
  let complete = true
  for (const m of matches) {
    if (m.state === "void") continue
    if (!decided(m) || m.affected) {
      complete = false
      continue
    }
    for (let i = 0; i < 2; i++) {
      const p = m.slots[i].participant
      const row = p === null ? undefined : rows.get(p)
      if (!row) continue
      row.played++
      if (m.winner === p) {
        row.wins++
        row.points += POINTS_PER_WIN
      } else row.losses++
      if (m.score) {
        row.legsFor += m.score.legs[i]
        row.legsAgainst += m.score.legs[1 - i]
        if (m.score.sets) {
          row.setsFor += m.score.sets[i]
          row.setsAgainst += m.score.sets[1 - i]
        }
      }
    }
  }

  // Criteria 1–4 as numbers to compare, best first.
  const criteria: [Tiebreak, (r: Row) => number][] = [
    ["points", (r) => r.points],
    ...(options.sets ? [["sets", (r: Row) => r.setsFor - r.setsAgainst] as [Tiebreak, (r: Row) => number]] : []),
    ["legDifference", (r) => r.legsFor - r.legsAgainst],
    ["legsWon", (r) => r.legsFor],
  ]
  const lots = new Map(members.map((p) => [p, options.lot(p)]))
  const byLot = (a: Row, b: Row) => {
    const x = lots.get(a.participant)!
    const y = lots.get(b.participant)!
    return x < y ? -1 : x > y ? 1 : 0
  }
  const compare = (a: Row, b: Row) => {
    if (a.inactive !== b.inactive) return a.inactive ? 1 : -1
    for (const [, value] of criteria) if (value(a) !== value(b)) return value(b) - value(a)
    return 0
  }
  const sorted = [...rows.values()].sort((a, b) => compare(a, b) || byLot(a, b))

  // Players level on 1–4 are ordered by head-to-head, step by step: wins in the matches among
  // them; whoever is still level is compared again on the matches among just themselves (for two
  // players, their direct match). The lot decides only where a step separates nobody. Head-to-head
  // reads only the decided matches between players level on 1–4, collected in one pass.
  const levels: Row[][] = []
  const levelOf = new Map<string, number>()
  sorted.forEach((row, i) => {
    if (i === 0 || compare(sorted[i - 1], row) !== 0) levels.push([])
    levels[levels.length - 1].push(row)
    levelOf.set(row.participant, levels.length - 1)
  })
  const games: Game[] = []
  for (const m of matches) {
    if (!decided(m) || m.affected || m.winner === null) continue
    const a = m.slots[0].participant
    const b = m.slots[1].participant
    if (a !== null && b !== null && levelOf.has(a) && levelOf.get(a) === levelOf.get(b)) games.push({ a, b, winner: m.winner })
  }
  // Rows level so far (in lot order) → runs of rows only the lot orders, best run first.
  const byHeadToHead = (level: Row[], among: Game[]): Row[][] => {
    if (level.length === 1) return [level]
    const wins = new Map(level.map((r) => [r.participant, 0]))
    const inside = among.filter((g) => wins.has(g.a) && wins.has(g.b))
    for (const g of inside) wins.set(g.winner, wins.get(g.winner)! + 1)
    const steps = [...new Set(wins.values())].sort((x, y) => y - x)
    if (steps.length === 1) return [level]
    return steps.flatMap((w) => byHeadToHead(level.filter((r) => wins.get(r.participant) === w), inside))
  }
  const runs = levels.flatMap((level) => byHeadToHead(level, games))
  const ordered = runs.flatMap((run, i) => run.map((row) => ({ row, run: i })))

  return {
    group: options.group,
    complete,
    rows: ordered.map(({ row, run }, i): StandingRow => {
      let decidedBy: Tiebreak | null = null
      if (i > 0 && !row.inactive) {
        const above = ordered[i - 1]
        const differs = criteria.find(([, value]) => value(above.row) !== value(row))
        decidedBy = differs ? differs[0] : above.run !== run ? "headToHead" : "lot"
      }
      return { ...row, rank: i + 1, decidedBy }
    }),
  }
}
