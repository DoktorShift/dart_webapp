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
  // a predecessor it holds only sealed); it may apply once that data is there. None of these is
  // a rejection: the app shows "wartet auf Daten" (docs/protocol/conflicts.md).
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
  // Records this reader holds but cannot open: a change naming one of them as its base waits.
  // (A change on a record of an unknown version stays a visible conflict, docs/protocol/kinds.md.)
  const unreadable = new Set(log.unapplied.filter((u) => u.why === "sealed").map((u) => u.id))
  return { records, log, datedAt, unreadable, founding: records.find((r) => r.id === root) ?? null }
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

// A change whose `prev` is not the current base: a visible conflict, unless the base it names
// is a record this reader holds but cannot open; then it waits for that data.
export const staleOr = (unreadable: ReadonlySet<string>, prev: string, detail: string): Problem =>
  unreadable.has(prev) ? ["waiting", "builds on a record this reader cannot open"] : ["stale_predecessor", detail]

// ---- Ends of authority ------------------------------------------------------------------------
//
// Nobody can be stopped from dating a record into the past (docs/decisions/0001, point 10).
// What can be stopped is a key that lost its authority dating records back into the time it
// still had it. Two rules do that (docs/protocol/conflicts.md, "Uhren"):
//
// 1. A hand-over chain (tournament organization, club ownership: offer, cancel, accept) is
//    first replayed on its own. An offer its recipient accepted binds its author: a cancel or
//    another offer of theirs that sorts before the acceptance does not count ("superseded"),
//    and neither does another offer of theirs on the same base.
// 2. The record that ends a tenure (the acceptance of a hand-over, the demotion of a club
//    admin) names the heads its author saw (Pin). A record of the outgoing authority about such
//    a subject that sorts before that end counts only if it is the pinned head or one of its
//    predecessors; everything else it dates into its tenure afterwards is superseded.
//
// Like the final-session rule of matches (match-state.ts), both hold however the outgoing key
// dates its records. Subjects that are not pinned keep the limit described in conflicts.md.

export interface HandoverTypes {
  offer: string
  cancel: string
  accept: string
}

export interface HandoverEnd {
  // The outgoing holder and the acceptance that ended their tenure.
  from: string
  accept: AnyRecord
}

type Offer = { to: string; prev: string }
const contentOf = <T>(r: AnyRecord) => r.content as unknown as T

export function handoverChain(
  records: readonly AnyRecord[],
  founding: AnyRecord,
  types: HandoverTypes,
  // Further condition on whoever accepts (club roles of a club's tournament).
  mayAccept: (pubkey: string, at: number) => boolean = () => true,
): { superseded: Set<string>; ends: HandoverEnd[] } {
  const chainTypes = [types.offer, types.cancel, types.accept]
  const steps = records.filter((r) => r !== founding && chainTypes.includes(r.type) && r.created_at >= founding.created_at)
  const offers = new Map(steps.filter((r) => r.type === types.offer).map((r) => [r.id, r]))
  // The first acceptance of each offer by its recipient, sorting after the offer.
  const acceptOf = new Map<string, AnyRecord>()
  for (const r of steps) {
    if (r.type !== types.accept) continue
    const offer = offers.get(contentOf<{ offer: string }>(r).offer)
    if (!offer || acceptOf.has(offer.id) || contentOf<Offer>(offer).to !== r.pubkey || byReplayOrder(offer, r) >= 0) continue
    if (mayAccept(r.pubkey, r.created_at)) acceptOf.set(offer.id, r)
  }
  const accepted = [...acceptOf.keys()].map((id) => offers.get(id) as AnyRecord)

  const superseded = new Set<string>()
  const ends: HandoverEnd[] = []
  let holder = founding.pubkey
  let head = founding.id
  let open: AnyRecord | null = null
  for (const r of steps) {
    if (r.pubkey === holder && r.type !== types.accept) {
      const bound = open !== null && acceptOf.has(open.id)
      const sibling =
        r.type === types.offer && !acceptOf.has(r.id) && accepted.some((x) => x.pubkey === r.pubkey && contentOf<Offer>(x).prev === contentOf<Offer>(r).prev)
      if (bound || sibling) {
        superseded.add(r.id)
        continue
      }
    }
    if (r.type === types.offer) {
      const c = contentOf<Offer>(r)
      if (r.pubkey === holder && c.prev === head && c.to !== r.pubkey) {
        open = r
        head = r.id
      }
    } else if (r.type === types.cancel) {
      if (r.pubkey === holder && open?.id === contentOf<{ offer: string }>(r).offer) {
        open = null
        head = r.id
      }
    } else if (open !== null && acceptOf.get(open.id) === r) {
      ends.push({ from: holder, accept: r })
      holder = r.pubkey
      open = null
      head = r.id
    }
  }
  return { superseded, ends }
}

export interface Pin {
  // The outgoing authority, and the record that ended its tenure.
  from: string
  end: AnyRecord
  // What the head covers ("core", "info", "member:<pubkey>"), and the head its author saw.
  subject: string
  head: string
}

// The check of rule 2 for one reducer. `subjectOf` says which pinnable subject a record
// changes (null: none), `prevOf` the predecessor it names.
export function pinRule(
  pins: readonly Pin[],
  records: readonly AnyRecord[],
  root: string,
  subjectOf: (r: AnyRecord) => string | null,
  prevOf: (r: AnyRecord) => string,
): (r: AnyRecord) => Problem {
  if (pins.length === 0) return () => null
  const byId = new Map(records.map((r) => [r.id, r]))
  const chains = new Map<Pin, Set<string> | null>()
  // The pinned head and its predecessors; null when a link is missing for this reader.
  const chainOf = (pin: Pin): Set<string> | null => {
    if (chains.has(pin)) return chains.get(pin) as Set<string> | null
    let ids: Set<string> | null = new Set<string>()
    for (let id = pin.head; !ids.has(id); ) {
      ids.add(id)
      if (id === root) break
      const r = byId.get(id)
      if (!r) {
        ids = null
        break
      }
      // A member's chain starts at their join, which is not itself a pinned change.
      if (subjectOf(r) !== pin.subject) break
      id = prevOf(r)
    }
    chains.set(pin, ids)
    return ids
  }
  return (r) => {
    const subject = subjectOf(r)
    if (subject === null) return null
    for (const pin of pins) {
      if (pin.from !== r.pubkey || pin.subject !== subject || byReplayOrder(r, pin.end) >= 0) continue
      const ids = chainOf(pin)
      if (ids === null) return ["waiting", "the state the end of this tenure names is not loaded"]
      if (!ids.has(r.id)) return ["superseded", "dated into a tenure that has ended, and not part of what its successor took over"]
    }
    return null
  }
}

// The outcome of a founding that could not be used.
export type FoundingProblem = "missing" | "invalid" | "sealed" | "unknown_version" | "not_authorized"

export function foundingProblem(log: ReplayLog, root: string): FoundingProblem {
  if (log.unapplied.some((u) => u.id === root && u.why === "sealed")) return "sealed"
  if (log.unapplied.some((u) => u.id === root && u.why === "unknown")) return "unknown_version"
  if (log.rejected.some((x) => x.id === root)) return "invalid"
  return "missing"
}
