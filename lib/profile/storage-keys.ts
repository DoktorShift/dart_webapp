// Where the profile keeps its things in this device's storage (./session.ts owns them). Only
// names, no code: an area that just needs to know whether a profile is stored (the sync's start
// task) reads the session's kv entry without loading the session module on the start page.
export const SESSION_KEY = "profile.session"
export const PROFILE_KV_PREFIX = "profile."
export const OWN_OBJECT_PREFIX = "own:"
export const SIGNER_PENDING_PREFIX = "signer:"
// Objects of a profile's clubs (lib/clubs), deleted with the profile like its own events.
export const CLUB_OBJECT_PREFIX = "club:"
// Tournaments the profile is creating (lib/tournaments/store.ts): profile data, gone with it.
export const TOURNAMENT_DRAFT_PREFIX = `${PROFILE_KV_PREFIX}tournament-draft:`
