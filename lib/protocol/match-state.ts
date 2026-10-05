import type { Chunk } from "./chunks.ts"
import { MAX_FUTURE_SKEW_SECONDS } from "./kinds.ts"
import type { Agreement } from "./match.ts"
import type { AnyRecord, BlueLineRecord } from "./records.ts"
import type { Bases, FoundingProblem, Problem, ReplayLog, ReplayOptions } from "./replay.ts"
import { applied, byReplayOrder, foundingProblem, prepare, reject, settle, staleOr } from "./replay.ts"
import { decodeThrows } from "./throws.ts"

// Match state from its records (docs/protocol/families/session-authorization.md, match-live.md,
// match-result.md): who may write now, the best live snapshot, the current result and the
// confirmations that still count. Handover makes earlier sessions worthless from that point;
// a corrected result drops the confirmations of the one it replaces (A13).

export interface MatchSession {
  sv: number
  session: string
  from: number
  until: number
  event: string
  at: number
  by: string
}

export interface MatchResultEntry {
  event: string
  by: string
  at: number
  sv: number
  status: "finished" | "abandoned" | "void"
  winner: number | null
  legs: number[]
  replaces?: string
}

export interface MatchStateP {
  id: string
  authority: string
  agreement: Agreement
  sessions: MatchSession[]
  current: MatchSession
  live: { event: string; sv: number; n: number; at: number; content: BlueLineRecord<"match.live">["content"] } | null
  results: MatchResultEntry[]
  // The result that counts: the newest of the chain, unless that one voids the match.
  result: MatchResultEntry | null
  // Latest verdict per seat on `result`.
  confirmations: Record<number, { verdict: "confirm" | "dispute"; event: string; at: number; pubkey: string }>
  // Verdicts on results that were replaced since: shown, never counted.
  stale: { result: string; seat: number; verdict: "confirm" | "dispute"; event: string }[]
  // Pieces of long throw logs, by chain head.
  logs: Record<string, Chunk[]>
  log: ReplayLog
}

export type MatchResult = { state: MatchStateP } | { state: null; problem: FoundingProblem }

export interface MatchOptions extends ReplayOptions {
  // Keys besides the authority that may hand over and record results, e.g. the organizer of
  // the tournament this match belongs to.
  authorities?: string[]
}

export function reduceMatch(events: readonly unknown[], matchId: string, opts: MatchOptions = {}): MatchResult {
  const { records, log, founding, bases } = prepare(events, matchId, opts)
  if (!founding || founding.type !== "match.session" || founding.content.sv !== 1 || !founding.content.agreement)
    return { state: null, problem: founding ? "invalid" : foundingProblem(log, matchId) }

  const first: MatchSession = sessionOf(founding)
  const s: MatchStateP = {
    id: matchId,
    authority: founding.pubkey,
    agreement: founding.content.agreement,
    sessions: [first],
    current: first,
    live: null,
    results: [],
    result: null,
    confirmations: {},
    stale: [],
    logs: {},
    log,
  }
  applied(log, founding)
  const verdicts: BlueLineRecord<"match.confirm">[] = []
  const authorities = opts.authorities ?? []
  // The writer that counts in the end. A result signed by an earlier session is superseded
  // however its author dated it: a session key that was handed over stays worthless for results.
  const finalSv = lastSession(records, founding, authorities)

  for (const r of records) {
    if (r === founding) continue
    if (r.created_at < founding.created_at) {
      reject(log, r, "before_founding", "dated before the match started")
      continue
    }
    settle(log, r, apply(s, r, authorities, verdicts, finalSv, bases))
  }

  // Verdicts count for the result they name; the newest verdict of a seat wins.
  for (const v of verdicts.sort(byReplayOrder)) {
    const entry = { verdict: v.content.verdict, event: v.id, at: v.created_at, pubkey: v.pubkey }
    if (s.result && v.content.result === s.result.event) s.confirmations[v.content.seat] = entry
    else s.stale.push({ result: v.content.result, seat: v.content.seat, verdict: v.content.verdict, event: v.id })
  }
  return { state: s }
}

const sessionOf = (r: BlueLineRecord<"match.session">): MatchSession => ({
  sv: r.content.sv,
  session: r.content.session,
  from: r.content.from,
  until: r.content.until,
  event: r.id,
  at: r.created_at,
  by: r.pubkey,
})

// The session version of the last valid handover: the same chain rule as apply() below,
// applied to the authority's match.session records alone (no session key can extend it).
function lastSession(records: readonly AnyRecord[], founding: BlueLineRecord<"match.session">, authorities: string[]): number {
  let current = { sv: 1, event: founding.id }
  for (const r of records) {
    if (r.type !== "match.session" || r === founding || r.created_at < founding.created_at) continue
    if (r.pubkey !== founding.pubkey && !authorities.includes(r.pubkey)) continue
    if (r.content.sv === current.sv + 1 && r.content.prev === current.event) current = { sv: r.content.sv, event: r.id }
  }
  return current.sv
}

