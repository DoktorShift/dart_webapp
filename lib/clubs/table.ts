import type { SeasonRules } from "../protocol/club.ts"
import type { ClubResultDecision, ClubSeason, ClubState } from "../protocol/club-state.ts"
import type { ClubGame } from "./games.ts"

// A season's table (PLAN.md "Clubs und Saisons"): built from the club's games that fall into the
// season and count under its rules, never from figures someone typed in. Rules (the latest
// version, whose history the club view shows with its reasons):
// - a game belongs to the season when its mode counts and its result was recorded between the
//   season's start and its end;
// - it counts once confirmed as the rules ask (docs/protocol/families/club.md, "Clubspiele"):
//   "none" always; "opponent" once another player with a profile confirmed; "all" once every
//   other player with a profile did (at least one). A dispute stops it, and a game nobody but
//   the recorder could confirm (guests only) waits for a leader. A leader's decision on exactly
//   this result (club.result) overrides all of that;
// - points per win, draw and loss; ties are split by the rules' tiebreak order, step by step
//   within each tied group; what still ties shares the rank;
// - players with fewer games than the minimum are listed apart, without a rank.
// Guests have no profile and no row; their games still count for the members they played.

export interface Standing {
  pubkey: string
  // The name the player had in their latest game here; the club view shows profile names.
  alias: string
  games: number
  wins: number
  draws: number
  losses: number
  points: number
  legsFor: number
  legsAgainst: number
  // X01 three-dart average over the counted games that carry statistics; null without any.
  average: number | null
  // Shared ranks repeat (1, 2, 2, 4); null below the minimum of games.
  rank: number | null
}

export type NotCounted = "confirmations" | "unconfirmable" | "disputed" | "excluded"

export interface SeasonTable {
  season: ClubSeason
  rules: SeasonRules
  ranked: Standing[]
  unranked: Standing[]
  counted: ClubGame[]
  // Games of the season that don't count (yet), and why.
  open: { game: ClubGame; why: NotCounted }[]
}

export const rulesOf = (season: ClubSeason): SeasonRules => season.versions[season.versions.length - 1].rules

export function belongsTo(season: ClubSeason, game: ClubGame): boolean {
  if (!game.result || !rulesOf(season).modes.includes(game.agreement.rules.modeId)) return false
  const end = Math.min(season.ends ?? Infinity, season.endedAt ?? Infinity)
  return game.result.at >= season.starts && game.result.at <= end
}

// Whether a game of the season counts, or why not.
export function countsFor(game: ClubGame, rules: SeasonRules, decision?: ClubResultDecision): true | NotCounted {
  if (decision && decision.result === game.result?.event) return decision.count ? true : "excluded"
  const verdicts = game.agreement.seats
    .map((seat, i) => (seat.pubkey && seat.pubkey !== game.result?.by ? (game.confirmations[i]?.verdict ?? null) : undefined))
    .filter((v) => v !== undefined)
  if (verdicts.includes("dispute")) return "disputed"
  const confirmed = verdicts.filter((v) => v === "confirm").length
  if (rules.confirmations === "none") return true
  if (verdicts.length === 0) return "unconfirmable"
  if (rules.confirmations === "opponent") return confirmed > 0 ? true : "confirmations"
  return confirmed > 0 && confirmed === verdicts.length ? true : "confirmations"
}

function addGame(rows: Map<string, Standing>, game: ClubGame, rules: SeasonRules) {
  const result = game.result!
  const totalLegs = result.legs.reduce((a, b) => a + b, 0)
  game.agreement.seats.forEach((seat, i) => {
    if (!seat.pubkey) return
    const row = rows.get(seat.pubkey) ?? { pubkey: seat.pubkey, alias: seat.alias, games: 0, wins: 0, draws: 0, losses: 0, points: 0, legsFor: 0, legsAgainst: 0, average: null, rank: null }
    const outcome = result.winner === null ? "draw" : result.winner === i ? "win" : "loss"
    row.games += 1
    row.wins += outcome === "win" ? 1 : 0
    row.draws += outcome === "draw" ? 1 : 0
    row.losses += outcome === "loss" ? 1 : 0
    row.points += rules.points[outcome]
    row.legsFor += result.legs[i]
    row.legsAgainst += totalLegs - result.legs[i]
    rows.set(seat.pubkey, row)
  })
}

