import type { Reason } from "./reasons.ts"
import type { AnyRecord } from "./records.ts"
import { parseRecord } from "./records.ts"
import type { SignedEvent } from "./tags.ts"
import { byReplayOrder, encryptionOf } from "./tags.ts"

// Shared groundwork of the state reducers (docs/protocol/conflicts.md): parse every event,
// drop copies of the same id, sort by created_at then id, and sort out what cannot be applied.
// The reducers then walk the records in that order and check each against the author's role
// at that point. Same events in, same state out, on every device.

export interface Rejected {
  id: string
  type: string | null
  author: string
  at: number
  reason: Reason
  detail: string
}

export interface Unapplied {
  id: string
  type: string
  author: string
  at: number
  // "unknown": newer type or version, kept but not executed. "sealed": encrypted, and this
  // reader has no plaintext (not wrapped for them, or no link key). "waiting": readable, but it
  // builds on a record this reader cannot open or has not loaded (an invite sealed for others,
  // a predecessor it holds only sealed or never received); it may apply once that data is
  // there. None of these is a rejection: the app shows "wartet auf Daten"
  // (docs/protocol/conflicts.md).
  why: "unknown" | "sealed" | "waiting"
  version?: string
  detail?: string
}

export interface ReplayLog {
  // Records that changed the state, in replay order.
  applied: { id: string; type: string; author: string; at: number }[]
  rejected: Rejected[]
  unapplied: Unapplied[]
}

export interface ReplayOptions {
  // Reader's clock, unix seconds; events further than 15 minutes ahead are not (yet) applied.
  now?: number
  // Decrypted content of an encrypted event, when this reader could open it: from
  // openSealedEvents (seal.ts) for sealed records, or with the link key of a private match.
  open?: (event: SignedEvent) => string | null
}

export { byReplayOrder }

export function prepare(events: readonly unknown[], root: string, opts: ReplayOptions) {
  const log: ReplayLog = { applied: [], rejected: [], unapplied: [] }
  const seen = new Set<string>()
  const records: AnyRecord[] = []
  for (const event of events) {
    const id = (event as { id?: unknown })?.id
    if (typeof id === "string" && seen.has(id)) continue
    if (typeof id === "string") seen.add(id)
    const tags = (event as SignedEvent)?.tags
    const encrypted = Array.isArray(tags) && tags.every(Array.isArray) && encryptionOf(tags).form !== "none"
    const parsed = parseRecord(event, { now: opts.now, plaintext: encrypted && opts.open ? opts.open(event as SignedEvent) : undefined })
    if (parsed.status === "invalid") {
      const e = parsed.event as Partial<SignedEvent> | undefined
      log.rejected.push({
        id: typeof e?.id === "string" ? e.id : "",
        type: parsed.type ?? null,
        author: typeof e?.pubkey === "string" ? e.pubkey : "",
        at: typeof e?.created_at === "number" ? e.created_at : 0,
        reason: parsed.reason,
        detail: parsed.detail,
      })
    } else if (parsed.status === "unknown") {
      log.unapplied.push({ id: parsed.event.id, type: parsed.type, author: parsed.event.pubkey, at: parsed.event.created_at, why: "unknown", version: parsed.version })
    } else if (parsed.status === "sealed" && parsed.root !== root) {
      log.rejected.push({ id: parsed.event.id, type: parsed.type, author: parsed.event.pubkey, at: parsed.event.created_at, reason: "wrong_root", detail: "belongs to another object" })
    } else if (parsed.status === "sealed") {
      log.unapplied.push({ id: parsed.event.id, type: parsed.type, author: parsed.event.pubkey, at: parsed.event.created_at, why: "sealed" })
    } else if (parsed.record.root !== root) {
      const r = parsed.record
      log.rejected.push({ id: r.id, type: r.type, author: r.pubkey, at: r.created_at, reason: "wrong_root", detail: "belongs to another object" })
    } else {
      records.push(parsed.record)
    }
  }
  records.sort(byReplayOrder)
  // Same set of events, same lists: independent of arrival order.
  const byAt = (a: { at: number; id: string }, b: { at: number; id: string }) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  log.rejected.sort(byAt)
  log.unapplied.sort(byAt)
  // When each record of this set was dated, including those this reader cannot open: a
  // reference to a record dated later than the referring one is never a valid base.
  const datedAt = new Map<string, number>([...records.map((r) => [r.id, r.created_at] as const), ...log.unapplied.map((u) => [u.id, u.at] as const)])
  const bases: Bases = {
    // Records this reader holds but cannot open: a change naming one of them as its base waits.
    unreadable: new Set(log.unapplied.filter((u) => u.why === "sealed").map((u) => u.id)),
    // Every event id of this set, whatever became of it: a base outside it was not loaded.
    known: seen,
  }
  return { records, log, datedAt, bases, founding: records.find((r) => r.id === root) ?? null }
}