// A record signed by a session key is valid while that session is the current one and inside
// its window (with the usual clock allowance at the start).
function sessionProblem(s: MatchStateP, r: AnyRecord, sv: number): Problem {
  const session = s.sessions.find((x) => x.sv === sv)
  if (!session) return ["session_unknown", `no session ${sv}`]
  if (session.session !== r.pubkey) return ["not_authorized", "not signed by that session's key"]
  if (sv < s.current.sv) return ["session_superseded", `session ${sv} was handed over`]
  if (r.created_at < session.from - MAX_FUTURE_SKEW_SECONDS || r.created_at > session.until) return ["session_expired", "outside the session's window"]
  return null
}

function apply(s: MatchStateP, r: AnyRecord, authorities: string[], verdicts: BlueLineRecord<"match.confirm">[], finalSv: number, bases: Bases): Problem {
  const isAuthority = r.pubkey === s.authority || authorities.includes(r.pubkey)
  // A private match stays private: every record after the founding is encrypted to the link key.
  if (s.agreement.visibility === "private" && r.encryption !== "link") return ["sealing_required", "a private match's records are encrypted"]

  switch (r.type) {
    case "match.session": {
      const c = r.content
      if (c.sv === 1) return ["wrong_root", "a second founding"]
      if (!isAuthority) return ["not_authorized", "only the match authority hands over"]
      // A predecessor this reader has not loaded: wait for it (docs/protocol/conflicts.md).
      if (c.sv !== s.current.sv + 1 || c.prev !== s.current.event) return staleOr(bases, c.prev as string, `expected session ${s.current.sv + 1} after ${s.current.event}`)
      const next = sessionOf(r)
      s.sessions.push(next)
      s.current = next
      return null
    }

    case "match.live": {
      const c = r.content
      const problem = sessionProblem(s, r, c.sv)
      if (problem) return problem
      if (c.auth.id !== s.sessions.find((x) => x.sv === c.sv)?.event) return ["session_mismatch", "carries another session's authorization"]
      if (!throwsReadable(c.throws)) return ["invalid_content", "throw log does not decode"]
      const better = !s.live || c.sv > s.live.sv || (c.sv === s.live.sv && c.n > s.live.n) || (c.sv === s.live.sv && c.n === s.live.n && byReplayOrder(r, { created_at: s.live.at, id: s.live.event }) > 0)
      if (better) s.live = { event: r.id, sv: c.sv, n: c.n, at: r.created_at, content: c }
      return null
    }

    case "match.result": {
      const c = r.content
      if (!isAuthority) {
        const problem = sessionProblem(s, r, c.sv)
        if (problem) return problem
        if (!c.auth || c.auth.id !== s.sessions.find((x) => x.sv === c.sv)?.event) return ["session_mismatch", "a session's result carries its authorization"]
      }
      if (c.sv !== finalSv) return c.sv < finalSv ? ["session_superseded", `session ${c.sv} was handed over`] : ["session_unknown", `no session ${c.sv}`]
      const seats = s.agreement.seats.length
      if (c.legs.length !== seats || (c.sets && c.sets.length !== seats) || (c.winner !== null && c.winner >= seats)) return ["invalid_content", "does not fit the seats"]
      if (c.throws !== undefined && !throwsReadable(c.throws)) return ["invalid_content", "throw log does not decode"]
      // Results form one chain: each correction (or void) names the newest entry before it.
      const head = s.results.at(-1)
      if ((c.replaces ?? null) !== (head?.event ?? null)) {
        const detail = head ? "a new result replaces the newest one" : "nothing to replace"
        return c.replaces === undefined ? ["stale_predecessor", detail] : staleOr(bases, c.replaces, detail)
      }
      const entry: MatchResultEntry = {
        event: r.id,
        by: r.pubkey,
        at: r.created_at,
        sv: c.sv,
        status: c.status,
        winner: c.winner,
        legs: c.legs,
        ...(c.replaces ? { replaces: c.replaces } : {}),
      }
      s.results.push(entry)
      s.result = c.status === "void" ? null : entry
      return null
    }

    case "match.log": {
      if (!isAuthority && !s.sessions.some((x) => x.session === r.pubkey)) return ["not_authorized", "not a writer of this match"]
      const c = r.content
      ;(s.logs[c.set] ??= []).push({ set: c.set, seq: c.seq, total: c.total, prev: c.prev, data: c.data })
      return null
    }

    case "match.confirm": {
      const c = r.content
      const seat = s.agreement.seats[c.seat]
      if (!seat || seat.pubkey !== r.pubkey) return ["not_a_player", "only the player of that seat confirms"]
      if (!s.results.some((x) => x.event === c.result)) return ["result_unknown", "no such result"]
      verdicts.push(r)
      return null
    }

    default:
      return ["wrong_root", `${r.type} is not a match record`]
  }
}

function throwsReadable(text: string) {
  try {
    decodeThrows(text)
    return true
  } catch {
    return false
  }
}
