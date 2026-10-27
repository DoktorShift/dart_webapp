import type { GameType } from "../game/types.ts"
import { ARCHIVE_SCHEMA, type ArchivedMatch, type ArchivedPlayer } from "../storage/archive.ts"
import { EXPORT_FORMAT, EXPORT_VERSION, parseArchivedMatch } from "../storage/data.ts"
import { isUnnamed, nameKey } from "../storage/players.ts"
import { HISTORY_FORMAT, HISTORY_VERSION } from "./export.ts"

// Reading a game history from a file (Profil › Konto › Spielverlauf › Importieren): the files
// this app writes (docs/data/spielverlauf.md: the CSV in either language, the games JSON, the
// device's data file) and a CSV with the same columns from elsewhere. Nothing is written here:
// the caller shows what was found and asks before anything counts (lib/storage/data.ts
// importMatches). Imported games know names and totals only, so they count like the results of
// 1.0.0: the average yes, first 9 and checkout no.

export interface HistoryName {
  name: string
  games: number
}

export interface HistoryFile {
  kind: "csv" | "json"
  matches: ArchivedMatch[]
  // Rows or entries that weren't a game.
  skipped: number
  // Rows alike in every fact, taken as one game.
  merged: number
  // The names in the file with their games, most games first; empty seats left out.
  names: HistoryName[]
  // Oldest and newest game (ISO), null without games.
  from: string | null
  to: string | null
}

export type HistoryFileResult =
  | { ok: true; file: HistoryFile }
  // "format": neither a file of this app nor a CSV with the known columns. "empty": nothing in it
  // was a game. "newer": written by a newer version of this app.
  | { ok: false; reason: "format" | "empty" | "newer" | "large" }

// A long history is some thousand games; a file beyond this isn't one.
const MAX_ROWS = 50_000
const MAX_NAME = 100

export function readHistoryFile(text: string, now = new Date()): HistoryFileResult {
  const trimmed = text.replace(/^﻿/, "").trimStart()
  const result = trimmed.startsWith("{") || trimmed.startsWith("[") ? readJson(trimmed) : readCsv(trimmed, now)
  if (!result.ok) return result
  // One game per id: the same row twice (or two trainings alike in every fact) is one game.
  const byId = new Map<string, ArchivedMatch>()
  for (const match of result.file.matches) if (!byId.has(match.id)) byId.set(match.id, match)
  const matches = [...byId.values()]
  if (matches.length === 0) return { ok: false, reason: "empty" }
  return { ok: true, file: { ...result.file, matches, merged: result.file.matches.length - matches.length, names: namesIn(matches), ...span(matches) } }
}

// ---- JSON: the files this app writes ---------------------------------------------------------

function readJson(text: string): HistoryFileResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: "format" }
  }
  if (!isObject(value) || !Array.isArray(value.matches)) return { ok: false, reason: "format" }
  const version = value.version
  if (value.format === HISTORY_FORMAT) {
    if (typeof version !== "number" || version > HISTORY_VERSION) return { ok: false, reason: "newer" }
  } else if (value.format === EXPORT_FORMAT) {
    if (typeof version !== "number" || version > EXPORT_VERSION) return { ok: false, reason: "newer" }
  } else return { ok: false, reason: "format" }
  const matches: ArchivedMatch[] = []
  let skipped = Math.max(0, value.matches.length - MAX_ROWS)
  for (const raw of value.matches.slice(0, MAX_ROWS)) {
    const match = parseArchivedMatch(raw)
    if (match) matches.push(match)
    else skipped++
  }
  return { ok: true, file: { kind: "json", matches, skipped, merged: 0, names: [], from: null, to: null } }
}

// ---- CSV: the documented columns -------------------------------------------------------------

type Column = "date" | "mode" | "player" | "opponents" | "result" | "darts" | "points"

// The column names this app writes (German and English) and the plain words other tables use.
const HEADERS: Record<Column, string[]> = {
  date: ["datum", "date", "ende", "finished", "finished at", "zeit", "time", "played", "gespielt"],
  mode: ["spielart", "game type", "gametype", "game", "mode", "modus", "spiel", "type"],
  player: ["spieler", "player", "name", "you", "du"],
  opponents: ["gegner", "opponents", "opponent", "against", "vs", "vs."],
  result: ["ergebnis", "result", "outcome", "won", "gewonnen", "sieg", "win"],
  darts: ["darts", "dart", "würfe", "throws"],
  points: ["punkte", "points", "score", "scored"],
}

const WON = new Set(["gewonnen", "won", "win", "w", "sieg", "1", "true", "ja", "yes", "x"])
const LOST = new Set(["verloren", "lost", "loss", "l", "niederlage", "0", "false", "nein", "no"])
const TRAINING = new Set(["training", "solo", "allein", "alone", "practice", "übung"])

function readCsv(text: string, now: Date): HistoryFileResult {
  const rows = parseCsv(text)
  if (rows.length === 0) return { ok: false, reason: "format" }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const index = (column: Column) => header.findIndex((h) => HEADERS[column].includes(h))
  const at: Record<Column, number> = { date: index("date"), mode: index("mode"), player: index("player"), opponents: index("opponents"), result: index("result"), darts: index("darts"), points: index("points") }
  if (at.date < 0 || at.mode < 0 || at.player < 0 || at.darts < 0) return { ok: false, reason: "format" }
  // The right columns and no rows: a table without games, not a strange file.
  const matches: ArchivedMatch[] = []
  let skipped = Math.max(0, rows.length - 1 - MAX_ROWS)
  for (const row of rows.slice(1, MAX_ROWS + 1)) {
    if (row.every((cell) => cell.trim() === "")) continue
    const cell = (column: Column) => (at[column] >= 0 ? (row[at[column]] ?? "").trim() : "")
    const match = rowToMatch({ date: cell("date"), mode: cell("mode"), player: cell("player"), opponents: cell("opponents"), result: cell("result"), darts: cell("darts"), points: cell("points") }, at.result >= 0, now)
    if (match) matches.push(match)
    else skipped++
  }
  return { ok: true, file: { kind: "csv", matches, skipped, merged: 0, names: [], from: null, to: null } }
}