// Darts and points per player over the counted games with statistics, for the average.
function averages(games: readonly ClubGame[]) {
  const sums = new Map<string, { darts: number; points: number }>()
  for (const game of games) {
    const stats = game.result?.stats
    if (!stats) continue
    game.agreement.seats.forEach((seat, i) => {
      if (!seat.pubkey || !stats.darts[i]) return
      const sum = sums.get(seat.pubkey) ?? { darts: 0, points: 0 }
      sums.set(seat.pubkey, { darts: sum.darts + stats.darts[i], points: sum.points + stats.points[i] })
    })
  }
  return sums
}

// Points first, then the rules' tiebreak order.
type Criterion = "points" | SeasonRules["tiebreak"][number]

// Points the players of a tied group took from their games against each other.
function headToHead(group: readonly Standing[], games: readonly ClubGame[], rules: SeasonRules) {
  const inGroup = new Set(group.map((r) => r.pubkey))
  const mutual = new Map<string, Standing>()
  for (const game of games) {
    const players = game.agreement.seats.filter((s) => s.pubkey && inGroup.has(s.pubkey))
    if (players.length < 2) continue
    addGame(mutual, { ...game, agreement: { ...game.agreement, seats: game.agreement.seats.map((s) => (s.pubkey && inGroup.has(s.pubkey) ? s : { alias: s.alias })) } }, rules)
  }
  return (pubkey: string) => mutual.get(pubkey)?.points ?? 0
}

function measure(criterion: Criterion, group: readonly Standing[], games: readonly ClubGame[], rules: SeasonRules): (row: Standing) => number {
  switch (criterion) {
    case "points":
      return (row) => row.points
    case "wins":
      return (row) => row.wins
    case "legDifference":
      return (row) => row.legsFor - row.legsAgainst
    case "average":
      return (row) => row.average ?? -1
    case "headToHead": {
      const points = headToHead(group, games, rules)
      return (row) => points(row.pubkey)
    }
  }
}

// Orders a group that ties on everything so far by the next criterion, then each new tie by the
// one after it (head to head looks only at the games within the new group). Groups that tie on every criterion come back as one group: a shared rank.
function split(group: Standing[], criteria: readonly Criterion[], games: readonly ClubGame[], rules: SeasonRules): Standing[][] {
  if (group.length < 2 || criteria.length === 0) return [group]
  const value = measure(criteria[0], group, games, rules)
  const byValue = new Map<number, Standing[]>()
  for (const row of group) byValue.set(value(row), [...(byValue.get(value(row)) ?? []), row])
  return [...byValue.entries()].sort(([a], [b]) => b - a).flatMap(([, rows]) => split(rows, criteria.slice(1), games, rules))
}

export function seasonTable(season: ClubSeason, games: readonly ClubGame[], decisions: Readonly<Record<string, ClubResultDecision>> = {}): SeasonTable {
  const rules = rulesOf(season)
  const counted: ClubGame[] = []
  const open: SeasonTable["open"] = []
  for (const game of games) {
    if (!belongsTo(season, game)) continue
    const verdict = countsFor(game, rules, decisions[game.match])
    if (verdict === true) counted.push(game)
    else open.push({ game, why: verdict })
  }
  const rows = new Map<string, Standing>()
  // Oldest first, so each player's alias is the one of their latest game.
  for (const game of [...counted].reverse()) addGame(rows, game, rules)
  for (const [pubkey, sum] of averages(counted)) {
    const row = rows.get(pubkey)
    if (row && sum.darts > 0) row.average = Math.round((sum.points / sum.darts) * 30) / 10
  }
  const all = [...rows.values()].sort((a, b) => a.alias.localeCompare(b.alias) || (a.pubkey < b.pubkey ? -1 : 1))
  const eligible = all.filter((row) => row.games >= rules.minGames)
  const groups = split(eligible, ["points", ...rules.tiebreak], counted, rules)
  let place = 1
  const ranked = groups.flatMap((group) => {
    const rank = place
    place += group.length
    return group.map((row) => ({ ...row, rank }))
  })
  return { season, rules, ranked, unranked: all.filter((row) => row.games < rules.minGames), counted, open }
}

// The season the club plays now: started, not ended. Without one, the next to start.
export function currentSeason(state: ClubState, now: number): ClubSeason | null {
  const seasons = Object.values(state.seasons).filter((s) => !s.ended && (s.ends === undefined || s.ends > now))
  const running = seasons.filter((s) => s.starts <= now).sort((a, b) => b.starts - a.starts)
  return running[0] ?? seasons.sort((a, b) => a.starts - b.starts)[0] ?? null
}
