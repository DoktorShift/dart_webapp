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

// A change whose `prev` is not the current base: a visible conflict when that base is a record
// of this set (it was replaced, or never valid). When this reader holds it only sealed, or has
// not loaded it at all, the change waits for that data (docs/protocol/conflicts.md, "Abspielen").
export function staleOr(bases: Bases, prev: string, detail: string): Problem {
  if (bases.unreadable.has(prev)) return ["waiting", "builds on a record this reader cannot open"]
  if (!bases.known.has(prev)) return ["waiting", "builds on a record this reader has not loaded"]
  return ["stale_predecessor", detail]
}

// ---- Chains of predecessors -------------------------------------------------------------------

export interface Chains {
  // `head` and its predecessors on `subject`, following `prev` back to the root or to a record
  // of another subject (a member's chain starts at their join); null when a link is missing
  // for this reader.
  of(head: string, subject: string): ReadonlySet<string> | null
}

export function chainsOf(records: readonly AnyRecord[], root: string, subjectOf: (r: AnyRecord) => string | null, prevOf: (r: AnyRecord) => string): Chains {
  const byId = new Map(records.map((r) => [r.id, r]))
  const memo = new Map<string, Set<string> | null>()
  return {
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
        id = prevOf(r)
      }
      memo.set(key, ids)
      return ids
    },
  }
}

// Rule Ü2 c: a head an acceptance names must be the one its offer named, or built on it.
export function buildsOn(chains: Chains, head: string, base: string, subject: string, what: string): Problem {
  const ids = chains.of(head, subject)
  if (ids === null) return ["waiting", `the ${what} it names is not loaded`]
  return ids.has(base) ? null : ["invalid_content", `names an older ${what} than the offer hands over`]
}

// ---- Ends of authority ------------------------------------------------------------------------
//
// Nobody can be stopped from dating a record into the past (docs/decisions/0001, point 10).
// What can be stopped is a key that lost its authority dating records back into the time it
// still had it. The record that ends a tenure names the state its author took over (a Pin):
// the outgoing authority's records about that subject that sort before the end count only when
// they belong to that state, the named head or one of its predecessors (pinRule). Like the
// final-session rule of matches (match-state.ts), this holds however the outgoing key dates
// its records. docs/protocol/conflicts.md states the rules ("Übergaben", Ü1–Ü6, and
// "Herabstufung"); the comments below name them.

export interface Pin {
  // The outgoing authority, and the record that ended its tenure.
  from: string
  end: AnyRecord
  // What the head covers ("chain", "core", "info", "member:<pubkey>"), and the head its
  // author named.
  subject: string
  head: string
  // The start of the tenure (the founding or the acceptance that began it, an admin's
  // appointment): records sorting at or before it are not checked. So the end of one tenure
  // never reaches into an earlier one, and a later hand-over cannot change whether an earlier
  // acceptance holds.
  since?: AnyRecord
}

// Rule Ü5 (and the demotion rule) for one reducer: `subjectOf` says which pinnable subject a
// record changes (null: none).
export function pinRule(pins: readonly Pin[], chains: Chains, subjectOf: (r: AnyRecord) => string | null): (r: AnyRecord) => Problem {
  if (pins.length === 0) return () => null
  return (r) => {
    const subject = subjectOf(r)
    if (subject === null) return null
    for (const pin of pins) {
      if (pin.from !== r.pubkey || pin.subject !== subject || byReplayOrder(r, pin.end) >= 0) continue
      if (pin.since && byReplayOrder(r, pin.since) <= 0) continue
      const ids = chains.of(pin.head, pin.subject)
      if (ids === null) return ["waiting", "the state the end of this tenure names is not loaded"]
      if (!ids.has(r.id)) return ["superseded", "dated into a tenure that has ended, and not part of what its successor took over"]
    }
    return null
  }
}

export interface HandoverTypes {
  offer: string
  cancel: string
  accept: string
}

export interface HandoverEnd {
  // The outgoing holder, the start of their tenure (the founding, or the acceptance that
  // began it), the offer and the acceptance that ended it.
  from: string
  since: AnyRecord
  offer: AnyRecord
  accept: AnyRecord
}

// What a reducer knows about the hand-overs of one replay.
export interface Handovers {
  // Rule Ü3: offer id -> its first acceptance by the recipient, dated after it.
  answers: ReadonlyMap<string, string>
  // The proposed ends of this replay (rule Ü4).
  ends: ReadonlySet<string>
  // Offer id -> why its answer did not hold when replayed as an end.
  refused: ReadonlyMap<string, Problem>
}

