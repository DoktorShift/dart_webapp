import { POINTS_PER_WIN } from "./types.ts"
import type { MatchView, StandingRow, Standings, Tiebreak } from "./types.ts"

// Tables for round robin and groups. Order, applied one after the other:
//   1. points (2 per win)
//   2. set difference (only when the matches are played in sets)
//   3. leg difference
//   4. legs won
//   5. head-to-head: wins in the matches among the players still level
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

  // Players level on 1–4 are ordered by head-to-head (wins in the matches among them), then by
  // lot. One pass over the matches counts head-to-head wins for every level group at once.
  const level = new Map<string, number>()
  for (let i = 0, group = 0; i < sorted.length; i++) {
    if (i > 0 && compare(sorted[i - 1], sorted[i]) !== 0) group++
    level.set(sorted[i].participant, group)
  }
  const h2h = new Map(members.map((p) => [p, 0]))
  for (const m of matches) {
    if (!decided(m) || m.affected || m.winner === null) continue
    const a = m.slots[0].participant
    const b = m.slots[1].participant
    if (a !== null && b !== null && level.get(a) !== undefined && level.get(a) === level.get(b)) h2h.set(m.winner, h2h.get(m.winner)! + 1)
  }
  const ordered = sorted
    .sort((a, b) => level.get(a.participant)! - level.get(b.participant)! || h2h.get(b.participant)! - h2h.get(a.participant)! || byLot(a, b))
    .map((row) => ({ row, h2h: h2h.get(row.participant)! }))

  return {
    group: options.group,
    complete,
    rows: ordered.map(({ row, h2h }, i): StandingRow => {
      let decidedBy: Tiebreak | null = null
      if (i > 0 && !row.inactive) {
        const above = ordered[i - 1]
        const differs = criteria.find(([, value]) => value(above.row) !== value(row))
        decidedBy = differs ? differs[0] : above.h2h !== h2h ? "headToHead" : "lot"
      }
      return { ...row, rank: i + 1, decidedBy }
    }),
  }
}
