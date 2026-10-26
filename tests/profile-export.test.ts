import { test } from "node:test"
import assert from "node:assert/strict"
import { archivedAt, matchA, matchE } from "./storage-fixtures.ts"
import { gamesOf } from "../lib/profile/history.ts"
import { historyCsv, historyFileName, historyJson } from "../lib/profile/export.ts"
import { playerKey } from "../lib/storage/stats.ts"

// Profil › Konto › Spielverlauf: the games as a file (docs/data/spielverlauf.md).

const A = archivedAt(matchA(), "2026-10-01T20:01:00.000Z")
const E = archivedAt(matchE(), "2026-10-02T20:02:00.000Z")
const labels = { columns: ["Datum", "Spielart", "Spieler", "Gegner", "Ergebnis", "Darts", "Punkte", "Ø 3 Darts", "Quelle"], won: "Gewonnen", lost: "Verloren", training: "Training", imported: "Importiert", local: "BlueLine", mode: (m: { modeName: string }) => m.modeName }

test("history csv: header, one row per game newest first, training marked, semicolons and CRLF", () => {
  const key = playerKey(A, A.players[0], new Map(), new Map())!
  const games = gamesOf([A, E], key)
  const csv = historyCsv(games, labels)
  const lines = csv.split("\r\n")
  assert.equal(lines[0], labels.columns.join(";"))
  assert.equal(lines.length, 4)
  assert.equal(lines.at(-1), "")
  const [date, mode, me, others, result, darts, points, average, source] = lines[1].split(";")
  assert.equal(date, E.finishedAt)
  assert.equal(mode, "Around the Clock")
  assert.equal(me, E.players[0].name)
  assert.equal(others, "")
  assert.equal(result, "Training")
  assert.equal(points, "")
  assert.equal(average, "")
  assert.equal(source, "BlueLine")
  assert.ok(Number(darts) > 0)
  const row = lines[2].split(";")
  assert.equal(row[1], "301")
  assert.equal(row[3], A.players[1].name)
  assert.equal(row[4], A.players[0].won ? "Gewonnen" : "Verloren")
  assert.match(row[7], /^\d+\.\d\d$/)
})

test("history csv: a name with a semicolon or a quote is quoted", () => {
  const match = { ...A, players: [{ ...A.players[0], name: 'Ben "B"; Jr' }, A.players[1]] }
  const csv = historyCsv([{ match, seat: 0 }], labels)
  assert.ok(csv.includes('"Ben ""B""; Jr"'))
})

test("a name that starts like a formula is exported as text, not run by the spreadsheet", () => {
  for (const name of ['=HYPERLINK("https://evil.example","x")', "+1+1", "-2", "@SUM(A1)", "\t=cmd"]) {
    const match = { ...A, players: [{ ...A.players[0], name }, A.players[1]] }
    const csv = historyCsv([{ match, seat: 0 }], labels)
    const row = csv.split("\n")[1]
    assert.ok(row.includes(`"'${name.trim().replace(/"/g, '""')}"`), `${JSON.stringify(name)} in ${row}`)
    assert.ok(!row.split(";").some((c) => /^[=+\-@\t]/.test(c.replace(/^"/, ""))), row)
  }
})

test("history json names its format and carries the games unchanged; file names carry the day", () => {
  const out = historyJson([{ match: A, seat: 0 }], new Date("2026-10-26T10:00:00Z"))
  assert.equal(out.format, "blueline-games")
  assert.equal(out.version, 1)
  assert.deepEqual(out.matches, [A])
  assert.equal(historyFileName("blueline-spielverlauf", "csv", new Date(2026, 9, 26)), "blueline-spielverlauf-2026-10-26.csv")
})
