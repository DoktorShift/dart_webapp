import { ENGINE_VERSION, playsSets, replay, type MatchState } from "../game/engine.ts"
import type { GameType, Throw } from "../game/types.ts"
import type { ArchivedMatch, ArchivedPlayer } from "./archive.ts"
import { isUnnamed, nameKey } from "./players.ts"

// Statistics from the archive. Every figure is summed from raw counts (points and darts,
// checkouts and darts at a double) across all games before dividing, so a long game weighs more
// than a short one and averages are never averaged. Nothing is rounded here; screens round.
//
// What the data can't tell stays null, never 0: imported 1.0.0 results have totals but no
// throws, and darts at a double entered as a visit total are known only when they were asked.
// Every figure that needs more than totals says how many games it comes from.

export type StatsFilter = "all" | GameType

// Which games count: those against others ("versus"), those played alone ("training"), or every
// game. Wins and the Rangliste only ever come from games against others; a player's own card and
// form leave training out so that practice never moves the figures they compete with.
export type GameScope = "all" | "versus" | "training"

export interface StatsOptions {
  type?: StatsFilter
  // Games finished in this period (ISO times, "to" not included); open ends when left out.
  from?: string
  to?: string
  scope?: GameScope
  // Imported 1.0.0 name groups the players assigned to someone: name key -> player id.
  aliases?: Map<string, string>
  // Players who are the same person: player id -> the id they count as. Several devices give one
  // profile several player ids; their games add up as one player's.
  sameAs?: Map<string, string>
}

// Who a line of a result belongs to. Players of this version: their stable id. Imported 1.0.0
// results know only names, so each name stays a group of its own ("imported:anna") until the
// players assign it to someone. Empty seats ("Spieler 1") are grouped by that label, as 1.0.0
// did, and never belong to a person. Null for a line without any name.
export function playerKey(match: ArchivedMatch, player: ArchivedPlayer, aliases?: Map<string, string>, sameAs?: Map<string, string>): string | null {
  const key = nameKey(player.name)
  if (!key) return null
  if (player.unnamed || isUnnamed(player.name)) return `unnamed:${key}`
  if (match.source === "imported-v1" || !player.playerId) {
    const alias = aliases?.get(key)
    return alias ? `id:${sameAs?.get(alias) ?? alias}` : `imported:${key}`
  }
  return `id:${sameAs?.get(player.playerId) ?? player.playerId}`
}

const keyKind = (key: string) => key.slice(0, key.indexOf(":"))

// The replayed game, for archive entries with a throw log this engine can score. Cached per entry.
const states = new WeakMap<ArchivedMatch, MatchState | null>()
export function matchState(match: ArchivedMatch): MatchState | null {
  if (states.has(match)) return states.get(match)!
  let state: MatchState | null = null
  if (match.config && match.throws && (match.engineVersion ?? 0) <= ENGINE_VERSION) {
    try {
      state = replay(match.config, match.throws)
    } catch {
      state = null
    }
  }
  states.set(match, state)
  return state
}

// Whether a player's darts at a double are known exactly in a game. Always, when entered dart by
// dart. A visit entered as a total only tells when the players were asked, or when it can't
// have had a dart at a double: no bust, no checkout, and more left than one dart can finish.
// Otherwise the engine estimates, and an estimate is not a measurement.
function doublesMeasured(state: MatchState, throws: Throw[], player: number) {
  const { config } = state
  if (config.type !== "x01") return false
  const oneDartFinish = config.doubleOut ? 50 : 60
  const left = new Map<number, number>()
  for (const visit of [...state.pastLegs.flat(), ...state.legVisits]) {
    if (visit.player !== player) continue
    const before = left.get(visit.leg) ?? config.startScore
    left.set(visit.leg, before - visit.total)
    if (!visit.enteredAsTotal) continue
    const entry = throws[visit.throwIndexes[0]]
    if (entry?.kind === "visit" && typeof entry.atDouble === "number") continue
    if (visit.bust || visit.checkout || before - visit.total <= oneDartFinish) return false
  }
  return true
}

