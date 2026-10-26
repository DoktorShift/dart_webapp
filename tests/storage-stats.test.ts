import { test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN } from "./storage-helpers.ts"
import { archivedAt, matchA, matchB, matchD, matchE, matchF, matchG, matchH, matchI, matchJ, recordC } from "./storage-fixtures.ts"
import type { SavedMatch } from "../lib/game/types.ts"
import { fromV1Record, type ArchivedMatch } from "../lib/storage/archive.ts"
import { computeStandings, formOf, gamePoints, headToHead, playerKey, recentPlayerNames, summarizePlayer, summarizePlayers } from "../lib/storage/stats.ts"
import { trainingBuckets, trainingOf } from "../lib/profile/training.ts"
import { addMonths, periodBounds, startOfDay, startOfMonth, startOfWeek } from "../lib/calendar.ts"

// Every expected number below is worked out by hand from the games in storage-fixtures.ts.

let minute = 0
// Finished a minute after the one before, in the order they are made.
const archived = (match: SavedMatch): ArchivedMatch => archivedAt(match, new Date(Date.UTC(2026, 9, 1, 20, ++minute)).toISOString())

const A = archived(matchA())
const B = archived(matchB())
const C = fromV1Record(recordC())
const D = archived(matchD())
const E = archived(matchE())
const all = [A, B, C, D, E]
const anna = `id:${ANNA}`
const ben = `id:${BEN}`
const close = (actual: number | null | undefined, expected: number) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)

test("players are grouped by id; imported names and empty seats stay groups of their own", () => {
  assert.equal(playerKey(A, A.players[0]), anna)
  assert.equal(playerKey(C, C.players[0]), "imported:anna")
  assert.equal(playerKey(C, C.players[0], new Map([["anna", ANNA]])), anna)
  const seat = { ...A, players: [{ ...A.players[0], name: "Spieler 1", unnamed: true }] }
  assert.equal(playerKey(seat, seat.players[0]), "unnamed:spieler 1")
})

test("one player across X01, Cricket and Around the Clock", () => {
  const s = summarizePlayer(all, anna)!
  assert.equal(s.name, "Anna")
  assert.equal(s.playerId, ANNA)
  // A, B, D and the solo game E; C is an imported name group of its own.
  assert.equal(s.games, 4)
  assert.equal(s.versus, 3)
  assert.equal(s.wins, 2)
  close(s.winRate, 2 / 3)
  assert.equal(s.detailedGames, 4)
  assert.equal(s.legsPlayed, 4)
  assert.equal(s.legsWon, 3)
  assert.equal(s.setsPlayed, null)
  assert.equal(s.includesImported, false)

  const x = s.x01!
  assert.equal(x.games, 2)
  assert.equal(x.darts, 15)
  assert.equal(x.points, 502)
  // (301 + 201) / (6 + 9) × 3, not the mean of 150.5 and 67 (108.75).
  close(x.average, 100.4)
  close(x.first9, 100.4)
  assert.equal(x.checkoutGames, 2)
  assert.equal(x.checkouts, 1)
  assert.equal(x.dartsAtDouble, 1)
  close(x.checkoutRate, 1)
  assert.equal(x.highestFinish, 121)
  assert.equal(x.bestLeg, 6)
  assert.equal(x.highestVisit, 180)
  assert.equal(x.visits180, 1)
  assert.equal(x.visits140, 0)
  // 121 in A and 100 in B.
  assert.equal(x.visits100, 2)

  assert.deepEqual(s.cricket, { games: 1, detailedGames: 1, darts: 8, marks: 21, marksPerRound: 7.875 })
  assert.equal(s.clock!.games, 1)
  assert.equal(s.clock!.hits, 20)
  assert.equal(s.clock!.darts, 24)
  close(s.clock!.hitRate, 20 / 24)
})

