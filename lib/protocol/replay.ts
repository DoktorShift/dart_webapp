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
  // reader has no plaintext (not wrapped for them, or no link key).
  why: "unknown" | "sealed"
  version?: string
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
  return { records, log, datedAt, founding: records.find((r) => r.id === root) ?? null }
}

export const reject = (log: ReplayLog, r: AnyRecord, reason: Reason, detail: string) => {
  log.rejected.push({ id: r.id, type: r.type, author: r.pubkey, at: r.created_at, reason, detail })
}

export const applied = (log: ReplayLog, r: AnyRecord) => {
  log.applied.push({ id: r.id, type: r.type, author: r.pubkey, at: r.created_at })
}

// The outcome of a founding that could not be used.
export type FoundingProblem = "missing" | "invalid" | "sealed" | "unknown_version" | "not_authorized"

export function foundingProblem(log: ReplayLog, root: string): FoundingProblem {
  if (log.unapplied.some((u) => u.id === root && u.why === "sealed")) return "sealed"
  if (log.unapplied.some((u) => u.id === root && u.why === "unknown")) return "unknown_version"
  if (log.rejected.some((x) => x.id === root)) return "invalid"
  return "missing"
}