export interface X01Figures {
  games: number
  // Every X01 game counts here, imported totals included.
  darts: number
  points: number
  // Points per three darts.
  average: number | null
  // The rest comes from full throw logs only.
  detailedGames: number
  first9Points: number
  first9Darts: number
  // Points per three darts in the first three visits of each leg.
  first9: number | null
  // Games in which the darts at a double are known (see doublesMeasured).
  checkoutGames: number
  checkouts: number
  dartsAtDouble: number
  checkoutRate: number | null
  highestFinish: number | null
  // Fewest darts in a leg won.
  bestLeg: number | null
  highestVisit: number | null
  visits180: number | null
  // 140 to 179, and 100 to 139, as on the result screen.
  visits140: number | null
  visits100: number | null
}

export interface CricketFigures {
  games: number
  detailedGames: number
  darts: number
  marks: number
  marksPerRound: number | null
}

export interface ClockFigures {
  games: number
  detailedGames: number
  darts: number
  hits: number
  hitRate: number | null
}

export interface PlayerSummary {
  key: string
  // The spelling of the most recent game.
  name: string
  playerId: string | null
  // A group of imported results under a name nobody was assigned.
  imported: boolean
  // Some of the games are imported totals.
  includesImported: boolean
  unnamed: boolean
  games: number
  // Games with two or more players; wins and the win rate count only these.
  versus: number
  wins: number
  winRate: number | null
  lastPlayed: string
  // Games with a full throw log.
  detailedGames: number
  legsPlayed: number | null
  legsWon: number | null
  // From games played in sets.
  setsPlayed: number | null
  setsWon: number | null
  x01: X01Figures | null
  cricket: CricketFigures | null
  clock: ClockFigures | null
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null)
const perThree = (points: number, darts: number) => (darts > 0 ? (points / darts) * 3 : null)
const time = (iso: string) => Date.parse(iso) || 0
const byNewest = (a: ArchivedMatch, b: ArchivedMatch) => time(b.finishedAt) - time(a.finishedAt)

export const isTraining = (match: ArchivedMatch) => match.players.length < 2

function inScope(match: ArchivedMatch, scope: GameScope = "all") {
  return scope === "all" || (scope === "training") === isTraining(match)
}

export function inSelection(match: ArchivedMatch, options: StatsOptions) {
  if (options.type && options.type !== "all" && match.modeType !== options.type) return false
  const finished = time(match.finishedAt)
  if (options.from && finished < time(options.from)) return false
  if (options.to && finished >= time(options.to)) return false
  return inScope(match, options.scope)
}

interface Tally {
  summary: PlayerSummary
  nameAt: number
  legs: { played: number; won: number; setsPlayed: number; setsWon: number; inSets: boolean }
  x01: X01Figures & { maxFinish: number; maxVisit: number; fewest: number; tons: [number, number, number] }
}

function emptyTally(key: string): Tally {
  const kind = keyKind(key)
  return {
    summary: {
      key,
      name: "",
      playerId: kind === "id" ? key.slice(3) : null,
      imported: kind === "imported",
      includesImported: false,
      unnamed: kind === "unnamed",
      games: 0,
      versus: 0,
      wins: 0,
      winRate: null,
      lastPlayed: "",
      detailedGames: 0,
      legsPlayed: null,
      legsWon: null,
      setsPlayed: null,
      setsWon: null,
      x01: null,
      cricket: null,
      clock: null,
    },
    nameAt: -Infinity,
    legs: { played: 0, won: 0, setsPlayed: 0, setsWon: 0, inSets: false },
    x01: {
      games: 0,
      darts: 0,
      points: 0,
      average: null,
      detailedGames: 0,
      first9Points: 0,
      first9Darts: 0,
      first9: null,
      checkoutGames: 0,
      checkouts: 0,
      dartsAtDouble: 0,
      checkoutRate: null,
      highestFinish: null,
      bestLeg: null,
      highestVisit: null,
      visits180: null,
      visits140: null,
      visits100: null,
      maxFinish: 0,
      maxVisit: 0,
      fewest: Infinity,
      tons: [0, 0, 0],
    },
  }
}

