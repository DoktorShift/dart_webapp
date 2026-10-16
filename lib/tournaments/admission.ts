import type { NostrEvent } from "../nostr/types.ts"
import { reduceTournament } from "../protocol/tournament-state.ts"
import { withLock } from "../storage/lock.ts"
import { nextAdmission } from "./read.ts"
import { admitTemplate, waitlistTemplate } from "./records.ts"
import { send, type Author } from "./send.ts"
import { loadStoredTournament } from "./store.ts"

// "Anmeldungen automatisch aufnehmen": the protocol admits only through the organizer's own
// record (docs/protocol/families/tournament.md), so the organizer's device signs one decision at
// a time as it sees requests (read.ts nextAdmission). Each is decided holding the tournament's
// admission lock in every tab, on its copy as stored then: a second tab finds the first one's
// record there and decides the next place, never the same one again.
export function admitNext(tournament: string, author: Author): Promise<NostrEvent | null> {
  return withLock(`tournament-admit:${tournament}`, async () => {
    const stored = await loadStoredTournament(tournament)
    const state = stored ? reduceTournament(stored.events, tournament).state : null
    const next = state?.organizer === author.pubkey ? nextAdmission(state) : null
    if (!state || !next) return null
    const template = next.to === "admit" ? admitTemplate(state, next.participant.id) : waitlistTemplate(state, next.participant.id)
    const [event] = await send(tournament, [template], author)
    return event
  })
}
