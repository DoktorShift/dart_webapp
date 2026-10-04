import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils"
import type { RecordSpec } from "./common.ts"
import { alias, matchRules, name, objectId, prev, pubkey, shortText, stake } from "./common.ts"
import { KIND_RECORD } from "./kinds.ts"
import type { Schema } from "./schema.ts"
import { arr, bool, hex, httpsUrl, int, nullable, obj, oneOf, opt, refine, str, time } from "./schema.ts"

// Tournament records (docs/protocol/families/tournament.md). A tournament is the id of its
// tournament.found event; state comes from replaying the records (tournament-state.ts).
// Pairings themselves are the tournament engine's job; the protocol fixes who may decide
// what, the order of the draw and how results move from submitted to approved.

export const TOURNAMENT_FORMATS = ["single_ko", "double_ko", "round_robin", "groups_ko"] as const
export const TOURNAMENT_PHASES = ["registration", "checkin", "drawn", "running", "paused", "finished", "cancelled"] as const
export type TournamentPhase = (typeof TOURNAMENT_PHASES)[number]

// The first verbindliche load size is 128 players (PLAN.md); the protocol allows twice that.
export const MAX_PARTICIPANTS = 256

// A participant is a profile (64 hex pubkey) or a guest the organizer runs (32 hex guest id).
export const participantId = () => str({ min: 32, max: 64, pattern: /^([0-9a-f]{64}|[0-9a-f]{32})$/, description: "Pubkey of a player, or guest id" })
export const isGuestId = (id: string) => id.length === 32

// Match slots are named by the tournament engine ("W1-3", "G2-5", …); opaque here.
export const slot = () => str({ min: 1, max: 32, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, description: "Match slot named by the tournament engine" })

const score = () => arr(int(0, 99), { min: 2, max: 2, description: "Legs (or sets) won by the two sides" })

const tournamentFound = refine(
  obj({
    name: name(),
    about: opt(shortText(1000)),
    picture: opt(httpsUrl()),
    club: opt(hex(32, "Club id, when the club runs the tournament")),
    format: oneOf(TOURNAMENT_FORMATS),
    rules: matchRules,
    final: opt(matchRules),
    capacity: int(2, MAX_PARTICIPANTS),
    admission: oneOf(["auto", "manual"], "auto: registrations are admitted in order up to capacity"),
    waitlist: bool(),
    checkIn: bool("Players check in before the draw"),
    approval: oneOf(["organizer", "board"], "Who makes a result count"),
    starts: opt(time()),
    timezone: opt(str({ max: 64, pattern: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, description: "IANA time zone" })),
    place: opt(shortText(140)),
    online: opt(bool()),
    calendar: opt(str({ max: 200, pattern: /^31923:[0-9a-f]{64}:[^\s]{1,100}$/, description: "NIP-52 calendar event address" })),
    registrationCloses: opt(time()),
    seedCommit: opt(hex(32, "sha256 commitment to the draw seed, see seedCommitment()")),
    finalReset: opt(bool("Double KO: a second final when the losers' bracket winner wins the first")),
    thirdPlace: opt(bool()),
    groups: opt(obj({ count: int(2, 32), advance: int(1, 8) })),
    stake: opt(stake),
  }),
  (v) => (v.format === "groups_ko" && !v.groups ? "groups_ko needs groups" : null),
)

const tournamentUpdate = refine(
  obj({
    prev: prev(),
    name: opt(name()),
    about: opt(shortText(1000)),
    picture: opt(nullable(httpsUrl())),
    starts: opt(time()),
    timezone: opt(str({ max: 64, pattern: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/ })),
    place: opt(shortText(140)),
    online: opt(bool()),
    capacity: opt(int(2, MAX_PARTICIPANTS)),
    registrationCloses: opt(nullable(time())),
    rules: opt(matchRules),
    final: opt(matchRules),
  }),
  (v) => (Object.keys(v).length > 1 ? null : "changes nothing"),
)

// Tournament records may be sealed to a group key (a closed club's key, for its own events).
const rec = <S extends Schema<unknown>>(schema: S, description: string) => ({
  kind: KIND_RECORD,
  root: "required" as const,
  sealed: "allowed" as const,
  schema,
  description,
})

const phaseChange = obj({ phase: oneOf(["checkin", "running", "paused", "finished", "cancelled"]), prev: prev(), reason: opt(shortText()) })