// Fields split at the separator the header uses (semicolon, comma or tab), quotes respected,
// a quoted field may hold the separator, a quote written twice, or a line break.
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const counts = [";", ",", "\t"].map((s) => [s, firstLine.split(s).length - 1] as const)
  const separator = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ";"
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === separator) {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += ch
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

interface Cells {
  date: string
  mode: string
  player: string
  opponents: string
  result: string
  darts: string
  points: string
}

function rowToMatch(cells: Cells, hasResult: boolean, now: Date): ArchivedMatch | null {
  const finishedAt = parseDate(cells.date)
  const mode = parseMode(cells.mode)
  const name = cells.player.trim().slice(0, MAX_NAME)
  let darts = count(cells.darts)
  if (!finishedAt || !mode || !name || darts === null) return null
  // An X01 row without points: the game counts (played, won), its average stays unknown rather
  // than reading as 0; so its darts stay unknown too.
  let points = mode.type === "x01" ? count(cells.points) : 0
  if (points === null) {
    if (cells.points.trim() !== "") return null
    points = 0
    darts = 0
  }
  const others = cells.opponents
    .split(/[,;/]| & | und | and /)
    .map((n) => n.trim().slice(0, MAX_NAME))
    .filter((n) => n !== "")
  const result = cells.result.trim().toLowerCase()
  const training = others.length === 0 || TRAINING.has(result)
  // A game against others needs to say who won; an empty cell or a word nobody knows is no
  // result, and such a row is no game.
  let won = false
  if (!training) {
    if (!hasResult) return null
    if (WON.has(result)) won = true
    else if (!LOST.has(result)) return null
  }
  const seat = (n: string, w: boolean, d: number, p: number): ArchivedPlayer => ({ playerId: null, name: n, ...(isUnnamed(n) ? { unnamed: true } : {}), won: w, darts: d, points: p })
  const players = training ? [seat(name, false, darts, points)] : [seat(name, won, darts, points), ...others.map((n) => seat(n, !won && others.length === 1, 0, 0))]
  const id = `file-${hash(`${finishedAt}|${mode.id}|${players.map((p) => `${p.name}:${p.won ? 1 : 0}`).join(",")}|${darts}|${points}`)}`
  return {
    id,
    schemaVersion: ARCHIVE_SCHEMA,
    source: "imported-file",
    finishedAt,
    archivedAt: now.toISOString(),
    startedAt: null,
    modeId: mode.id,
    modeName: mode.name,
    modeType: mode.type,
    config: null,
    throws: null,
    engineVersion: null,
    players,
  }
}

// ISO 8601, "26.10.2026 19:41" or "2026-10-26 19:41"; a date alone is noon, so it keeps its day
// in every time zone.
export function parseDate(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t)
  if (german) {
    const [, d, m, y, hh, mm, ss] = german
    const date = hh === undefined ? new Date(Number(y), Number(m) - 1, Number(d), 12) : new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? 0))
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  // Anything else must at least start like ISO 8601: Date.parse alone reads "12" as a year.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) return null
  const ms = Date.parse(t.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, "$1T$2"))
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

// "501", "501 Double Out", "Cricket", "Around the Clock" and the like.
export function parseMode(text: string): { id: string; name: string; type: GameType } | null {
  const t = text.trim()
  const lower = t.toLowerCase()
  if (!t) return null
  if (/cricket/.test(lower)) return { id: "cricket", name: "Cricket", type: "cricket" }
  if (/clock|around|rund um die uhr/.test(lower)) return { id: "clock", name: "Around the Clock", type: "clock" }
  const score = /^(?:x01\s*)?(\d{3,4})\b/.exec(lower) ?? /\b(\d{3,4})\b/.exec(lower)
  if (score && Number(score[1]) % 100 === 1) return { id: score[1], name: score[1], type: "x01" }
  return null
}

const count = (text: string) => {
  const t = text.trim()
  if (t === "") return null
  const n = Number(t.replace(",", "."))
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : null
}

// FNV-1a over the row's facts, twice with different offsets, so the same row from the same
// file gets the same id and importing it again adds nothing. Two rows alike in every fact
// (two trainings on one day given without a time, same darts and points) are one game.
function hash(text: string) {
  const fnv = (offset: number) => {
    let h = offset >>> 0
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return h.toString(16).padStart(8, "0")
  }
  return fnv(0x811c9dc5) + fnv(0x01000193)
}

function namesIn(matches: readonly ArchivedMatch[]): HistoryName[] {
  const byKey = new Map<string, HistoryName>()
  for (const match of matches)
    for (const p of match.players) {
      if (p.unnamed || isUnnamed(p.name)) continue
      const key = nameKey(p.name)
      const entry = byKey.get(key)
      if (entry) entry.games++
      else byKey.set(key, { name: p.name.trim(), games: 1 })
    }
  return [...byKey.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
}

function span(matches: readonly ArchivedMatch[]) {
  const times = matches.map((m) => Date.parse(m.finishedAt)).filter((ms) => !Number.isNaN(ms))
  if (times.length === 0) return { from: null, to: null }
  return { from: new Date(Math.min(...times)).toISOString(), to: new Date(Math.max(...times)).toISOString() }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