test("a checkout whose darts at a double weren't asked leaves the rate unknown, not 0 % or 100 %", () => {
  const x = summarizePlayer(all, ben)!.x01!
  assert.equal(x.darts, 12)
  assert.equal(x.points, 361)
  close(x.average, 90.25)
  close(x.first9, 90.25)
  // Only A counts (dart by dart, never on a double); B's checkout was a visit total.
  assert.equal(x.checkoutGames, 1)
  assert.equal(x.dartsAtDouble, 0)
  assert.equal(x.checkoutRate, null)
  // The finish itself is known.
  assert.equal(x.highestFinish, 135)
  assert.equal(x.bestLeg, 9)
  assert.equal(x.visits140, 1)
  assert.equal(x.visits100, 1)
  // Zero marks in Cricket is a result, not missing data.
  assert.equal(summarizePlayer(all, ben)!.cricket!.marksPerRound, 0)
})

test("imported totals give games, wins and the average, and nothing they don't contain", () => {
  const s = summarizePlayer(all, "imported:anna")!
  assert.equal(s.imported, true)
  assert.equal(s.games, 1)
  assert.equal(s.wins, 1)
  assert.equal(s.detailedGames, 0)
  assert.equal(s.legsPlayed, null)
  assert.equal(s.legsWon, null)
  const x = s.x01!
  close(x.average, 83.5)
  assert.equal(x.first9, null)
  assert.equal(x.checkoutRate, null)
  assert.equal(x.highestFinish, null)
  assert.equal(x.bestLeg, null)
  assert.equal(x.highestVisit, null)
  assert.equal(x.visits180, null)
})

test("an imported name group assigned to a player adds to their totals, weighted by darts", () => {
  const s = summarizePlayer(all, anna, { aliases: new Map([["anna", ANNA]]) })!
  assert.equal(s.games, 5)
  assert.equal(s.wins, 3)
  assert.equal(s.includesImported, true)
  assert.equal(s.detailedGames, 4)
  close(s.x01!.average, (1003 / 33) * 3)
  // Figures that need throws still come from the 2 games that have them.
  close(s.x01!.first9, 100.4)
  assert.equal(s.x01!.detailedGames, 2)
})

test("selections: one game type, against others only, training only", () => {
  const x01Only = summarizePlayer(all, anna, { type: "x01" })!
  assert.equal(x01Only.games, 2)
  assert.equal(x01Only.cricket, null)
  assert.equal(x01Only.clock, null)
  const versus = summarizePlayer(all, anna, { scope: "versus" })!
  assert.equal(versus.games, 3)
  assert.equal(versus.legsWon, 2)
  assert.equal(versus.clock, null)
  assert.equal(summarizePlayer(all, anna, { type: "clock", scope: "versus" }), null)
  const training = summarizePlayer(all, anna, { scope: "training" })!
  assert.equal(training.games, 1)
  assert.equal(training.versus, 0)
  assert.equal(training.winRate, null)
  assert.equal(training.x01, null)
  assert.equal(training.clock!.hits, 20)
})

test("summaries of the same archive and selection are shared, not recomputed", () => {
  assert.equal(summarizePlayers(all, { type: "x01" }), summarizePlayers(all, { type: "x01" }))
  assert.notEqual(summarizePlayers(all, { type: "x01" }), summarizePlayers(all, { type: "x01", scope: "versus" }))
  assert.notEqual(summarizePlayers(all), summarizePlayers([...all]))
})

test("selections: a period of time", () => {
  // C was finished on 1 September, the others on 1 October.
  assert.equal(summarizePlayer(all, "imported:anna", { from: "2026-09-15T00:00:00.000Z" }), null)
  assert.equal(summarizePlayer(all, "imported:anna", { to: "2026-09-15T00:00:00.000Z" })!.games, 1)
  assert.equal(summarizePlayer(all, anna, { from: D.finishedAt })!.games, 2)
  assert.equal(summarizePlayer(all, anna, { from: A.finishedAt, to: D.finishedAt })!.games, 2)
})

