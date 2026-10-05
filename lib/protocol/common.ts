import type { Schema } from "./schema.ts"
import { arr, bool, hex, id32, int, obj, oneOf, opt, refine, relayUrl, str, time } from "./schema.ts"

// Schemas several families share: match rules, seats, stakes, embedded events.

// What a record spec says about a type: which kind carries it, how it points at its root
// object, and how its content may be encrypted (docs/protocol/kinds.md, "Verschlüsselung").
export interface RecordSpec {
  kind: number
  // "self": the record founds an object and its own id is the object id (no "e" tag).
  // "required": exactly one "e" tag naming the root. "session": match.session (see match.ts).
  root: "self" | "required" | "session"
  d?: true
  // "seal": a sealed envelope, one random content key per record, wrapped for every reader
  // (closed clubs, seal.ts). "link": NIP-44 to a key that travels in a link (private matches).
  // "none": never encrypted. `encrypted`: never in the clear.
  encryption: "none" | "seal" | "link"
  encrypted?: true
  schema: Schema<unknown>
  description: string
}

// Pubkeys and event ids: 32 bytes, lowercase hex. Object ids (seasons, invites, guests,
// boards): 16 random bytes, lowercase hex (docs/decisions/0002, "Neue Objekt-IDs").
export const pubkey = (description?: string) => hex(32, description ?? "Pubkey, lowercase hex")
export const objectId = (description?: string) => hex(16, description ?? "128-bit object id, lowercase hex")

// Display text that other people see. Guests appear only under an alias the host chose for
// them unless they agreed to their name (docs/protocol/privacy.md).
export const alias = () => str({ min: 1, max: 40, pattern: /^\S(.*\S)?$/u, description: "Public display alias, trimmed" })
export const shortText = (max = 280) => str({ max, description: "Plain text, never HTML" })
export const name = () => str({ min: 1, max: 60, pattern: /^\S(.*\S)?$/u, description: "Name, trimmed" })

export const MODE_ID = /^[a-z0-9]{1,16}$/

// The scoring rules of a match, the protocol form of lib/game/types.ts MatchConfig without
// names. Every field is written, so two readers never fill in different defaults.
export const matchRules = obj(
  {
    type: oneOf(["x01", "cricket", "clock"]),
    modeId: str({ min: 1, max: 16, pattern: MODE_ID, description: "Game mode id, e.g. 501, cricket" }),
    startScore: int(0, 10001, "X01 start score (other games carry what the app set)"),
    doubleIn: bool(),
    doubleOut: bool(),
    cutThroat: bool(),
    bullFinish: bool(),
    legsToWin: int(1, 11),
    setsToWin: int(1, 7, "1 means the match is played in legs only"),
    startRule: oneOf(["alternate", "loser"]),
  },
  { description: "Scoring rules (lib/game/types.ts MatchConfig without players and names)" },
)

// A guest's alias is a neutral one ("Gast 2") unless they agreed to be shown by name in a public
// match (docs/protocol/privacy.md).
export const seat = obj({
  alias: alias(),
  pubkey: opt(pubkey("Profile of the player in this seat, only when the player joined with it")),
  named: opt(bool("A guest without profile agreed to be shown under this alias")),
})

// An agreed stake, in millisatoshis of whole sats. Informational: BlueLine never pays because
// of it; players pay each other by hand (PLAN.md, "Direkte Zahlungen").
export const stake = obj({
  msat: refine(int(1000, 100_000_000_000, "Whole sats, written as msat"), (v) => (v % 1000 === 0 ? null : "not whole sats")),
  note: opt(shortText(140)),
})

export const relays = () => arr(relayUrl(), { max: 8, unique: true })

// A signed event carried inside another event's content (session authorization embedded in
// a snapshot or result). Shape only: lib/nostr verifies its signature like any other event.
export const embeddedEvent = obj({
  id: id32(),
  pubkey: pubkey(),
  created_at: time(),
  kind: int(0, 65535),
  tags: arr(arr(str({ max: 1024 }), { min: 1, max: 16 }), { max: 32 }),
  content: str({ max: 8192 }),
  sig: hex(64, "Schnorr signature"),
})

export const eventId = (description?: string) => id32(description ?? "Event id")

// "prev": the id of the change the author saw last for the same subject (the founding when
// there was none). A change on an outdated base is rejected as a conflict, never merged.
export const prev = () => id32("Expected predecessor: last change of this subject, or the founding")