function addGame(tally: Tally, match: ArchivedMatch, i: number) {
  const s = tally.summary
  const player = match.players[i]
  const at = time(match.finishedAt)
  if (at > tally.nameAt) {
    tally.nameAt = at
    s.name = player.name.trim()
    s.lastPlayed = match.finishedAt
  }
  s.games++
  if (match.players.length >= 2) {
    s.versus++
    if (player.won) s.wins++
  }
  if (match.source === "imported-v1") s.includesImported = true

  const state = matchState(match)
  const st = state?.stats[i]
  if (state && st) {
    s.detailedGames++
    tally.legs.played += state.legResults.length
    tally.legs.won += state.legResults.filter((r) => r.winner === i).length
    if (playsSets(state.config)) {
      tally.legs.inSets = true
      tally.legs.setsPlayed += state.legResults.filter((r) => r.wonSet).length
      tally.legs.setsWon += state.legResults.filter((r) => r.wonSet && r.winner === i).length
    }
  }

  if (match.modeType === "x01") {
    const x = tally.x01
    x.games++
    if (!state || !st) {
      x.darts += player.darts
      x.points += player.points
      return
    }
    x.darts += st.darts
    x.points += st.points
    x.detailedGames++
    x.first9Points += st.first9Points
    x.first9Darts += st.first9Darts
    if (doublesMeasured(state, match.throws!, i)) {
      x.checkoutGames++
      x.checkouts += st.checkouts
      x.dartsAtDouble += st.dartsAtDouble
    }
    x.maxFinish = Math.max(x.maxFinish, st.highestCheckout)
    x.maxVisit = Math.max(x.maxVisit, st.highestVisit)
    for (const leg of state.legResults) if (leg.winner === i) x.fewest = Math.min(x.fewest, leg.dartsUsed)
    x.tons[0] += st.max180s
    x.tons[1] += st.ton40s
    x.tons[2] += st.tons
  } else if (match.modeType === "cricket") {
    const c = (s.cricket ??= { games: 0, detailedGames: 0, darts: 0, marks: 0, marksPerRound: null })
    c.games++
    if (st) {
      c.detailedGames++
      c.darts += st.darts
      c.marks += st.marks
    }
  } else {
    const c = (s.clock ??= { games: 0, detailedGames: 0, darts: 0, hits: 0, hitRate: null })
    c.games++
    if (st) {
      c.detailedGames++
      c.darts += st.darts
      c.hits += st.hits
    }
  }
}

function finish({ summary: s, legs, x01 }: Tally): PlayerSummary {
  s.winRate = ratio(s.wins, s.versus)
  if (s.detailedGames > 0) {
    s.legsPlayed = legs.played
    s.legsWon = legs.won
  }
  if (legs.inSets) {
    s.setsPlayed = legs.setsPlayed
    s.setsWon = legs.setsWon
  }
  if (x01.games > 0) {
    const { maxFinish, maxVisit, fewest, tons, ...figures } = x01
    const detailed = figures.detailedGames > 0
    s.x01 = {
      ...figures,
      average: perThree(figures.points, figures.darts),
      first9: perThree(figures.first9Points, figures.first9Darts),
      checkoutRate: ratio(figures.checkouts, figures.dartsAtDouble),
      highestFinish: maxFinish > 0 ? maxFinish : null,
      bestLeg: Number.isFinite(fewest) ? fewest : null,
      highestVisit: detailed ? maxVisit : null,
      visits180: detailed ? tons[0] : null,
      visits140: detailed ? tons[1] : null,
      visits100: detailed ? tons[2] : null,
    }
  }
  if (s.cricket) s.cricket.marksPerRound = perThree(s.cricket.marks, s.cricket.darts)
  if (s.clock) s.clock.hitRate = ratio(s.clock.hits, s.clock.darts)
  return s
}