test("a bust counts its darts with no points; an average of 0 is known", () => {
  const F = archived(matchF())
  const [a, b] = [summarizePlayer([F], anna)!.x01!, summarizePlayer([F], ben)!.x01!]
  close(a.average, 60.6)
  assert.equal(a.dartsAtDouble, 1)
  close(a.checkoutRate, 1)
  assert.equal(b.average, 0)
  assert.equal(b.first9, 0)
})

test("statistics follow a corrected throw log", () => {
  const G = archived(matchG())
  assert.ok(G.throws!.some((t) => t.edited))
  const x = summarizePlayer([G], anna)!.x01!
  assert.equal(x.points, 141)
  assert.equal(x.darts, 5)
  close(x.average, 84.6)
  assert.equal(x.highestVisit, 100)
})

test("darts at a double from visit totals count only when asked or impossible", () => {
  const asked = summarizePlayer([archived(matchH())], anna)!.x01!
  assert.equal(asked.checkoutGames, 1)
  assert.equal(asked.dartsAtDouble, 2)
  close(asked.checkoutRate, 0.5)

  const notAsked = summarizePlayer([archived(matchI())], anna)!.x01!
  assert.equal(notAsked.checkoutGames, 0)
  assert.equal(notAsked.checkoutRate, null)
  assert.equal(notAsked.highestFinish, 32)

  // 61 from 101 leaves 40: a dart at a double was possible in that visit, and nobody asked.
  const partly = summarizePlayer([archived(matchJ())], anna)!.x01!
  assert.equal(partly.checkoutGames, 0)
  assert.equal(partly.checkoutRate, null)
})

test("head to head", () => {
  assert.deepEqual(headToHead(all, anna, ben), {
    games: 3,
    wins: [2, 1],
    detailedGames: 3,
    legs: [2, 1],
    lastPlayed: D.finishedAt,
  })
  const aliases = new Map([
    ["anna", ANNA],
    ["ben", BEN],
  ])
  const withImported = headToHead(all, anna, ben, { aliases })
  assert.equal(withImported.games, 4)
  assert.deepEqual(withImported.wins, [3, 1])
  assert.deepEqual(withImported.legs, [2, 1])
  assert.deepEqual(headToHead([C], "imported:anna", "imported:ben").legs, null)
})

test("the Rangliste: games against others, by win rate above a minimum, imported names apart and marked", () => {
  const { ranked, unranked, games, withEmptySeat, sortBy, minGames } = computeStandings(all, { minGames: 1 })
  assert.equal(sortBy, "winRate")
  assert.equal(minGames, 1)
  assert.equal(games, 4)
  assert.equal(withEmptySeat, 0)
  assert.deepEqual(unranked, [])
  assert.deepEqual(
    ranked.map((s) => [s.rank, s.key, s.games, s.wins, s.imported]),
    [
      [1, "imported:anna", 1, 1, true],
      [2, anna, 3, 2, false],
      [3, ben, 3, 1, false],
      [4, "imported:ben", 1, 0, true],
    ],
  )
  close(ranked[1].average, 100.4)
  close(ranked[0].average, 83.5)
  close(ranked[2].average, 90.25)
  close(ranked[3].average, (400 / 18) * 3)
  // Training never counts.
  assert.equal(computeStandings([E]).games, 0)
  // A filter without X01 games has no average.
  assert.equal(computeStandings(all, { type: "cricket", minGames: 1 }).ranked[0].average, null)

  const merged = computeStandings(all, { minGames: 1, aliases: new Map([["anna", ANNA]]) })
  assert.equal(merged.ranked[0].key, anna)
  assert.equal(merged.ranked[0].games, 4)
  assert.equal(merged.ranked[0].includesImported, true)
})

