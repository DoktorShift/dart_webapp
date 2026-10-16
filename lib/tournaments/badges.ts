import type { NostrEvent } from "../nostr/types.ts"
import { mayIssueTournamentBadge, reduceTournament, type TournamentState } from "../protocol/tournament-state.ts"
import { loadStoredTournament } from "./store.ts"
import { fetchTournament } from "./sync.ts"

// Who may award a tournament's badges, for the badges area's check of every award it shows
// (lib/badges/issuers.ts, registered in components/tournaments/register.ts): the organizer who
// finished the tournament (mayIssueTournamentBadge; the right comes with the end and stays),
// with the record that finished it as the evidence. The local copy answers when it has the end;
// otherwise relays are asked, once per tournament and page: tournament badges are shown on
// profiles of people whose tournaments this device never opened.

const finished = new Map<string, Promise<TournamentState | null>>()

async function read(tournament: string): Promise<TournamentState | null> {
  const stored = await loadStoredTournament(tournament).catch(() => null)
  const local = stored ? reduceTournament(stored.events, tournament).state : null
  if (local?.finished) return local
  const fetched = await fetchTournament(tournament, stored?.relays ?? [])
  if (!fetched.answered) return null
  const events: NostrEvent[] = [...(stored?.events ?? []), ...fetched.events]
  return reduceTournament(events, tournament).state
}

// The tournament as far as known; null while unknown (no copy here and no relay answered).
// Asked by every award of it on a screen at once, so one question serves them all.
function stateOf(tournament: string): Promise<TournamentState | null> {
  let state = finished.get(tournament)
  if (!state) {
    state = read(tournament).catch(() => null)
    finished.set(tournament, state)
    // Only the end is kept: a tournament not known to be over is asked again next time.
    void state.then((s) => !s?.finished && finished.delete(tournament))
  }
  return state
}

// The badges area's two questions (lib/badges/issuers.ts IssuerCheck).
export async function mayAward(tournament: string, issuer: string): Promise<boolean | undefined> {
  const state = await stateOf(tournament)
  return state ? mayIssueTournamentBadge(state, issuer) : undefined
}

export async function awardsStand(tournament: string, evidence: string): Promise<boolean | undefined> {
  const state = await stateOf(tournament)
  return state ? state.finished?.event === evidence : undefined
}