// A fresh copy of a prepared log, for a reducer that replays more than once.
export const copyLog = (log: ReplayLog): ReplayLog => ({ applied: [...log.applied], rejected: [...log.rejected], unapplied: [...log.unapplied] })

export const reject = (log: ReplayLog, r: AnyRecord, reason: Reason, detail: string) => {
  log.rejected.push({ id: r.id, type: r.type, author: r.pubkey, at: r.created_at, reason, detail })
}

export const applied = (log: ReplayLog, r: AnyRecord) => {
  log.applied.push({ id: r.id, type: r.type, author: r.pubkey, at: r.created_at })
}

// What a reducer says about one record: nothing (applied), a rejection, or "waiting".
export type Problem = [Reason | "waiting", string] | null

export function settle(log: ReplayLog, r: AnyRecord, problem: Problem) {
  if (!problem) applied(log, r)
  else if (problem[0] === "waiting") log.unapplied.push({ id: r.id, type: r.type, author: r.pubkey, at: r.created_at, why: "waiting", detail: problem[1] })
  else reject(log, r, problem[0], problem[1])
}

// What a reader holds of the records a change may name as its base.
export interface Bases {
  unreadable: ReadonlySet<string>
  known: ReadonlySet<string>
}

// A base this reader holds only sealed, or has not loaded: a change naming it waits for that
// data (docs/protocol/conflicts.md, "Abspielen").
function missingBase(bases: Bases, prev: string): Problem {
  if (bases.unreadable.has(prev)) return ["waiting", "builds on a record this reader cannot open"]
  if (!bases.known.has(prev)) return ["waiting", "builds on a record this reader has not loaded"]
  return null
}

// A change whose `prev` is not the current base: a visible conflict when that base is a record
// of this set (it was replaced, or never valid); otherwise it waits.
export const staleOr = (bases: Bases, prev: string, detail: string): Problem => missingBase(bases, prev) ?? ["stale_predecessor", detail]

// Club and tournament changes wait for a missing base before anything else is checked: whether
// the member, the place or the slot they name exists may be in that very record. (Not for
// matches: a match.log's `prev` is a chunk hash.)
export const waitsForPrev = (bases: Bases, r: AnyRecord): Problem => {
  const prev = (r.content as { prev?: unknown }).prev
  return typeof prev === "string" ? missingBase(bases, prev) : null
}

// ---- Ends of authority ------------------------------------------------------------------------
//
// Nobody can be stopped from dating a record into the past (docs/decisions/0001, point 10).
// What can be stopped is a key that lost its authority dating records back into the time it
// still had it. The record that ends a tenure names the state its author took over (a Pin), and
// records that do not fit that state are superseded however they are dated, like the
// final-session rule of matches (match-state.ts). docs/protocol/conflicts.md states the rules
// ("Übergaben", Ü1 to Ü6, and "Herabstufung") and their limits.

export interface Pin {
  // The record that ends a tenure, the subject it pins ("chain", "core", "info",
  // "member:<pubkey>") and the head it names there.
  end: AnyRecord
  subject: string
  head: string
  // Whose records it judges. With `author`: that key's records after `since`, the start of its
  // tenure; they count only when they belong to the named state (the hand-over chain, a demoted
  // admin's club changes). Without: everyone's, however dated (the state an acceptance takes
  // over, rule Ü5); up to `end` the subject follows the named state, so a record that branches
  // off it (names one of its records as its base without being one) is superseded, while
  // records about an earlier membership, say, are not.
  author?: string
  since?: AnyRecord
}

interface Chains {
  subjectOf(r: AnyRecord): string | null
  baseOf(r: AnyRecord): string
  // `head` and its bases on `subject`, back to the root or to a record of another subject (a
  // member's state starts at their join); null when a link is missing for this reader.
  of(head: string, subject: string): ReadonlySet<string> | null
}