// Summaries are kept per archive array and selection: the profile tab asks for the same figures
// from several places (card, form, stats card), and each full pass replays every throw log once.
// The archive array is replaced, never mutated, when games are added, so identity is the key.
const summaries = new WeakMap<readonly ArchivedMatch[], Map<string, PlayerSummary[]>>()
const selectionKey = (o: StatsOptions) =>
  JSON.stringify([o.type ?? "all", o.from ?? "", o.to ?? "", o.scope ?? "all", o.aliases ? [...o.aliases] : 0, o.sameAs ? [...o.sameAs] : 0])

// Figures for every player in the archive (or the selection), most games first. The result is
// shared between calls with the same archive and selection; treat it as read-only.
export function summarizePlayers(matches: readonly ArchivedMatch[], options: StatsOptions = {}): PlayerSummary[] {
  let cache = summaries.get(matches)
  if (!cache) summaries.set(matches, (cache = new Map()))
  const selection = selectionKey(options)
  const cached = cache.get(selection)
  if (cached) return cached
  const tallies = new Map<string, Tally>()
  for (const match of matches) {
    if (!inSelection(match, options)) continue
    match.players.forEach((player, i) => {
      const key = playerKey(match, player, options.aliases, options.sameAs)
      if (!key) return
      let tally = tallies.get(key)
      if (!tally) tallies.set(key, (tally = emptyTally(key)))
      addGame(tally, match, i)
    })
  }
  const result = Array.from(tallies.values(), finish).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
  cache.set(selection, result)
  return result
}

// One player's figures, or null when they have no game in the selection.
export function summarizePlayer(matches: readonly ArchivedMatch[], key: string, options: StatsOptions = {}) {
  return summarizePlayers(matches, options).find((s) => s.key === key) ?? null
}

// The figure a game type is known by: points per three darts in X01, marks per round in
// Cricket, the hit rate in Around the Clock.
export function headline(summary: PlayerSummary | null, type: GameType): number | null {
  if (!summary) return null
  if (type === "x01") return summary.x01?.average ?? null
  if (type === "cricket") return summary.cricket?.marksPerRound ?? null
  return summary.clock?.hitRate ?? null
}

// ---- Game by game ------------------------------------------------------------------------------

export interface GamePoint {
  match: ArchivedMatch
  seat: number
  // The game's headline figure (see headline) for this player; null when the data can't tell.
  value: number | null
  won: boolean
}

// One game's headline figure for a seat. X01 needs only totals; Cricket and Around the Clock
// need the throw log.
export function gameValue(match: ArchivedMatch, seat: number): number | null {
  const player = match.players[seat]
  if (!player) return null
  const st = matchState(match)?.stats[seat]
  if (match.modeType === "x01") return st ? perThree(st.points, st.darts) : perThree(player.points, player.darts)
  if (!st) return null
  return match.modeType === "cricket" ? perThree(st.marks, st.darts) : ratio(st.hits, st.darts)
}

// A player's games in the selection, newest first, each with its headline figure.
export function gamePoints(matches: readonly ArchivedMatch[], key: string, options: StatsOptions = {}): GamePoint[] {
  const points: GamePoint[] = []
  for (const match of matches) {
    if (!inSelection(match, options)) continue
    const seat = match.players.findIndex((p) => playerKey(match, p, options.aliases, options.sameAs) === key)
    if (seat < 0) continue
    points.push({ match, seat, value: gameValue(match, seat), won: match.players[seat].won })
  }
  return points.sort((a, b) => byNewest(a.match, b.match))
}

// ---- Form -----------------------------------------------------------------------------------

// The form compares the newest games with the same number before them, game by game rather
// than by calendar, so a break never empties the window. Below FORM_MIN games there is no form
// to speak of; the comparison needs a full window before the current one.
export const FORM_MIN = 5