test("the Rangliste: the minimum of games, the sort keys and tied ranks", () => {
  // Default minimum 3: the imported one-game rows are listed apart, most games first.
  const byRate = computeStandings(all)
  assert.deepEqual(
    byRate.ranked.map((s) => [s.rank, s.key]),
    [
      [1, anna],
      [2, ben],
    ],
  )
  assert.deepEqual(
    byRate.unranked.map((s) => [s.rank, s.key]),
    [
      [null, "imported:anna"],
      [null, "imported:ben"],
    ],
  )
  // By wins, imported Anna (1 of 1) falls behind Anna (2 of 3); by average, Anna (100.4) leads Ben (90.25).
  assert.deepEqual(
    computeStandings(all, { sortBy: "wins", minGames: 1 }).ranked.map((s) => s.key),
    [anna, "imported:anna", ben, "imported:ben"],
  )
  assert.deepEqual(
    computeStandings(all, { sortBy: "average", minGames: 1 }).ranked.map((s) => s.key),
    [anna, ben, "imported:anna", "imported:ben"],
  )
  // Two rows equal in every key share a rank, and the next rank is skipped ("1, 1, 3").
  const tie = { ...D, id: "d2", players: D.players.map((p) => ({ ...p, won: !p.won })) }
  const tied = computeStandings([D, tie], { minGames: 1 })
  assert.deepEqual(
    tied.ranked.map((s) => [s.rank, s.wins, s.average]),
    [
      [1, 1, null],
      [1, 1, null],
    ],
  )
})

test("the Rangliste: a period", () => {
  // C was finished on 1 September, the others on 1 October.
  const october = computeStandings(all, { from: "2026-09-15T00:00:00.000Z", minGames: 1 })
  assert.deepEqual(
    october.ranked.map((s) => s.key),
    [anna, ben],
  )
  assert.equal(october.games, 3)
  const bounds = periodBounds("today", Date.UTC(2026, 9, 26, 12))
  assert.equal(Date.parse(bounds.from!), startOfDay(Date.UTC(2026, 9, 26, 12)))
  assert.deepEqual(periodBounds("all"), {})
})

test("empty seats are nobody: no row, but their games count for the named players", () => {
  const seat = (m: ArchivedMatch, id: string) => ({ ...m, id, players: m.players.map((p, i) => (i === 1 ? { ...p, name: "Spieler 2", unnamed: true, playerId: `pl_${String(i).repeat(32)}` } : p)) })
  const { ranked, unranked, games, withEmptySeat } = computeStandings([seat(A, "s1"), seat(B, "s2")], { minGames: 2 })
  assert.deepEqual(unranked, [])
  assert.deepEqual(
    ranked.map((s) => [s.key, s.games, s.wins]),
    [[anna, 2, 1]],
  )
  assert.equal(games, 2)
  assert.equal(withEmptySeat, 2)
})

test("game points carry each game's headline figure, newest first", () => {
  const points = gamePoints(all, anna)
  assert.deepEqual(
    points.map((p) => p.match.id),
    [E.id, D.id, B.id, A.id],
  )
  // A: 301 in 6 darts; B: 201 in 9; D: 21 marks in 8 darts; E: 20 of 24.
  close(points[3].value, 150.5)
  close(points[2].value, 67)
  close(points[1].value, 7.875)
  close(points[0].value, 20 / 24)
  assert.deepEqual(
    gamePoints(all, anna, { scope: "versus", type: "x01" }).map((p) => p.won),
    [false, true],
  )
  // Imported totals still give the X01 figure.
  close(gamePoints([C], "imported:anna")[0].value, 83.5)
})

