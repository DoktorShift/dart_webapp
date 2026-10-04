// BlueLine event kinds and the limits every BlueLine event keeps (docs/protocol/kinds.md).
// One kind per NIP-01 range; the record type is a NIP-32 label, so relays and filters only
// ever deal with three numbers.

// Immutable records: foundings, changes, requests, results, confirmations.
export const KIND_RECORD = 1501
// Current state under a "d" tag: the live match snapshot.
export const KIND_STATE = 31501
// Pairing and board handshake messages; never stored, never queued.
export const KIND_EPHEMERAL = 21501
// NIP-78 private records of a profile, encrypted, one opaque "d" per record.
export const KIND_PRIVATE = 30078
// NIP-59 gift wrap (payment requests between players) and its seal.
export const KIND_GIFT_WRAP = 1059
export const KIND_SEAL = 13
// NIP-58 badges.
export const KIND_BADGE_DEFINITION = 30009
export const KIND_BADGE_AWARD = 8
export const KIND_PROFILE_BADGES = 10008

// NIP-32 label namespace of every BlueLine record.
export const LABEL_NAMESPACE = "blueline"
// Content format version this code writes and executes. Other versions are kept, not run.
export const FORMAT_VERSION = "1"

// Contract budget for a whole signed event as JSON (strfry's default cap is 64 KiB; we stay at
// half so every relay of the catalog takes it) and for one tag value (strfry: 1024 bytes).
export const MAX_EVENT_BYTES = 32 * 1024
export const MAX_TAG_VALUE_BYTES = 1024
// Plaintext that still fits MAX_EVENT_BYTES once encrypted: single NIP-44 layer, or sealed and
// gift-wrapped (measured with nostr-core 1.0.4, research PR-07).
export const MAX_SEALED_PLAINTEXT_BYTES = 20480
export const MAX_WRAPPED_PLAINTEXT_BYTES = 13887
// Relays (strfry) refuse events dated further ahead; readers apply the same window.
export const MAX_FUTURE_SKEW_SECONDS = 900
// Relays drop ephemeral events older than 60 s. Readers allow a pairing's whole lifetime, so a
// device whose clock is a few minutes off still pairs; the session expiry is the real bound.
export const MAX_EPHEMERAL_AGE_SECONDS = 60 * 10
// A pairing QR or code is valid for at most this long; a board QR (shown while players gather
// at the board) for at most an hour before the board shows a fresh one.
export const MAX_HANDSHAKE_SECONDS = 60 * 10
export const MAX_BOARD_CODE_SECONDS = 60 * 60
