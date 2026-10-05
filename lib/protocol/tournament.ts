import { commitSeed, drawOrder as engineDrawOrder } from "../tournaments/draw.ts"
import type { RecordSpec } from "./common.ts"
import { alias, eventId, matchRules, name, objectId, prev, pubkey, shortText } from "./common.ts"
import { KIND_RECORD } from "./kinds.ts"
import type { Schema } from "./schema.ts"
import { arr, bool, hex, httpsUrl, id32, int, nullable, obj, oneOf, opt, refine, str, time } from "./schema.ts"

// Tournament records (docs/protocol/families/tournament.md). A tournament is the id of its
// tournament.found event; state comes from replaying the records (tournament-state.ts).
// Pairings themselves are the tournament engine's job (lib/tournaments/engine.ts); the protocol
// fixes who may decide what, the order of the draw and how results move from submitted to
// approved. Formats, seed and draw order use the engine's names and derivations.

export const TOURNAMENT_FORMATS = ["single", "double", "roundRobin", "groups"] as const
export const TOURNAMENT_PHASES = ["registration", "checkin", "drawn", "running", "paused", "finished", "cancelled"] as const
export type TournamentPhase = (typeof TOURNAMENT_PHASES)[number]

// Version of the engine's bracket and draw rules this code knows (lib/tournaments: engine 1).
export const TOURNAMENT_ENGINE = 1

// The first binding load size (PLAN.md, "Turniere"): higher limits only after measuring.
export const MAX_PARTICIPANTS = 128

// A participant is a profile (64 hex pubkey) or a guest the organizer runs (32 hex guest id).
export const participantId = () => str({ min: 32, max: 64, pattern: /^([0-9a-f]{64}|[0-9a-f]{32})$/, description: "Pubkey of a player, or guest id" })
export const isGuestId = (id: string) => id.length === 32

// Match slots are named by the tournament engine ("R1-3", "GF2", …); opaque here.
export const slot = () => str({ min: 1, max: 32, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, description: "Match slot named by the tournament engine" })

const score = () => arr(int(0, 99), { min: 2, max: 2, description: "Legs (or sets) won by the two sides" })
const timezone = () => str({ max: 64, pattern: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, description: "IANA time zone" })

const tournamentFound = refine(
  obj({
    name: name(),
    about: opt(shortText(1000)),
    picture: opt(httpsUrl()),
    club: opt(eventId("Club id, when the club runs the tournament")),
    engine: int(1, 1000, "Bracket and draw rules version (TOURNAMENT_ENGINE)"),
    format: oneOf(TOURNAMENT_FORMATS),
    rules: matchRules,
    final: opt(matchRules),
    capacity: int(2, MAX_PARTICIPANTS),
    admission: oneOf(["auto", "manual"], "auto: the organizer's device admits registrations as they arrive; either way only tournament.admit admits"),
    waitlist: bool(),
    checkIn: bool("Players check in before the draw"),
    approval: oneOf(["organizer", "board"], "Who makes a result count"),
    starts: opt(time()),
    timezone: opt(timezone()),
    place: opt(shortText(140)),
    online: opt(bool()),
    calendar: opt(str({ max: 200, pattern: /^31923:[0-9a-f]{64}:[^\s]{1,100}$/, description: "NIP-52 calendar event address" })),
    registrationCloses: opt(time()),
    seedCommit: opt(hex(32, "seedCommitment(seed), published before the draw")),
    grandFinalReset: opt(bool("Double elimination: a second final when the losers' bracket winner wins the first")),
    doubleRoundRobin: opt(bool("Round robin and groups: everyone meets everyone twice")),
    groups: opt(obj({ count: int(2, 32), advance: int(1, 8) })),
  }),
  (v) => (v.format === "groups" && !v.groups ? "groups needs groups" : null),
)

const tournamentUpdate = refine(
  obj({
    prev: prev(),
    name: opt(name()),
    about: opt(shortText(1000)),
    picture: opt(nullable(httpsUrl())),
    starts: opt(time()),
    timezone: opt(timezone()),
    place: opt(shortText(140)),
    online: opt(bool()),
    capacity: opt(int(2, MAX_PARTICIPANTS)),
    registrationCloses: opt(nullable(time())),
    rules: opt(matchRules),
    final: opt(matchRules),
  }),
  (v) => (Object.keys(v).length > 1 ? null : "changes nothing"),
)

