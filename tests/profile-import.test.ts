import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage, ANNA } from "./storage-helpers.ts"
import { archivedAt, matchA, matchE } from "./storage-fixtures.ts"
import { gamesOf } from "../lib/profile/history.ts"
import { historyCsv, historyJson } from "../lib/profile/export.ts"
import { parseCsv, parseDate, parseMode, readHistoryFile } from "../lib/profile/import.ts"
import { loadArchive } from "../lib/storage/archive.ts"
import { importMatches } from "../lib/storage/data.ts"
import { assignImportedName, importedAliases, listPlayers, newPlayerRecord, savePlayers } from "../lib/storage/players.ts"
import { computeStandings, playerKey, summarizePlayer } from "../lib/storage/stats.ts"

// Profil › Konto › Spielverlauf › Importieren (docs/data/spielverlauf.md): the files this app
// writes come back in, a table with the same columns from elsewhere too, and nothing counts
// twice.

beforeEach(resetStorage)

const labelsDe = { columns: ["Datum", "Spielart", "Spieler", "Gegner", "Ergebnis", "Darts", "Punkte", "Ø 3 Darts", "Quelle"], won: "Gewonnen", lost: "Verloren", training: "Training", imported: "Importiert", local: "BlueLine", mode: (m: { modeName: string }) => m.modeName }
const labelsEn = { ...labelsDe, columns: ["Date", "Game type", "Player", "Opponents", "Result", "Darts", "Points", "3-dart avg", "Source"], won: "Won", lost: "Lost" }

const A = archivedAt(matchA(), "2026-10-01T20:01:00.000Z")
const E = archivedAt(matchE(), "2026-10-02T20:02:00.000Z")
const annaKey = () => playerKey(A, A.players[0], new Map(), new Map())!

test("the app's own CSV comes back as games: a game against Ben and a training, in either language", () => {
  for (const labels of [labelsDe, labelsEn]) {
    const csv = historyCsv(gamesOf([A, E], annaKey()), labels)
    const result = readHistoryFile(csv)
    assert.ok(result.ok)
    const { file } = result
    assert.equal(file.kind, "csv")
    assert.equal(file.matches.length, 2)
    assert.equal(file.skipped, 0)
    const [training, versus] = file.matches
    assert.equal(training.modeType, "clock")
    assert.equal(training.players.length, 1)
    assert.equal(training.source, "imported-file")
    assert.equal(versus.modeType, "x01")
    assert.equal(versus.modeId, "301")
    assert.equal(versus.players.length, 2)
    assert.equal(versus.players[0].name, A.players[0].name)
    assert.equal(versus.players[0].won, A.players[0].won)
    assert.equal(versus.players[1].won, !A.players[0].won)
    assert.equal(versus.players[0].darts, A.players[0].darts)
    assert.equal(versus.players[0].points, A.players[0].points)
    assert.equal(versus.finishedAt, A.finishedAt)
    assert.deepEqual(
      file.names.map((n) => n.name),
      [A.players[0].name, A.players[1].name],
    )
    assert.equal(file.from, A.finishedAt)
    assert.equal(file.to, E.finishedAt)
  }
})

test("the same row always gets the same id, so a second import adds nothing", () => {
  const csv = historyCsv(gamesOf([A], annaKey()), labelsDe)
  const first = readHistoryFile(csv)
  const second = readHistoryFile(csv)
  assert.ok(first.ok && second.ok)
  assert.equal(first.file.matches[0].id, second.file.matches[0].id)
  assert.match(first.file.matches[0].id, /^file-[0-9a-f]{16}$/)
})

