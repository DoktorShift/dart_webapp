// Tournament data. A tournament is stored as its draw (who is seed 1, 2, …), its fixed match
// plan and the decisions made since (results, walkovers, boards, withdrawals). Everything a
// screen shows — who plays whom, what is ready, tables, places — is derived from that by
// resolveTournament(), the way the dart engine replays its throw log. All of it is plain JSON.

export type TournamentFormat = "single" | "double" | "roundRobin" | "groups"

export interface Participant {
  id: string
  name: string
}

export interface MatchFormat {
  legsToWin: number
  // Sets to win the match; 1 or missing means the match is played in legs only.
  setsToWin?: number
}

export interface TournamentRules extends MatchFormat {
  // A longer final: the knockout final, the grand final of double elimination and its reset.
  // Missing: the final is played like every other match.
  final?: MatchFormat
}

// What the organizer decides before the draw.
export interface TournamentSetup {
  format: TournamentFormat
  // Entries in seed order. The first `seeded` keep their place, the rest are drawn.
  participants: Participant[]
  // How many entries are seeded; 0 or missing draws everyone, participants.length keeps the order.
  seeded?: number
  // Decides the draw and the final lot in tables. Kept secret until the draw; its commitment
  // (commitSeed) can be shown before, so everyone can check the draw afterwards.
  seed: string
  rules: TournamentRules
  // Double elimination: a second final when the player from the losers' bracket wins the first.
  // Default true.
  grandFinalReset?: boolean
  // Round robin and group stage: everyone meets everyone twice.
  doubleRoundRobin?: boolean
  // Groups then knockout: number of groups and how many of each group go through.
  groups?: { count: number; advance: number }
}

// main = single elimination and the knockout after groups; winners / losers / final = double
// elimination; group = round robin and group stage (group is null for a plain round robin).
export type Bracket = "main" | "winners" | "losers" | "final" | "group"

// Where a player in a match comes from.
export type SlotSource =
  | { type: "seed"; seed: number }
  | { type: "winner"; match: string }
  | { type: "loser"; match: string }
  | { type: "group"; group: string; rank: number }

export interface MatchSpec {
  id: string
  bracket: Bracket
  group: string | null
  round: number
  // Position in its round, 1-based, counted as in the full bracket (a round with byes has gaps).
  index: number
  slots: [SlotSource, SlotSource]
  // Played with the final rules.
  final: boolean
  // The grand-final reset: played only when the losers' bracket player wins the grand final.
  reset: boolean
}

export interface Score {
  // Legs won over the whole match (all sets), for each slot.
  legs: [number, number]
  // Sets won, when the match is played in sets.
  sets?: [number, number]
}

// A match given up without (fully) playing it: did not turn up, or gave up during the match.
export type WalkoverReason = "noShow" | "retired"

// Entered for a match: started, finished or forfeited. `players` are who was in the match at
// that moment; if a correction elsewhere puts other players into the match, the record is kept
// and the match is shown as affected instead of being silently replayed.
export interface MatchRecord {
  state: "live" | "finished" | "walkover"
  players: [string, string]
  // Slot that won (finished and walkover).
  winner?: 0 | 1
  score?: Score
  reason?: WalkoverReason
}

export type WithdrawalKind = "withdrawn" | "disqualified"

export interface Withdrawal {
  kind: WithdrawalKind
  // Groups then knockout: the player's group was already complete. They keep their group place,
  // so the knockout pairings everyone has seen stay as they are, and lose their knockout matches
  // by walkover. Otherwise a withdrawn player goes to the bottom of their table.
  afterGroup?: true
}

// A rest in a round robin with an odd number of players.
export interface Rest {
  group: string | null
  round: number
  participant: string
}

export interface Group {
  label: string
  // Participant ids in group seed order.
  members: string[]
}

export interface Tournament {
  // Version of the draw and bracket rules; a change to them gets a new number, so a stored
  // tournament never changes its pairings after an update.
  engine: 1
  format: TournamentFormat
  rules: TournamentRules
  grandFinalReset: boolean
  doubleRoundRobin: boolean
  advance: number
  seed: string
  seeded: number
  // After the draw: participants[0] is seed 1.
  participants: Participant[]
  groups: Group[]
  rests: Rest[]
  // In playing order. Every match comes after the matches it takes players from.
  matches: MatchSpec[]
  records: Record<string, MatchRecord>
  // Match id → board id. A board shows only while the match is ready or live (and afterwards
  // as where it was played).
  boards: Record<string, string>
  withdrawals: Record<string, Withdrawal>
}

