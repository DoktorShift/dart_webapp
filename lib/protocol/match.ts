import type { MatchConfig } from "../game/types.ts"
import type { RecordSpec } from "./common.ts"
import { embeddedEvent, matchRules, pubkey, seat, shortText, stake } from "./common.ts"
import { KIND_RECORD } from "./kinds.ts"
import type { Infer } from "./schema.ts"
import { arr, bool, hex, int, nullable, obj, oneOf, opt, refine, str, time } from "./schema.ts"
import { slot } from "./tournament.ts"

// Match records (docs/protocol/families/session-authorization.md, match-result.md). The match
// id is the id of the first match.session record (sv 1), signed by the match authority: the
// host's profile, an organizer-authorized board, or the device key of a guests-only board.
// That record names the writer: a session key that signs snapshots and the result, so an
// external signer is not asked for every dart. A handover is a new match.session with sv + 1
// from the same authority; the old session key is then worthless. A player who connects a phone
// after the founding gets their seat through match.seat from the authority: from then on, that
// key gives the seat's verdict on the result.

// Version of the scoring rules in lib/game/engine.ts that results are computed with. A reader
// only replays throw logs of engine versions it knows.
export const ENGINE_VERSION = 1

// A session lasts at most a long day; a match that runs longer gets a fresh session.
export const MAX_SESSION_SECONDS = 24 * 60 * 60

export const agreement = obj({
  engine: int(1, 1000, "Scoring rules version (ENGINE_VERSION)"),
  rules: matchRules,
  seats: arr(seat, { min: 1, max: 6 }),
  visibility: oneOf(["public", "private"], "private: content encrypted with the match key from the link"),
  tournament: opt(obj({ id: hex(32, "Tournament id"), slot: slot() })),
  club: opt(hex(32, "Club id")),
  stake: opt(stake),
})
export type Agreement = Infer<typeof agreement>

const session = refine(
  obj({
    sv: int(1, 1000, "Session version, +1 on every handover"),
    session: pubkey("Writer session key"),
    from: time(),
    until: time(),
    prev: opt(hex(32, "Previous match.session event id (sv > 1)")),
    agreement: opt(agreement),
  }),
  (v) => {
    if (v.until <= v.from) return "until before from"
    if (v.until - v.from > MAX_SESSION_SECONDS) return "session longer than a day"
    if (v.sv === 1 && (v.agreement === undefined || v.prev !== undefined)) return "sv 1 carries the agreement and no prev"
    if (v.sv > 1 && (v.agreement !== undefined || v.prev === undefined)) return "a handover names prev and no agreement"
    return null
  },
)

export const throwLog = (max = 20000) => str({ min: 1, max, pattern: /^1/, description: "Compact throw log (throws.ts)" })

const result = refine(
  obj({
    sv: int(1, 1000),
    status: oneOf(["finished", "abandoned", "void"]),
    winner: nullable(int(0, 5)),
    legs: arr(int(0, 999), { min: 1, max: 6, description: "Legs won per seat" }),
    sets: opt(arr(int(0, 99), { min: 1, max: 6 })),
    stats: opt(obj({ darts: arr(int(0, 1_000_000), { min: 1, max: 6 }), points: arr(int(0, 10_000_000), { min: 1, max: 6 }) })),
    throws: opt(throwLog()),
    log: opt(obj({ head: hex(32, "Head of the match.log chain"), total: int(1, 1000), bytes: int(1, 50_000_000) })),
    finishedAt: time(),
    replaces: opt(hex(32, "The result this one corrects or voids")),
    reason: opt(shortText()),
    auth: opt(embeddedEvent),
  }),
  (v) => {
    if (v.throws !== undefined && v.log !== undefined) return "throws or log, not both"
    if (v.status === "finished" && v.throws === undefined && v.log === undefined) return "a finished match carries its throws"
    if (v.status === "void" && v.replaces === undefined) return "void names the result it cancels"
    if (v.replaces !== undefined && v.reason === undefined) return "a correction gives a reason"
    if (v.winner !== null && v.winner >= v.legs.length) return "winner is not a seat"
    if (v.sets && v.sets.length !== v.legs.length) return "sets and legs differ in length"
    return null
  },
)

export const MATCH_TYPES = {
  "match.session": { kind: KIND_RECORD, root: "session", encryption: "link", schema: session, description: "Founds a match (sv 1) or hands it to a new writer" },
  "match.result": { kind: KIND_RECORD, root: "required", encryption: "link", schema: result, description: "Final result with throws or a reference to the log" },
  "match.log": {
    kind: KIND_RECORD,
    root: "required",
    encryption: "link",
    schema: obj({ set: hex(32), seq: int(0, 999), total: int(1, 1000), prev: hex(32), data: str({ min: 1, max: 20000 }) }),
    description: "One piece of a long throw log (chunks.ts)",
  },
  "match.seat": {
    kind: KIND_RECORD,
    root: "required",
    encryption: "link",
    schema: obj({
      seat: int(0, 5),
      player: nullable(
        obj({
          pubkey: pubkey("The key that confirms for this seat from now on"),
          profile: bool("The player's profile; false: a key the player's phone made for this match (a guest)"),
        }),
      ),
    }),
    description: "Connects a player's phone to a seat after the founding, or frees the seat (player null)",
  },
  "match.confirm": {
    kind: KIND_RECORD,
    root: "required",
    encryption: "link",
    schema: obj({ result: hex(32, "match.result event id"), verdict: oneOf(["confirm", "dispute"]), seat: int(0, 5), reason: opt(shortText()) }),
    description: "A player confirms or disputes one exact result",
  },
} satisfies Record<string, RecordSpec>

// The engine's match config for an agreement: seats become players named by their alias.
export function agreementToConfig(a: Agreement, modeName = a.rules.modeId): MatchConfig {
  return {
    modeId: a.rules.modeId,
    modeName,
    type: a.rules.type,
    startScore: a.rules.startScore,
    doubleIn: a.rules.doubleIn,
    doubleOut: a.rules.doubleOut,
    cutThroat: a.rules.cutThroat,
    bullFinish: a.rules.bullFinish,
    legsToWin: a.rules.legsToWin,
    setsToWin: a.rules.setsToWin,
    startRule: a.rules.startRule,
    players: a.seats.map((s, i) => ({ id: `seat${i}`, name: s.alias })),
  }
}

// The protocol rules of an engine config (names stay out; seats carry aliases).
export const configToRules = (c: MatchConfig): Agreement["rules"] => ({
  type: c.type,
  modeId: c.modeId,
  startScore: c.startScore,
  doubleIn: c.doubleIn ?? false,
  doubleOut: c.doubleOut,
  cutThroat: c.cutThroat,
  bullFinish: c.bullFinish,
  legsToWin: c.legsToWin,
  setsToWin: Math.max(1, c.setsToWin ?? 1),
  startRule: c.startRule ?? "alternate",
})