test("a table from elsewhere: comma separated, German dates, plain result words, unknown rows skipped", () => {
  const csv = [
    "Date,Game,Player,Opponent,Result,Darts,Points",
    "26.10.2026 19:41,501,Anna,Ben,W,45,501",
    '"05.03.2025",501 Double Out,"Anna","Ben, Carla",L,60,420',
    "2026-01-02,Cricket,Anna,Ben,won,30,0",
    "2026-01-03,Shanghai,Anna,Ben,won,30,0",
    "2026-01-04,501,Anna,Ben,maybe,30,100",
    "2026-01-05,501,Anna,,,,",
    "2026-01-06,501,Anna,Ben,,30,100",
    "2026-01-07,501,Anna,Ben,W,30,",
    "",
  ].join("\n")
  const result = readHistoryFile(csv)
  assert.ok(result.ok)
  const { file } = result
  assert.equal(file.matches.length, 4)
  // Shanghai is no game type here, "maybe" and an empty cell are no result, a row without darts
  // is no game.
  assert.equal(file.skipped, 4)
  const [win, loss, cricket, noPoints] = file.matches
  assert.equal(win.finishedAt, new Date(2026, 9, 26, 19, 41).toISOString())
  assert.equal(win.players[0].won, true)
  assert.equal(win.players[1].won, false)
  assert.equal(loss.modeId, "501")
  assert.equal(loss.players.length, 3)
  assert.ok(loss.players.every((p) => !p.won))
  assert.equal(cricket.modeType, "cricket")
  assert.equal(cricket.players[0].points, 0)
  // An X01 row without points counts as a game won, with no average to it.
  assert.equal(noPoints.players[0].won, true)
  assert.deepEqual([noPoints.players[0].darts, noPoints.players[0].points], [0, 0])
  assert.deepEqual(
    file.names.map((n) => `${n.name}:${n.games}`),
    ["Anna:4", "Ben:4", "Carla:1"],
  )
})

test("csv cells: quotes, doubled quotes and separators inside quotes, CRLF", () => {
  assert.deepEqual(parseCsv('a;b\r\n"x;y";"he said ""hi"""\r\n'), [
    ["a", "b"],
    ["x;y", 'he said "hi"'],
  ])
  assert.deepEqual(parseCsv("a,b\n1,2"), [
    ["a", "b"],
    ["1", "2"],
  ])
})

test("dates and game types from other tables", () => {
  assert.equal(parseDate("2026-10-26T18:00:00.000Z"), "2026-10-26T18:00:00.000Z")
  assert.equal(parseDate("26.10.2026"), new Date(2026, 9, 26, 12).toISOString())
  assert.equal(parseDate("2026-10-26"), new Date(2026, 9, 26, 12).toISOString())
  assert.equal(parseDate("2026-10-26 19:41"), new Date(2026, 9, 26, 19, 41).toISOString())
  assert.equal(parseDate("yesterday"), null)
  // A misaligned column of numbers is no date.
  assert.equal(parseDate("12"), null)
  assert.equal(parseDate("45"), null)
  assert.deepEqual(parseMode("701"), { id: "701", name: "701", type: "x01" })
  assert.deepEqual(parseMode("X01 501"), { id: "501", name: "501", type: "x01" })
  assert.equal(parseMode("500"), null)
  assert.equal(parseMode("Around the Clock")?.type, "clock")
  assert.equal(parseMode("Rund um die Uhr")?.type, "clock")
  assert.equal(parseMode("Cricket Cut Throat")?.type, "cricket")
})

test("the app's JSON files come back whole, the device data file for its games", () => {
  const games = readHistoryFile(JSON.stringify(historyJson(gamesOf([A, E], annaKey()))))
  assert.ok(games.ok)
  assert.equal(games.file.kind, "json")
  assert.deepEqual(games.file.matches.map((m) => m.id).sort(), [A.id, E.id].sort())
  // A full game stays a full game.
  assert.ok(games.file.matches.find((m) => m.id === A.id)?.throws)
  const device = readHistoryFile(JSON.stringify({ format: "blueline-data", version: 1, exportedAt: "2026-10-26T00:00:00.000Z", matches: [A], players: [], v1: {}, v1Snapshot: null, sections: {} }))
  assert.ok(device.ok && device.file.matches.length === 1)
  // The JSON's games keep their player ids until the import, which knows this device's directory.
  assert.equal(device.file.matches[0].players[0].playerId, A.players[0].playerId)
  const newer = readHistoryFile(JSON.stringify({ format: "blueline-games", version: 99, matches: [] }))
  assert.deepEqual(newer, { ok: false, reason: "newer" })
})

