import type { MatchState } from "../game/engine.ts"
import type { Throw } from "../game/types.ts"
import type { RecordSpec } from "./common.ts"
import { embeddedEvent } from "./common.ts"
import { KIND_STATE } from "./kinds.ts"
import { throwLog } from "./match.ts"
import type { Infer } from "./schema.ts"
import { arr, bool, int, nullable, obj, oneOf, opt } from "./schema.ts"
import type { SignedEvent } from "./tags.ts"
import { encodeThrowsTail } from "./throws.ts"

// The live match snapshot (docs/protocol/families/match-live.md): addressable kind 31180 with
// "d" = match id, signed by the current writer session after every visit. Relays keep only the
// newest per writer, which is all a spectator needs to (re)join: version counters, the
// standing for a quick display and the compact throw log for an exact replay. A private match
// encrypts the content to the match key from the link (["enc","nip44",<match key pubkey>]).

// Throw text one snapshot carries at most; longer matches send the log from the current leg
// on ("from" > 0) and the standing covers the rest.
export const MAX_LIVE_THROWS_BYTES = 16000

export const standing = obj({
  leg: int(0, 999, "Leg number in the match, from 0"),
  set: opt(int(0, 99)),
  current: int(0, 5, "Seat to throw"),
  scores: arr(int(-100000, 100000), { min: 1, max: 6, description: "X01 remaining, cricket points, clock progress" }),
  legs: arr(int(0, 999), { min: 1, max: 6, description: "Legs won in the current set (in the match without sets)" }),
  sets: opt(arr(int(0, 99), { min: 1, max: 6 })),
  active: opt(arr(bool(), { min: 1, max: 6, description: "false for players who left" })),
  winner: nullable(int(0, 5)),
})
export type Standing = Infer<typeof standing>

const snapshot = obj({
  sv: int(1, 1000, "Session version of the writer"),
  n: int(0, 1_000_000_000, "Snapshot counter; continues across handovers"),
  status: oneOf(["playing", "paused", "finished", "abandoned"]),
  throws: throwLog(MAX_LIVE_THROWS_BYTES),
  from: int(0, 1_000_000, "Index of the first throw in `throws`; 0 = complete"),
  standing,
  auth: embeddedEvent,
})
export type LiveSnapshot = Infer<typeof snapshot>

export const LIVE_TYPES = {
  "match.live": { kind: KIND_STATE, root: "required", d: true, encryption: "link", schema: snapshot, description: "Live state of a match" },
} satisfies Record<string, RecordSpec>

export function standingFromState(s: MatchState): Standing {
  const sets = (s.config.setsToWin ?? 1) > 1
  const scores = s.config.type === "x01" ? s.scores : s.config.type === "cricket" ? s.points : s.progress
  return {
    leg: s.legIndex,
    ...(sets ? { set: s.setIndex } : {}),
    current: s.current,
    scores: [...scores],
    legs: [...s.legsWon],
    ...(sets ? { sets: [...s.setsWon] } : {}),
    ...(s.active.some((a) => !a) ? { active: [...s.active] } : {}),
    winner: s.winner,
  }
}

// The throw text for a snapshot: the whole log when it fits, else from the start of the
// current leg, else the newest visits that fit.
export function liveThrows(throws: readonly Throw[], currentLeg: number): { throws: string; from: number } {
  const { text, from } = encodeThrowsTail(throws, MAX_LIVE_THROWS_BYTES, throws.findIndex((t) => t.leg === currentLeg))
  return { throws: text, from }
}

export function liveContent(input: {
  state: MatchState
  throws: readonly Throw[]
  sv: number
  n: number
  status: LiveSnapshot["status"]
  auth: SignedEvent
}): LiveSnapshot {
  const { throws, from } = liveThrows(input.throws, input.state.legIndex)
  return { sv: input.sv, n: input.n, status: input.status, throws, from, standing: standingFromState(input.state), auth: input.auth }
}