// Tournament records may be sealed for the members of the closed club that runs it (seal.ts).
const rec = <S extends Schema<unknown>>(schema: S, description: string) => ({
  kind: KIND_RECORD,
  root: "required" as const,
  encryption: "seal" as const,
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
      seed: hex(16, "Revealed seed (128 bits)"),
      seeded: arr(participantId(), { max: MAX_PARTICIPANTS, unique: true, description: "Seeded players, best first" }),
      order: arr(participantId(), { min: 2, max: MAX_PARTICIPANTS, unique: true, description: "The whole field in draw order" }),
      prev: prev(),
    }),
    "Reveals the seed and fixes field and order",
  ),
  "tournament.register": rec(obj({ alias: opt(alias()) }), "A player asks for a place"),
  "tournament.withdraw": rec(obj({ reason: opt(shortText()) }), "A player withdraws"),
  "tournament.admit": rec(obj({ participant: participantId(), prev: prev() }), "The organizer admits a registration"),
  "tournament.waitlist": rec(obj({ participant: participantId(), prev: prev() }), "The organizer puts a registration on the waiting list"),
  "tournament.remove": rec(
    obj({ participant: participantId(), prev: prev(), reason: str({ min: 1, max: 280, description: "Why: declined, no-show, disqualified" }) }),
    "The organizer takes a participant out",
  ),
  "tournament.guest": rec(
    obj({ guest: objectId(), alias: alias(), named: opt(bool("true: the guest agreed to be shown under this name; otherwise it is a neutral alias")) }),
    "The organizer adds a guest without a profile",
  ),
  "tournament.claim": rec(obj({ guest: objectId() }), "A player claims a guest place as theirs"),
  "tournament.link": rec(obj({ guest: objectId(), player: pubkey(), prev: prev() }), "The organizer links a guest place to the claiming player"),
  "tournament.checkin": rec(
    refine(obj({ participant: opt(participantId()), prev: opt(prev()) }), (v) =>
      (v.participant === undefined) === (v.prev === undefined) ? null : "participant and prev go together",
    ),
    "A player checks in, or the organizer checks someone in",
  ),
  "tournament.board": rec(obj({ board: objectId(), name: name(), key: pubkey("Board device key"), prev: prev() }), "The organizer authorizes a board device"),
  "tournament.board.revoke": rec(obj({ board: objectId(), prev: prev() }), "The organizer withdraws a board"),
  "tournament.assign": rec(obj({ slot: slot(), board: objectId(), prev: prev() }), "The organizer assigns a match slot to a board"),
  "tournament.result": rec(
    obj({
      slot: slot(),
      winner: nullable(participantId()),
      score: score(),
      walkover: opt(oneOf(["noShow", "retired"], "Won without (finishing) the match")),
      match: opt(eventId("Match id of the recorded match")),
      result: opt(eventId("match.result event id")),
    }),
    "A board (or the organizer) submits a result",
  ),
  "tournament.approve": rec(obj({ slot: slot(), submission: eventId("tournament.result event id"), prev: prev() }), "The organizer approves a submitted result"),
  "tournament.correct": rec(
    obj({ slot: slot(), winner: nullable(participantId()), score: score(), reason: shortText(), prev: prev() }),
    "The organizer corrects an approved result",
  ),
  "tournament.handover.offer": rec(
    obj({
      to: pubkey(),
      prev: prev(),
      expires: time("Open until then: after created_at, at most MAX_OFFER_SECONDS (7 days) later"),
      core: id32("The current tournament core it hands over: its last change, or the tournament id"),
    }),
    "The organizer offers the organization to someone",
  ),
  "tournament.handover.cancel": rec(obj({ offer: eventId() }), "The organizer withdraws the open offer"),
  "tournament.handover.accept": rec(
    obj({ offer: eventId(), core: id32("Last change of the tournament core (or its id) the new organizer saw: the offer's core or one built on it") }),
    "The offered person takes over the organization",
  ),
} satisfies Record<string, RecordSpec>

// The draw is the engine's (lib/tournaments/draw.ts, engine 1), so a draw checked here is the
// draw the engine builds: the commitment published before the draw is
//   sha256("blueline-seed-v1\n" + seed)
// and every unseeded participant is ordered by
//   sha256("blueline-draw-v1\n" + seed + "\n" + id)
// after the seeded ones in their given order. Anyone with the seed and the field reproduces it.
export const seedCommitment = commitSeed

// The engine's order for participant ids: the seeded ones that are in the field keep their order.
export function drawOrder(seed: string, field: readonly string[], seeded: readonly string[] = []): string[] {
  const inField = new Set(field)
  const top = seeded.filter((id) => inField.has(id))
  const rest = field.filter((id) => !top.includes(id))
  return engineDrawOrder([...top, ...rest].map((id) => ({ id, name: id })), seed, top.length).map((p) => p.id)
}