export interface Form {
  // The window's games, oldest first, as a chart reads them.
  points: GamePoint[]
  // The player's games in the selection, all time.
  games: number
  window: number
  // Pooled headline figure over the window, and over the window before it (null without one).
  value: number | null
  before: number | null
  // The player's figures over the window, for screens that show more than the headline.
  summary: PlayerSummary | null
  beforeSummary: PlayerSummary | null
}

export function formOf(matches: readonly ArchivedMatch[], key: string, window: number, options: StatsOptions & { type: GameType }): Form {
  const points = gamePoints(matches, key, options)
  const recent = points.slice(0, window)
  const earlier = points.slice(window, window * 2)
  const pooled = (part: GamePoint[]) => (part.length > 0 ? summarizePlayer(part.map((p) => p.match), key, options) : null)
  const summary = recent.length >= FORM_MIN ? pooled(recent) : null
  const beforeSummary = earlier.length === window ? pooled(earlier) : null
  return {
    points: recent.slice().reverse(),
    games: points.length,
    window,
    value: headline(summary, options.type),
    before: headline(beforeSummary, options.type),
    summary,
    beforeSummary,
  }
}

export interface HeadToHead {
  // Games both played (with or without others).
  games: number
  wins: [number, number]
  // Legs won against each other, from games with a full throw log.
  detailedGames: number
  legs: [number, number] | null
  lastPlayed: string | null
}

// Two players' games against each other, by player key.
export function headToHead(matches: readonly ArchivedMatch[], a: string, b: string, options: StatsOptions = {}): HeadToHead {
  const result: HeadToHead = { games: 0, wins: [0, 0], detailedGames: 0, legs: null, lastPlayed: null }
  const legs: [number, number] = [0, 0]
  for (const match of matches) {
    if (!inSelection(match, { ...options, scope: "versus" })) continue
    const keys = match.players.map((p) => playerKey(match, p, options.aliases, options.sameAs))
    const ia = keys.indexOf(a)
    const ib = keys.indexOf(b)
    if (ia < 0 || ib < 0 || ia === ib) continue
    result.games++
    if (match.players[ia].won) result.wins[0]++
    if (match.players[ib].won) result.wins[1]++
    if (!result.lastPlayed || time(match.finishedAt) > time(result.lastPlayed)) result.lastPlayed = match.finishedAt
    const state = matchState(match)
    if (state) {
      result.detailedGames++
      legs[0] += state.legResults.filter((r) => r.winner === ia).length
      legs[1] += state.legResults.filter((r) => r.winner === ib).length
    }
  }
  if (result.detailedGames > 0) result.legs = legs
  return result
}

// ---- Rangliste --------------------------------------------------------------------------------

export type StandingsSort = "winRate" | "wins" | "average"

export interface StandingsOptions {
  type?: StatsFilter
  from?: string
  to?: string
  // The rank order: win rate (the default), wins, or the X01 average. Ties are broken by the
  // other two, then by name.
  sortBy?: StandingsSort
  // Games against others in the selection a player needs for a rank; below it they are listed
  // apart, so one lucky game never tops the table.
  minGames?: number
  aliases?: Map<string, string>
  sameAs?: Map<string, string>
}

export const STANDINGS_MIN_GAMES = 3

export interface Standing {
  key: string
  name: string
  playerId: string | null
  // Imported 1.0.0 results under a name nobody was assigned.
  imported: boolean
  // Some of the games are imported totals (an assigned name group, or an imported row itself).
  includesImported: boolean
  games: number
  wins: number
  winRate: number
  // Points per three darts across X01 games (not rounded); null without X01 darts.
  average: number | null
  lastPlayed: string
  // Competition rank ("1, 1, 3"); null below the minimum of games.
  rank: number | null
}

export interface Standings {
  ranked: Standing[]
  // Players with fewer games than the minimum, most games first.
  unranked: Standing[]
  // Games against others in the selection, and how many of them had an empty seat.
  games: number
  withEmptySeat: number
  sortBy: StandingsSort
  minGames: number
}

