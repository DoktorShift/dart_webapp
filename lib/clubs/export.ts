import type { ClubView } from "./club.ts"
import type { StoredClub } from "./store.ts"

// The portable club export (PLAN.md "Clubs und Saisons": definition, role history, season
// rules, results and calendar references, plus the content keys the exporting person can read).
// The signed events are the club: any implementation of docs/protocol replays them with the keys
// and arrives at the same state, so a new owner or another app needs nothing else. The summary
// is for people reading the file; it is never read back.

const CLUB_EXPORT_FORMAT = "blueline-club"
const CLUB_EXPORT_VERSION = 1

export function clubExport(stored: StoredClub, view: ClubView, exportedAt = new Date()) {
  const state = view.state
  return {
    format: CLUB_EXPORT_FORMAT,
    version: CLUB_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    club: stored.club,
    summary: state && {
      name: state.info.name,
      visibility: state.info.visibility,
      owner: state.owner,
      members: Object.values(state.members).map((m) => ({ pubkey: m.pubkey, role: m.role, since: m.since })),
      roles: state.history,
      seasons: Object.values(state.seasons).map((s) => ({ id: s.id, name: s.name, starts: s.starts, ends: s.ends, ended: s.ended !== null, rules: s.versions })),
      results: state.results,
      dates: view.dates.map((d) => ({ id: d.id, title: d.title, starts: d.starts, ends: d.ends, place: d.place, cancelled: d.cancelled })),
      games: view.games.map((g) => ({ match: g.match, seats: g.agreement.seats, result: g.result })),
    },
    // Content keys of sealed records (by event id) and match keys of private games (by match id).
    keys: stored.keys,
    matchKeys: Object.fromEntries(view.games.filter((g) => g.key).map((g) => [g.match, g.key])),
    events: stored.events,
  }
}