// The hand-over records form one chain: an offer names the record before it (`prev`), a
// cancel and an acceptance the offer they answer.
export const handoverSubject = (types: HandoverTypes) => (r: AnyRecord) => (r.type === types.offer || r.type === types.cancel || r.type === types.accept ? "chain" : null)
export const handoverPrev = (types: HandoverTypes) => (r: AnyRecord) => {
  const c = r.content as { prev?: string; offer?: string }
  return (r.type === types.offer ? c.prev : c.offer) as string
}

const contentOf = <T>(r: AnyRecord) => r.content as unknown as T

// Rule Ü3: only the first acceptance of an offer by its recipient, dated after the offer,
// answers it.
export function firstAnswers(records: readonly AnyRecord[], types: HandoverTypes): Map<string, string> {
  const offers = new Map(records.filter((r) => r.type === types.offer).map((r) => [r.id, r]))
  const first = new Map<string, string>()
  for (const r of records) {
    if (r.type !== types.accept) continue
    const offer = offers.get(contentOf<{ offer: string }>(r).offer)
    if (!offer || first.has(offer.id) || contentOf<{ to: string }>(offer).to !== r.pubkey || byReplayOrder(offer, r) >= 0) continue
    first.set(offer.id, r.id)
  }
  return first
}

// Rule Ü4, the proposal: following the holders from the founding, the first answer in replay
// order to an offer the current holder made in their tenure, unless it was refused. Whether it
// holds is the replay's to say (settleHandovers).
export function handoverEnds(
  records: readonly AnyRecord[],
  founding: AnyRecord,
  types: HandoverTypes,
  answers: ReadonlyMap<string, string>,
  refused: ReadonlyMap<string, Problem>,
): HandoverEnd[] {
  const byId = new Map(records.map((r) => [r.id, r]))
  const ends: HandoverEnd[] = []
  let holder = founding.pubkey
  let start: AnyRecord = founding
  for (const r of records) {
    if (r.type !== types.accept) continue
    const id = contentOf<{ offer: string }>(r).offer
    const offer = byId.get(id)
    if (!offer || answers.get(id) !== r.id || refused.has(id) || offer.pubkey !== holder || byReplayOrder(start, offer) >= 0) continue
    ends.push({ from: holder, since: start, offer, accept: r })
    holder = r.pubkey
    start = r
  }
  return ends
}

// Rule Ü4, the decision: replays with the proposed ends and refuses the first one the replay
// did not apply, then proposes again, until every proposed end holds. Each round refuses one
// offer's only answer, so there are at most as many rounds as offers; without a refusal (the
// usual case) it is a single replay.
export function settleHandovers<T extends { log: ReplayLog }>(
  propose: (refused: ReadonlyMap<string, Problem>) => HandoverEnd[],
  run: (ends: readonly HandoverEnd[], refused: ReadonlyMap<string, Problem>) => T,
): T {
  const refused = new Map<string, Problem>()
  for (;;) {
    const ends = propose(refused)
    const result = run(ends, refused)
    const done = new Set(result.log.applied.map((a) => a.id))
    const failed = ends.find((e) => !done.has(e.accept.id))
    if (!failed) return result
    const no = result.log.rejected.find((x) => x.id === failed.accept.id)
    const waits = result.log.unapplied.find((x) => x.id === failed.accept.id)
    refused.set(failed.offer.id, no ? [no.reason, no.detail] : ["waiting", waits?.detail ?? "waits for data"])
  }
}

const offerOf = (accept: AnyRecord) => contentOf<{ offer: string }>(accept).offer

// The reducers check an acceptance in this order: the open offer and its recipient, laterAnswer
// (Ü3), the offer's time and heads (Ü2 b, c), their own conditions (Ü2 d), and last notTheEnd.
export const laterAnswer = (h: Handovers, accept: AnyRecord): Problem =>
  h.answers.get(offerOf(accept)) === accept.id ? null : ["no_open_offer", "the offer was answered by an earlier acceptance"]

// An acceptance that passes every check but is not a proposed end: its offer's answer was
// refused when replayed as the end (with the problem it had then), or settleHandovers has not
// settled yet. So no acceptance changes the holder unless it is an end with its pins.
export const notTheEnd = (h: Handovers, accept: AnyRecord): Problem =>
  h.ends.has(accept.id) ? null : (h.refused.get(offerOf(accept)) ?? ["no_open_offer", "not the acceptance that ends this tenure"])

// The outcome of a founding that could not be used.
export type FoundingProblem = "missing" | "invalid" | "sealed" | "unknown_version" | "not_authorized"

export function foundingProblem(log: ReplayLog, root: string): FoundingProblem {
  if (log.unapplied.some((u) => u.id === root && u.why === "sealed")) return "sealed"
  if (log.unapplied.some((u) => u.id === root && u.why === "unknown")) return "unknown_version"
  if (log.rejected.some((x) => x.id === root)) return "invalid"
  return "missing"
}
