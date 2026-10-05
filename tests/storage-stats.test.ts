import { test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, BEN } from "./storage-helpers.ts"
import { matchA, matchB, matchD, matchE, matchF, matchG, matchH, matchI, matchJ, recordC } from "./storage-fixtures.ts"
import { ENGINE_VERSION, replay } from "../lib/game/engine.ts"
import type { SavedMatch } from "../lib/game/types.ts"
import { fromV1Record, type ArchivedMatch } from "../lib/storage/archive.ts"
import { computeStandings, headToHead, playerKey, recentPlayerNames, summarizePlayer, summarizePlayers } from "../lib/storage/stats.ts"

// Every expected number below is worked out by hand from the games in storage-fixtures.ts.

let minute = 0
// An archive entry as archiveFinished writes it (the archive itself is tested elsewhere).
function archived(match: SavedMatch): ArchivedMatch {
  const state = replay(match.config, match.throws)
  minute++
  return {
    id: match.id,
    schemaVersion: 1,
    source: "local",
    finishedAt: new Date(Date.UTC(2026, 9, 1, 20, minute)).toISOString(),
    archivedAt: new Date(Date.UTC(2026, 9, 1, 20, minute)).toISOString(),
    startedAt: match.startedAt,
    modeId: match.config.modeId,
    modeName: match.config.modeName,
    modeType: match.config.type,
    config: match.config,
    throws: match.throws,
    engineVersion: ENGINE_VERSION,
    players: match.config.players.map((p, i) => ({
      playerId: p.id,
      name: p.name,
      won: i === state.winner,
      darts: state.stats[i].darts,
      points: match.config.type === "x01" ? state.stats[i].points : 0,
    })),
  }
}

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

test("selections: one game type, without solo games", () => {
  const x01Only = summarizePlayer(all, anna, { type: "x01" })!
  assert.equal(x01Only.games, 2)
  assert.equal(x01Only.cricket, null)
  assert.equal(x01Only.clock, null)
  const noSolo = summarizePlayer(all, anna, { includeSolo: false })!
  assert.equal(noSolo.games, 3)
  assert.equal(noSolo.legsWon, 2)
  assert.equal(noSolo.clock, null)
  assert.equal(summarizePlayer(all, anna, { type: "clock", includeSolo: false }), null)
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

test("the Rangliste: two or more players, imported names apart and marked", () => {
  const standings = computeStandings(all)
  assert.deepEqual(
    standings.map((s) => [s.key, s.matches, s.wins, s.imported]),
    [
      [anna, 3, 2, false],
      ["imported:anna", 1, 1, true],
      [ben, 3, 1, false],
      ["imported:ben", 1, 0, true],
    ],
  )
  close(standings[0].average, 100.4)
  close(standings[1].average, 83.5)
  close(standings[2].average, 90.25)
  close(standings[3].average, (400 / 18) * 3)
  // Solo games never count.
  assert.equal(computeStandings([E]).length, 0)
  // A filter without X01 games has no average.
  assert.equal(computeStandings(all, "cricket")[0].average, null)

  const merged = computeStandings(all, "all", new Map([["anna", ANNA]]))
  assert.equal(merged[0].key, anna)
  assert.equal(merged[0].matches, 4)
  assert.equal(merged[0].includesImported, true)
})

test("empty seats are listed under their label, never as a person", () => {
  const seat = (m: ArchivedMatch, id: string) => ({ ...m, id, players: m.players.map((p, i) => (i === 1 ? { ...p, name: "Spieler 2", unnamed: true, playerId: `pl_${String(i).repeat(32)}` } : p)) })
  const standings = computeStandings([seat(A, "s1"), seat(B, "s2")])
  const row = standings.find((s) => s.unnamed)!
  assert.equal(row.key, "unnamed:spieler 2")
  assert.equal(row.matches, 2)
  assert.equal(row.playerId, null)
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
