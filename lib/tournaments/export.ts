import type { MatchView } from "./engine.ts"
import type { TournamentRead } from "./read.ts"
import type { StoredTournament } from "./store.ts"

// The portable tournament export (PLAN.md "Turniere": CSV of the pairings and results for
// people and spreadsheets, JSON with the signed events for another app or a later audit). The
// events are the tournament: any implementation of docs/protocol replays them and arrives at
// the same pairings. The summary is for people reading the file; it is never read back.

const FORMAT = "blueline-tournament"
const VERSION = 1

export interface ExportLabels {
  round: (m: MatchView) => string
  state: (m: MatchView) => string
  name: (participant: string | null) => string
  board: (board: string | null) => string
  columns: [string, string, string, string, string, string, string, string]
}

// Matches that will be played or were, in playing order, one line each. Fields are quoted
// where a name could hold a separator; the separator is the semicolon, which spreadsheets in
// German locales expect.
export function tournamentCsv(read: TournamentRead, labels: ExportLabels): string {
  const rows: string[][] = [labels.columns]
  for (const m of read.view?.matches ?? []) {
    if (m.state === "void") continue
    const score = m.score ? (m.score.sets ? `${m.score.sets[0]}:${m.score.sets[1]} (${m.score.legs[0]}:${m.score.legs[1]})` : `${m.score.legs[0]}:${m.score.legs[1]}`) : ""
    rows.push([String(m.number), labels.round(m), labels.name(m.slots[0].participant), labels.name(m.slots[1].participant), score, labels.name(m.winner), labels.board(m.board), labels.state(m)])
  }
  return rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n"
}

const cell = (value: string) => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export function tournamentJson(stored: StoredTournament, read: TournamentRead, exportedAt = new Date()) {
  const { state, view } = read
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: exportedAt.toISOString(),
    tournament: stored.tournament,
    summary: state && {
      name: state.settings.name,
      format: state.settings.format,
      phase: state.phase,
      organizer: state.organizer,
      participants: Object.values(state.participants).map((p) => ({ id: p.id, kind: p.kind, name: read.names[p.id], status: p.status, checkedIn: p.checkedIn })),
      draw: state.draw && { seed: state.draw.seed, seeded: state.draw.seeded, order: state.draw.order },
      boards: Object.values(state.boards).map((b) => ({ id: b.id, name: b.name, active: b.active })),
      matches: (view?.matches ?? [])
        .filter((m) => m.state !== "void")
        .map((m) => ({ id: m.id, number: m.number, bracket: m.bracket, group: m.group, round: m.round, players: m.slots.map((s) => s.participant), state: m.state, winner: m.winner, score: m.score, board: m.board })),
      placements: view?.placements ?? [],
    },
    events: stored.events,
  }
}

// A file name for the export: the tournament's name, safe for every file system.
export const exportFileName = (name: string, extension: "csv" | "json") =>
  `${name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "turnier"}.${extension}`