export const TOURNAMENT_TYPES = {
  "tournament.found": { ...rec(tournamentFound, "Founds a tournament; its id is the tournament id"), root: "self" as const },
  "tournament.update": rec(tournamentUpdate, "Changes details; rules only before the draw"),
  "tournament.phase": rec(phaseChange, "Moves the tournament to another phase"),
  "tournament.seed": rec(obj({ commit: hex(32, "seedCommitment(seed)"), prev: prev() }), "Commits to the draw seed before the draw"),
  "tournament.draw": rec(
    obj({
      seed: hex(32, "Revealed seed"),
      seeded: arr(participantId(), { max: MAX_PARTICIPANTS, unique: true, description: "Seeded players, best first" }),
      order: arr(participantId(), { min: 2, max: MAX_PARTICIPANTS, unique: true, description: "The whole field in draw order" }),
      prev: prev(),
    }),
    "Reveals the seed and fixes the order of the field",
  ),
  "tournament.register": rec(obj({ alias: opt(alias()) }), "A player registers"),
  "tournament.withdraw": rec(obj({ reason: opt(shortText()) }), "A player withdraws"),
  "tournament.admit": rec(obj({ participant: participantId(), prev: prev() }), "Organizer admits a registration"),
  "tournament.waitlist": rec(obj({ participant: participantId(), prev: prev() }), "Organizer moves a participant to the waiting list"),
  "tournament.remove": rec(
    obj({ participant: participantId(), prev: prev(), reason: str({ min: 1, max: 280, description: "Why: no-show, cancelled for a guest, disqualified" }) }),
    "Organizer takes a participant out",
  ),
  "tournament.guest": rec(obj({ guest: objectId(), alias: alias() }), "Organizer adds a guest without a profile"),
  "tournament.claim": rec(obj({ guest: objectId() }), "A player claims a guest place as theirs"),
  "tournament.link": rec(obj({ guest: objectId(), player: pubkey(), prev: prev() }), "Organizer links a guest place to the claiming player"),
  "tournament.checkin": rec(
    refine(obj({ participant: opt(participantId()), prev: opt(prev()) }), (v) =>
      (v.participant === undefined) === (v.prev === undefined) ? null : "participant and prev go together",
    ),
    "A player checks in, or the organizer checks someone in",
  ),
  "tournament.board": rec(obj({ board: objectId(), name: name(), key: pubkey("Board device key"), prev: prev() }), "Organizer authorizes a board device"),
  "tournament.board.revoke": rec(obj({ board: objectId(), prev: prev() }), "Organizer withdraws a board"),
  "tournament.assign": rec(obj({ slot: slot(), board: objectId(), prev: prev() }), "Organizer assigns a match slot to a board"),
  "tournament.result": rec(
    obj({
      slot: slot(),
      winner: nullable(participantId()),
      score: score(),
      match: opt(hex(32, "Match id of the recorded match")),
      result: opt(hex(32, "match.result event id")),
    }),
    "A board (or the organizer) submits a result",
  ),
  "tournament.approve": rec(obj({ slot: slot(), submission: hex(32, "tournament.result event id"), prev: prev() }), "Organizer approves a submitted result"),
  "tournament.correct": rec(
    obj({ slot: slot(), winner: nullable(participantId()), score: score(), reason: shortText(), prev: prev() }),
    "Organizer corrects an approved result",
  ),
  "tournament.handover.offer": rec(obj({ to: pubkey(), prev: prev() }), "Organizer offers the organization to someone"),
  "tournament.handover.cancel": rec(obj({ offer: hex(32) }), "Organizer withdraws the open offer"),
  "tournament.handover.accept": rec(obj({ offer: hex(32) }), "The offered person takes over the organization"),
} satisfies Record<string, RecordSpec>

// The commitment published before check-in closes, opened by the draw:
// sha256("blueline-seed-v1:" + seed hex).
export const seedCommitment = (seed: string) => bytesToHex(sha256(utf8ToBytes(`blueline-seed-v1:${seed}`)))

// The verifiable order of the field: seeded players first in their given order, then everyone
// else sorted by sha256("blueline-draw-v1:" + seed + ":" + id). The engine builds pairings
// from this order, so anyone with the seed and the field reproduces the draw.
export function drawOrder(seed: string, field: readonly string[], seeded: readonly string[] = []): string[] {
  const inField = new Set(field)
  const top = seeded.filter((id) => inField.has(id))
  const rest = field
    .filter((id) => !top.includes(id))
    .map((id) => ({ id, key: bytesToHex(sha256(utf8ToBytes(`blueline-draw-v1:${seed}:${id}`))) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1))
    .map((x) => x.id)
  return [...top, ...rest]
}