test("the form pools a window of games and compares it with the window before", () => {
  const thin = formOf(all, anna, 10, { type: "x01", scope: "versus" })
  assert.equal(thin.games, 2)
  assert.equal(thin.value, null)
  assert.equal(thin.before, null)
  assert.equal(thin.points.length, 2)
  // Ten X01 games: the newest five pool to one average, the five before to another.
  const games = Array.from({ length: 10 }, (_, i) => archived(i < 5 ? matchB() : matchA())).map((m, i) => ({ ...m, id: `f${i}` }))
  const form = formOf(games, anna, 5, { type: "x01", scope: "versus" })
  assert.equal(form.games, 10)
  assert.equal(form.points.length, 5)
  // The five most recent were made last: A games (150.5) after B games (67).
  close(form.value, 150.5)
  close(form.before, 67)
  assert.deepEqual(
    form.points.map((p) => p.match.id),
    ["f5", "f6", "f7", "f8", "f9"],
  )
  // Nine games: a window of five with only four before it has no comparison.
  assert.equal(formOf(games.slice(1), anna, 5, { type: "x01", scope: "versus" }).before, null)
})

test("training: months, streak and bests from games played alone", () => {
  const now = new Date(2026, 9, 26, 12).getTime()
  const solo = (id: string, when: Date, base = matchE()) => ({ ...archivedAt(base, when.toISOString()), id })
  const games = [
    solo("t1", new Date(2026, 9, 26, 9)),
    solo("t2", new Date(2026, 9, 25, 9)),
    solo("t3", new Date(2026, 9, 24, 9)),
    solo("t4", new Date(2026, 9, 24, 20)),
    // A gap on the 23rd ends the streak.
    solo("t5", new Date(2026, 9, 22, 9)),
    solo("t6", new Date(2026, 8, 10, 9)),
    solo("t7", new Date(2026, 8, 11, 9)),
    archived(matchB()),
  ]
  const clock = trainingOf(games, anna, { type: "clock", now })
  assert.equal(clock.points.length, 7)
  assert.equal(clock.month.games, 5)
  assert.equal(clock.month.days, 4)
  close(clock.month.value, 20 / 24)
  assert.equal(clock.previous.games, 2)
  // Two trainings are too few for a monthly mean.
  assert.equal(clock.previous.value, null)
  assert.equal(clock.streak, 3)
  assert.equal(clock.bests.bestLeg, null)
  close(clock.bests.bestGame!.value, 20 / 24)

  // No training yesterday or today: no streak.
  assert.equal(trainingOf(games, anna, { type: "clock", now: new Date(2026, 9, 28, 12).getTime() }).streak, 0)

  // A training game of X01 never meets the figures against others: B is left out, bests come from the solo leg.
  const aloneA = { ...solo("x", new Date(2026, 9, 20, 9), matchA()), players: [A.players[0]] }
  const x01 = trainingOf([...games, aloneA], anna, { type: "x01", now })
  assert.equal(x01.points.length, 1)
  assert.equal(x01.bests.bestLeg!.value, 6)
  assert.equal(x01.bests.highestFinish!.value, 121)
  assert.equal(x01.bests.tons180, 1)

  const months = trainingBuckets(clock.points, anna, { type: "clock" }, "month", startOfMonth(new Date(2026, 7, 1).getTime()), addMonths(startOfMonth(now), 1))
  assert.deepEqual(
    months.map((b) => [new Date(b.start).getMonth(), b.games, b.value === null ? null : Math.round(b.value * 100)]),
    [
      [7, 0, null],
      [8, 2, null],
      [9, 5, 83],
    ],
  )
  const weeks = trainingBuckets(clock.points, anna, { type: "clock" }, "week", startOfWeek(new Date(2026, 9, 19).getTime()), now)
  assert.equal(weeks.length, 2)
  assert.deepEqual(
    weeks.map((b) => b.games),
    [4, 1],
  )
})

test("recent names skip empty seats and repeat no one", () => {
  const seat = { ...B, players: [B.players[0], { ...B.players[1], name: "Player 2", unnamed: true }] }
  assert.deepEqual(recentPlayerNames([A, seat, C]), ["Anna", "Ben"])
})

test("all players at once, most games first", () => {
  assert.deepEqual(
    summarizePlayers(all).map((s) => s.key),
    [anna, ben, "imported:anna", "imported:ben"],
  )
})
