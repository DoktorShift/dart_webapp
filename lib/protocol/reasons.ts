// Why a BlueLine event was not applied. Reducers keep rejected events with one of these codes
// (shown under "Erweitert", never in normal views); docs/protocol/conflicts.md explains each.

export const REASONS = [
  // Structure, every family
  "invalid_event",
  "not_blueline",
  "wrong_kind",
  "invalid_tags",
  "tag_too_long",
  "too_large",
  "invalid_content",
  "future_timestamp",
  "expired_message",
  "wrong_root",
  "before_founding",
  "duplicate",
  "unknown_version",
  // Authority and ordering
  "not_authorized",
  "stale_predecessor",
  // Clubs
  "not_member",
  "already_member",
  "removed_requires_new_invite",
  "club_full",
  "club_archived",
  "invite_unknown",
  "invite_expired",
  "invite_exhausted",
  "invite_revoked",
  "invite_proof_invalid",
  "request_unknown",
  "owner_cannot_leave",
  "no_open_offer",
  "epoch_mismatch",
  "season_unknown",
  "season_exists",
  "season_version_mismatch",
  "season_ended",
  "rules_change_needs_reason",
  // Tournaments
  "phase_invalid",
  "registration_closed",
  "tournament_full",
  "not_registered",
  "already_registered",
  "guest_unknown",
  "seed_not_committed",
  "seed_mismatch",
  "draw_mismatch",
  "board_unknown",
  "board_not_assigned",
  "result_unknown",
  "already_approved",
  "rules_locked",
  // Matches
  "session_unknown",
  "session_superseded",
  "session_expired",
  "session_mismatch",
  "not_a_player",
  "stake_requires_private",
  // Payment requests
  "amount_mismatch",
  "invoice_mismatch",
  "invoice_expired",
  // Badges
  "issuer_mismatch",
  "recipient_missing",
  "occasion_mismatch",
  "evidence_missing",
  "evidence_revoked",
  // Handshakes
  "wrong_flow",
  "session_taken",
  "no_free_seat",
  "out_of_order",
  "mac_invalid",
] as const

export type Reason = (typeof REASONS)[number]

// Thrown by builders and decoders; a builder never returns an event it would reject itself.
export class ProtocolError extends Error {
  readonly reason: Reason
  readonly detail: string
  constructor(reason: Reason, detail: string) {
    super(`${reason}: ${detail}`)
    this.name = "ProtocolError"
    this.reason = reason
    this.detail = detail
  }
}