function chainsOf(records: readonly AnyRecord[], root: string, subjectOf: Chains["subjectOf"], baseOf: Chains["baseOf"]): Chains {
  const byId = new Map(records.map((r) => [r.id, r]))
  const memo = new Map<string, Set<string> | null>()
  return {
    subjectOf,
    baseOf,
    of(head, subject) {
      const key = `${subject} ${head}`
      if (memo.has(key)) return memo.get(key) as Set<string> | null
      let ids: Set<string> | null = new Set<string>()
      for (let id = head; !ids.has(id); ) {
        ids.add(id)
        if (id === root) break
        const r = byId.get(id)
        if (!r) {
          ids = null
          break
        }
        if (subjectOf(r) !== subject) break
        id = baseOf(r)
      }
      memo.set(key, ids)
      return ids
    },
  }
}

function pinRule(pins: readonly Pin[], chains: Chains): (r: AnyRecord) => Problem {
  return (r) => {
    const subject = chains.subjectOf(r)
    if (subject === null) return null
    for (const pin of pins) {
      if (pin.subject !== subject || byReplayOrder(r, pin.end) >= 0) continue
      if (pin.author !== undefined && (pin.author !== r.pubkey || (pin.since && byReplayOrder(r, pin.since) <= 0))) continue
      const state = chains.of(pin.head, subject)
      if (state === null) return ["waiting", "the state the end of this tenure names is not loaded"]
      if (state.has(r.id)) continue
      if (pin.author !== undefined) return ["superseded", "dated into a tenure that has ended, and not part of what its successor took over"]
      if (state.has(chains.baseOf(r))) return ["superseded", "branches off the state a hand-over took over"]
    }
    return null
  }
}

// ---- Hand-overs ---------------------------------------------------------------------------------
//
// The organization of a tournament and the ownership of a club change hands by offer and
// acceptance (rules Ü1 to Ü5). settleHandovers decides which acceptances end a tenure and
// replays with their pins; the reducers ask the Handovers it gives them about each acceptance.

export interface HandoverRules {
  types: { offer: string; cancel: string; accept: string }
  // The pinnable subject another record changes (null: none); such records name their base as
  // `prev`.
  subjectOf(r: AnyRecord): string | null
  // Rule Ü1: the heads an offer or acceptance names, by subject, for a hand-over to `to`.
  heads(r: AnyRecord, to: string): Record<string, string>
}

export interface Handovers {
  // Rule Ü5 for the ends of this replay, plus further ends the reducer found (a club's
  // demotions): why a record does not count, or null.
  pinned(more?: readonly Pin[]): (r: AnyRecord) => Problem
  // Rules Ü2 to Ü4: why an acceptance does not end the holder's tenure at this point of the
  // replay (`open`: the offer open there), or null when it does.
  accept(r: AnyRecord, open: string | null): Problem
}

interface Answer {
  accept: AnyRecord
  offer?: AnyRecord
  // Why it cannot end a tenure whatever the replay says, or null.
  problem: Problem
}

interface End {
  // The outgoing holder, the start of their tenure (the founding, or the acceptance that began
  // it), the offer and the acceptance that ends it.
  from: string
  since: AnyRecord
  offer: AnyRecord
  accept: AnyRecord
}

const CHAIN = "chain"
const contentOf = <T>(r: AnyRecord) => r.content as unknown as T