// Derived state of a match.
//   pending   – a player is not known yet
//   ready     – both players known, not started
//   live      – started
//   finished  – played to the end
//   walkover  – decided without playing (no-show, gave up, withdrawal, nobody to play against)
//   void      – will not be played (both sides empty, or the reset is not needed)
export type MatchState = "pending" | "ready" | "live" | "finished" | "walkover" | "void"

export interface SlotView {
  source: SlotSource
  // The player, or null while not known.
  participant: string | null
  // Nobody will come: both players before withdrew, or the place stays empty.
  empty: boolean
}

export interface MatchView {
  id: string
  // Running number for lists and print-outs ("Spiel 7"), in playing order.
  number: number
  bracket: Bracket
  group: string | null
  round: number
  index: number
  // Rounds in this bracket or group, so a screen can name the final rounds.
  rounds: number
  final: boolean
  reset: boolean
  format: MatchFormat
  slots: [SlotView, SlotView]
  state: MatchState
  winner: string | null
  loser: string | null
  score: Score | null
  // Why a walkover: no-show and gave up are entered, withdrawn follows from a withdrawal, bye
  // means the other side stays empty.
  walkover: WalkoverReason | "withdrawn" | "bye" | null
  board: string | null
  // The entered record no longer fits the players the bracket now puts here (a result before
  // was corrected). The record stays as entered until the organizer decides; nothing after
  // this match moves on from it.
  affected: boolean
  // Players the record was entered for; differs from the slots when affected.
  recorded: [string, string] | null
}

// Points for a win, as in darts leagues. A loss gives none; matches cannot be drawn.
export const POINTS_PER_WIN = 2

// Criterion that put a row below the row above it.
export type Tiebreak = "points" | "sets" | "legDifference" | "legsWon" | "headToHead" | "lot"

// The order tables apply them ("sets" only when the matches are played in sets).
export const TIEBREAK_ORDER: Tiebreak[] = ["points", "sets", "legDifference", "legsWon", "headToHead", "lot"]

export interface StandingRow {
  participant: string
  rank: number
  played: number
  wins: number
  losses: number
  points: number
  legsFor: number
  legsAgainst: number
  setsFor: number
  setsAgainst: number
  // Null for the first row.
  decidedBy: Tiebreak | null
  // Withdrawn or disqualified while the table was still being played: listed after everyone
  // still playing, never goes through.
  inactive: boolean
}

export interface Standings {
  group: string | null
  // Every match of the table is decided.
  complete: boolean
  rows: StandingRow[]
}

// A final place. placeTo > place when players share it (e.g. 5 to 8 for the losers of the
// quarter-finals).
export interface Placement {
  participant: string
  place: number
  placeTo: number
}

export type ParticipantStatus = "active" | "eliminated" | "champion" | "withdrawn" | "disqualified"

export interface TournamentView {
  tournament: Tournament
  matches: MatchView[]
  match: (id: string) => MatchView | undefined
  standings: Standings[]
  // Places decided so far, best first. Disqualified players get none.
  placements: Placement[]
  status: Record<string, ParticipantStatus>
  champion: string | null
  complete: boolean
}

export interface NextMatch {
  match: MatchView
  // live: playing now; ready: can start (board shown when called); waiting: the opponent is not
  // known yet, or the match waits for the organizer's decision after a correction (match.affected).
  state: "live" | "ready" | "waiting"
}

export interface RoundProgress {
  bracket: Bracket
  group: string | null
  round: number
  total: number
  decided: number
  live: number
  ready: number
  pending: number
}

// What a change does to the bracket, for the preview before it is applied.
//   result   – the match itself gets another result or outcome
//   players  – a match not yet started gets other players
//   affected – a started or finished match no longer fits and is marked
//   resolved – a marked match fits again
export interface Consequence {
  match: string
  kind: "result" | "players" | "affected" | "resolved"
  before: [string | null, string | null]
  after: [string | null, string | null]
}

export type TournamentErrorCode =
  | "tooFewParticipants"
  | "tooManyParticipants"
  | "duplicateParticipant"
  | "invalidParticipant"
  | "invalidSetup"
  | "unknownMatch"
  | "unknownParticipant"
  | "notReady"
  | "notInMatch"
  | "playerBusy"
  | "invalidScore"
  | "boardBusy"
  | "noRecord"
  | "alreadyWithdrawn"
  | "notWithdrawn"
  | "tournamentComplete"
  | "unsupportedEngine"

export class TournamentError extends Error {
  code: TournamentErrorCode
  constructor(code: TournamentErrorCode, message: string) {
    super(message)
    this.name = "TournamentError"
    this.code = code
  }
}
