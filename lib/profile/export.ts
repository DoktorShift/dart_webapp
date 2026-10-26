import type { ArchivedMatch } from "../storage/archive.ts"
import { gameValue } from "../storage/stats.ts"
import type { PlayedGame } from "./history.ts"

// The profile's game history as a file (Profil › Konto › Spielverlauf): CSV for spreadsheets
// and other apps, JSON with the games as this device keeps them. Documented in
// docs/data/spielverlauf.md. The CSV uses the semicolon, which spreadsheets in German locales
// expect, and quotes a field where a name could hold one.

export const HISTORY_FORMAT = "blueline-games"
export const HISTORY_VERSION = 1

export interface HistoryLabels {
  columns: readonly string[]
  won: string
  lost: string
  training: string
  imported: string
  local: string
  mode: (match: ArchivedMatch) => string
}

const cell = (value: string) => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

// Newest game first, as the profile lists them. Numbers use the dot, dates are ISO: a file for
// machines first, which every spreadsheet still reads.
export function historyCsv(games: readonly PlayedGame[], labels: HistoryLabels): string {
  const rows: string[][] = [[...labels.columns]]
  for (const { match, seat } of newestFirst(games)) {
    const me = match.players[seat]
    const others = match.players.filter((_, i) => i !== seat).map((p) => p.name.trim())
    const x01 = match.modeType === "x01"
    const average = x01 ? gameValue(match, seat) : null
    rows.push([
      match.finishedAt,
      labels.mode(match),
      me.name.trim(),
      others.join(", "),
      others.length === 0 ? labels.training : me.won ? labels.won : labels.lost,
      String(me.darts),
      x01 ? String(me.points) : "",
      average === null ? "" : average.toFixed(2),
      match.source === "imported-v1" ? labels.imported : labels.local,
    ])
  }
  return rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n"
}

export function historyJson(games: readonly PlayedGame[], exportedAt = new Date()) {
  return {
    format: HISTORY_FORMAT,
    version: HISTORY_VERSION,
    exportedAt: exportedAt.toISOString(),
    matches: newestFirst(games).map((g) => g.match),
  }
}

const newestFirst = (games: readonly PlayedGame[]) => games.slice().sort((a, b) => (Date.parse(b.match.finishedAt) || 0) - (Date.parse(a.match.finishedAt) || 0))

// "blueline-spielverlauf-2026-10-26.csv"
export function historyFileName(base: string, extension: "csv" | "json", now = new Date()) {
  const pad = (n: number) => `${n}`.padStart(2, "0")
  return `${base}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${extension}`
}