// Rule Ü4: a hand-over holds when the replay applies its acceptance as the end of the tenure.
// Proposes the ends, replays with them (`run`), and when the replay did not apply one, refuses
// it and proposes again. Each round refuses one acceptance that passed every check not
// depending on the replay, so there are at most that many rounds; usually there is one.
export function settleHandovers<T extends { log: ReplayLog }>(records: readonly AnyRecord[], founding: AnyRecord, rules: HandoverRules, run: (h: Handovers) => T): T {
  const { types } = rules
  const inChain = (r: AnyRecord) => r.type === types.offer || r.type === types.cancel || r.type === types.accept
  // The hand-over records form one chain: an offer names the record before it (`prev`), a
  // cancel and an acceptance the offer they answer.
  const chains = chainsOf(
    records,
    founding.id,
    (r) => (inChain(r) ? CHAIN : rules.subjectOf(r)),
    (r) => (r.type === types.offer || !inChain(r) ? contentOf<{ prev: string }>(r).prev : contentOf<{ offer: string }>(r).offer),
  )
  const answers = answersOf(records, rules, chains)
  const refused = new Map<string, Problem>()
  for (;;) {
    const ends = proposeEnds(founding, answers, refused)
    const isEnd = new Set(ends.map((e) => e.accept.id))
    const pins = ends.flatMap(({ from, since, offer, accept }): Pin[] => [
      { end: accept, subject: CHAIN, head: offer.id, author: from, since },
      ...Object.entries(rules.heads(accept, accept.pubkey)).map(([subject, head]) => ({ end: accept, subject, head })),
    ])
    const result = run({
      pinned: (more = []) => pinRule([...pins, ...more], chains),
      accept(r, open) {
        const answer = answers.get(r.id) as Answer
        if (!answer.offer || answer.offer.id !== open) return ["no_open_offer", "no such open offer"]
        if (answer.problem) return answer.problem
        return isEnd.has(r.id) ? null : (refused.get(r.id) ?? ["no_open_offer", "not the acceptance that ends this tenure"])
      },
    })
    const done = new Set(result.log.applied.map((a) => a.id))
    const failed = ends.find((e) => !done.has(e.accept.id))
    if (!failed) return result
    const no = result.log.rejected.find((x) => x.id === failed.accept.id)
    const waits = result.log.unapplied.find((x) => x.id === failed.accept.id)
    refused.set(failed.accept.id, no ? [no.reason, no.detail] : ["waiting", waits?.detail ?? "waits for data"])
  }
}

// Rules Ü2 a to c and Ü3 for every acceptance, in replay order: the checks that do not depend on
// the replay. Only the first acceptance of an offer by its recipient, dated after the offer,
// answers it, even when that answer does not hold.
function answersOf(records: readonly AnyRecord[], rules: HandoverRules, chains: Chains): Map<string, Answer> {
  const offers = new Map(records.filter((r) => r.type === rules.types.offer).map((r) => [r.id, r]))
  const answered = new Set<string>()
  const problemOf = (accept: AnyRecord, offer: AnyRecord | undefined): Problem => {
    if (!offer || byReplayOrder(offer, accept) >= 0) return ["no_open_offer", "no such open offer"]
    const { to, expires } = contentOf<{ to: string; expires: number }>(offer)
    if (accept.pubkey !== to) return ["not_authorized", "the offer is for someone else"]
    if (answered.has(offer.id)) return ["no_open_offer", "the offer was answered by an earlier acceptance"]
    answered.add(offer.id)
    if (accept.created_at > expires) return ["no_open_offer", "the offer has expired"]
    // Rule Ü2 c: every head the acceptance names is its offer's or built on it.
    const named = rules.heads(accept, to)
    for (const [subject, base] of Object.entries(rules.heads(offer, to))) {
      const state = chains.of(named[subject], subject)
      if (state === null) return ["waiting", "the state it names is not loaded"]
      if (!state.has(base)) return ["invalid_content", "names an older state than the offer hands over"]
    }
    return null
  }
  const answers = new Map<string, Answer>()
  for (const accept of records) {
    if (accept.type !== rules.types.accept) continue
    const offer = offers.get(contentOf<{ offer: string }>(accept).offer)
    answers.set(accept.id, { accept, offer, problem: problemOf(accept, offer) })
  }
  return answers
}

// Rule Ü4, the proposal: following the holders from the founding, the first acceptance in replay
// order without a problem above and not refused that answers an offer the current holder made
// in their tenure.
function proposeEnds(founding: AnyRecord, answers: ReadonlyMap<string, Answer>, refused: ReadonlyMap<string, Problem>): End[] {
  const ends: End[] = []
  let holder = founding.pubkey
  let since = founding
  for (const { accept, offer, problem } of answers.values()) {
    if (problem || !offer || refused.has(accept.id) || offer.pubkey !== holder || byReplayOrder(since, offer) >= 0) continue
    ends.push({ from: holder, since, offer, accept })
    holder = accept.pubkey
    since = accept
  }
  return ends
}

// The outcome of a founding that could not be used.
export type FoundingProblem = "missing" | "invalid" | "sealed" | "unknown_version"

export function foundingProblem(log: ReplayLog, root: string): FoundingProblem {
  if (log.unapplied.some((u) => u.id === root && u.why === "sealed")) return "sealed"
  if (log.unapplied.some((u) => u.id === root && u.why === "unknown")) return "unknown_version"
  if (log.rejected.some((x) => x.id === root)) return "invalid"
  return "missing"
}
