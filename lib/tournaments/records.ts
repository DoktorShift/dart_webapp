import { nowSeconds } from "../nostr/time.ts"
import type { EventTemplate } from "../nostr/types.ts"
import { buildRecord, type ContentOf, type RecordType } from "../protocol/records.ts"
import { createdAtAfter } from "../protocol/tags.ts"
import { drawOrder, seedCommitment, type TournamentPhase } from "../protocol/tournament.ts"
import type { TournamentState } from "../protocol/tournament-state.ts"
import { MAX_OFFER_SECONDS } from "../protocol/kinds.ts"

// The tournament records this app writes, as templates on top of a state read from relays
// (docs/protocol/families/tournament.md): each names the base it builds on (`prev`: the last
// change of its subject, as the state has it) and is dated after everything the state applied,
// so replaying sorts it after what its author saw. Signing and sending are send.ts's job.

// created_at for a record written on top of the state: after everything in it, even within
// the same second (lib/protocol/tags.ts).
export const afterState = (state: TournamentState, ...basedOn: number[]) => createdAtAfter(nowSeconds(), state.log.applied.at(-1)?.at ?? 0, ...basedOn)

function record<T extends RecordType>(state: TournamentState, type: T, content: ContentOf<T>): EventTemplate {
  return buildRecord(type, content, { created_at: afterState(state), root: state.id })
}

const participantHead = (state: TournamentState, id: string) => state.participants[id]?.head ?? state.id
const boardHead = (state: TournamentState, board: string) => state.boards[board]?.head ?? state.id
const slotHead = (state: TournamentState, slot: string) => state.slots[slot]?.head ?? state.id

// Hand-over offers are open for a day (docs/protocol/families/tournament.md, "Vorgaben für
// lib/tournaments"), well within the protocol's seven.
export const OFFER_SECONDS = Math.min(24 * 3600, MAX_OFFER_SECONDS)

export const foundTemplate = (content: ContentOf<"tournament.found">, at = nowSeconds()) => buildRecord("tournament.found", content, { created_at: at })

// ---- The organizer ---------------------------------------------------------------------------

export const updateTemplate = (state: TournamentState, changes: Omit<ContentOf<"tournament.update">, "prev">) =>
  record(state, "tournament.update", { ...changes, prev: state.heads.core })

export const phaseTemplate = (state: TournamentState, phase: Exclude<TournamentPhase, "registration" | "drawn">, reason?: string) =>
  record(state, "tournament.phase", { phase, prev: state.heads.core, ...(reason ? { reason } : {}) })

export const seedTemplate = (state: TournamentState, seed: string) => record(state, "tournament.seed", { commit: seedCommitment(seed), prev: state.heads.core })

// The draw of `field` (participant ids) with `seeded` (best first) kept in front, in the order
// the seed gives, as the protocol checks it.
export function drawTemplate(state: TournamentState, seed: string, field: readonly string[], seeded: readonly string[]) {
  const top = seeded.filter((id) => field.includes(id))
  return record(state, "tournament.draw", { seed, seeded: top, order: drawOrder(seed, field, top), prev: state.heads.core })
}

export const admitTemplate = (state: TournamentState, participant: string) => record(state, "tournament.admit", { participant, prev: participantHead(state, participant) })
export const waitlistTemplate = (state: TournamentState, participant: string) => record(state, "tournament.waitlist", { participant, prev: participantHead(state, participant) })
export const removeTemplate = (state: TournamentState, participant: string, reason: string) =>
  record(state, "tournament.remove", { participant, prev: participantHead(state, participant), reason })

export const guestTemplate = (state: TournamentState, guest: string, alias: string, named: boolean) =>
  record(state, "tournament.guest", { guest, alias, ...(named ? { named: true } : {}) })

export const linkTemplate = (state: TournamentState, guest: string, player: string) => record(state, "tournament.link", { guest, player, prev: participantHead(state, guest) })

// The organizer checks someone in (with `participant`); a player checks in on their own.
export const checkInTemplate = (state: TournamentState, participant?: string) =>
  record(state, "tournament.checkin", participant ? { participant, prev: participantHead(state, participant) } : {})

export const boardTemplate = (state: TournamentState, board: string, name: string, key: string) =>
  record(state, "tournament.board", { board, name, key, prev: boardHead(state, board) })

export const revokeBoardTemplate = (state: TournamentState, board: string) => record(state, "tournament.board.revoke", { board, prev: boardHead(state, board) })

export const assignTemplate = (state: TournamentState, slot: string, board: string) => record(state, "tournament.assign", { slot, board, prev: slotHead(state, slot) })

export interface SubmittedResult {
  winner: string | null
  score: [number, number]
  walkover?: "noShow" | "retired"
  // The live match the result was scored in (lib/live), when there was one.
  match?: string
}

// A result, by the organizer (counts at once) or a board (counts once approved, unless the
// tournament lets boards approve).
export const resultTemplate = (state: TournamentState, slot: string, result: SubmittedResult) =>
  record(state, "tournament.result", { slot, winner: result.winner, score: result.score, ...(result.walkover ? { walkover: result.walkover } : {}), ...(result.match ? { match: result.match } : {}) })

export const approveTemplate = (state: TournamentState, slot: string, submission: string) => record(state, "tournament.approve", { slot, submission, prev: slotHead(state, slot) })

export const correctTemplate = (state: TournamentState, slot: string, winner: string | null, score: [number, number], reason: string) =>
  record(state, "tournament.correct", { slot, winner, score, reason, prev: slotHead(state, slot) })

export function offerTemplate(state: TournamentState, to: string) {
  const at = afterState(state)
  return buildRecord("tournament.handover.offer", { to, prev: state.heads.organizer, expires: at + OFFER_SECONDS, core: state.heads.core }, { created_at: at, root: state.id })
}

export const cancelOfferTemplate = (state: TournamentState, offer: string) => record(state, "tournament.handover.cancel", { offer })

// The offered person takes over, naming the core as they see it (at least the offer's).
export const acceptTemplate = (state: TournamentState, offer: string) => record(state, "tournament.handover.accept", { offer, core: state.heads.core })

// ---- Players -------------------------------------------------------------------------------

export const registerTemplate = (state: TournamentState, alias?: string) => record(state, "tournament.register", alias ? { alias } : {})
export const withdrawTemplate = (state: TournamentState, reason?: string) => record(state, "tournament.withdraw", reason ? { reason } : {})
export const claimTemplate = (state: TournamentState, guest: string) => record(state, "tournament.claim", { guest })