const SORTS: Record<StandingsSort, (s: Standing) => number> = {
  winRate: (s) => s.winRate,
  wins: (s) => s.wins,
  average: (s) => s.average ?? -1,
}

function compareStandings(sortBy: StandingsSort) {
  const order: StandingsSort[] = [sortBy, ...(["winRate", "wins", "average"] as const).filter((k) => k !== sortBy)]
  return (a: Standing, b: Standing) => {
    for (const k of order) {
      const d = SORTS[k](b) - SORTS[k](a)
      if (d !== 0) return d
    }
    return 0
  }
}

// The Rangliste: games with two or more players, built from each result's totals alone (no
// replay), so it stays quick with thousands of games. One profile is one row (sameAs); empty
// seats ("Spieler 2") are nobody and get no row, though the games they sat in still count for
// the named players.
export function computeStandings(matches: readonly ArchivedMatch[], options: StandingsOptions = {}): Standings {
  const sortBy = options.sortBy ?? "winRate"
  const minGames = options.minGames ?? STANDINGS_MIN_GAMES
  const rows = new Map<string, Standing>()
  const totals = new Map<string, { darts: number; points: number; at: number }>()
  let games = 0
  let withEmptySeat = 0
  for (const match of matches) {
    if (!inSelection(match, { ...options, scope: "versus" })) continue
    games++
    const at = time(match.finishedAt)
    let emptySeat = false
    for (const player of match.players) {
      const key = playerKey(match, player, options.aliases, options.sameAs)
      if (!key) continue
      const kind = keyKind(key)
      if (kind === "unnamed") {
        emptySeat = true
        continue
      }
      const row = rows.get(key) ?? {
        key,
        name: player.name.trim(),
        playerId: kind === "id" ? key.slice(3) : null,
        imported: kind === "imported",
        includesImported: false,
        games: 0,
        wins: 0,
        winRate: 0,
        average: null,
        lastPlayed: match.finishedAt,
        rank: null,
      }
      const sum = totals.get(key) ?? { darts: 0, points: 0, at }
      // The most recent game gives the spelling.
      if (at > sum.at) {
        sum.at = at
        row.name = player.name.trim()
        row.lastPlayed = match.finishedAt
      }
      row.games++
      if (player.won) row.wins++
      if (match.source === "imported-v1") row.includesImported = true
      if (match.modeType === "x01") {
        sum.darts += player.darts
        sum.points += player.points
      }
      rows.set(key, row)
      totals.set(key, sum)
    }
    if (emptySeat) withEmptySeat++
  }
  for (const [key, row] of rows) {
    const sum = totals.get(key)!
    row.winRate = row.games > 0 ? row.wins / row.games : 0
    row.average = perThree(sum.points, sum.darts)
  }
  const compare = compareStandings(sortBy)
  const byName = (a: Standing, b: Standing) => a.name.localeCompare(b.name)
  const ranked = Array.from(rows.values())
    .filter((r) => r.games >= minGames)
    .sort((a, b) => compare(a, b) || byName(a, b))
  ranked.forEach((row, i) => {
    row.rank = i > 0 && compare(ranked[i - 1], row) === 0 ? ranked[i - 1].rank : i + 1
  })
  const unranked = Array.from(rows.values())
    .filter((r) => r.games < minGames)
    .sort((a, b) => b.games - a.games || compare(a, b) || byName(a, b))
  return { ranked, unranked, games, withEmptySeat, sortBy, minGames }
}

// Names from recent games, most recent first, for quick picks in setup. Empty seats are left
// out: "Spieler 2" is not somebody to pick.
export function recentPlayerNames(matches: readonly ArchivedMatch[], limit = 12) {
  const seen = new Map<string, string>()
  for (const match of [...matches].sort(byNewest))
    for (const player of match.players) {
      const key = nameKey(player.name)
      if (key && !player.unnamed && !isUnnamed(player.name) && !seen.has(key)) seen.set(key, player.name.trim())
    }
  return Array.from(seen.values()).slice(0, limit)
}