test("what is no history file says so", () => {
  assert.deepEqual(readHistoryFile("{}"), { ok: false, reason: "format" })
  assert.deepEqual(readHistoryFile("hello"), { ok: false, reason: "format" })
  assert.deepEqual(readHistoryFile("Name;Punkte\nAnna;3"), { ok: false, reason: "format" })
  assert.deepEqual(readHistoryFile(labelsDe.columns.join(";") + "\r\n"), { ok: false, reason: "format" })
  assert.deepEqual(readHistoryFile(labelsDe.columns.join(";") + "\r\nnot;a;game;;;;;;\r\n"), { ok: false, reason: "empty" })
})

test("importing writes the games once, marks them imported, and the chosen name counts for the player", async () => {
  await savePlayers([newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA)])
  const csv = historyCsv(gamesOf([A, E], annaKey()), labelsDe)
  const read = readHistoryFile(csv)
  assert.ok(read.ok)
  const first = await importMatches(read.file.matches)
  assert.deepEqual(first, { added: 2, completed: 0, known: 0 })
  const again = await importMatches(read.file.matches)
  assert.deepEqual(again, { added: 0, completed: 0, known: 2 })
  const archive = await loadArchive()
  assert.equal(archive.length, 2)
  assert.ok(archive.every((m) => m.source === "imported-file"))

  // Before the name is assigned, Anna's imported games stand under their own key.
  const standings = computeStandings(archive, { minGames: 1 })
  const annaRow = [...standings.ranked, ...standings.unranked].find((s) => s.name === "Anna")
  assert.ok(annaRow?.imported)
  assert.ok(annaRow.includesImported)

  await assignImportedName("Anna", ANNA)
  const aliases = importedAliases(await listPlayers())
  const summary = summarizePlayer(archive, `id:${ANNA}`, { aliases, scope: "all" })
  assert.equal(summary?.games, 2)
  assert.equal(summary?.versus, 1)
  assert.equal(summary?.includesImported, true)
  // Totals only: the average counts, the first 9 and the checkout rate are unknown.
  assert.ok(summary?.x01?.average)
  assert.equal(summary?.x01?.first9, null)
  assert.equal(summary?.x01?.checkoutRate, null)
})

test("a game that is already here, played or synced, is not added again from a table", async () => {
  await importMatches([A])
  const csv = historyCsv(gamesOf([A, E], annaKey()), labelsDe)
  const read = readHistoryFile(csv)
  assert.ok(read.ok)
  assert.deepEqual(await importMatches(read.file.matches), { added: 1, completed: 0, known: 1 })
  const archive = await loadArchive()
  assert.equal(archive.length, 2)
  assert.equal(archive.find((m) => m.id === A.id)?.source, "local")
})

test("games from another device's JSON go by their names here, so 'that's me' reaches them", async () => {
  // This device knows an Anna of its own; A's seats carry the other device's player ids.
  const HERE = `pl_${"c".repeat(32)}`
  await savePlayers([newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", HERE)])
  assert.ok(A.players.every((p) => p.playerId && p.playerId !== HERE))
  const read = readHistoryFile(JSON.stringify(historyJson(gamesOf([A], annaKey()))))
  assert.ok(read.ok)
  assert.deepEqual(await importMatches(read.file.matches), { added: 1, completed: 0, known: 0 })
  const archive = await loadArchive()
  assert.ok(archive[0].players.every((p) => p.playerId === null))
  await assignImportedName("Anna", HERE)
  const summary = summarizePlayer(archive, `id:${HERE}`, { aliases: importedAliases(await listPlayers()), scope: "all" })
  assert.equal(summary?.games, 1)
})
