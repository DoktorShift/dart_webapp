import { coordinateOf, publish as send, type PublishResult, type RelayCode } from "../nostr/client.ts"
import { countOperators, isPublished, mergeRelays } from "../nostr/relays.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { dbGetAll, dbWrite, onStorageChange, type Keyed, type WriteOp } from "../storage/db.ts"

// The persistent outbox (docs/decisions/0002 §5, PLAN.md "Zuverlässige Speicherung"): signed
// events wait here, in IndexedDB, until relays have them. It knows nothing about profiles, games
// or clubs: callers hand over an event, its relays and a delivery rule.
//
//   await enqueue([{ event, relays }], { rule: "published", coalesce: true })
//   const [status] = await deliverNow([event.id])   // one attempt right away, if the caller waits for it
//   await deliveryStatus(event.id)                   // later: waiting, delivered or refused; null once gone
//   await sendWaitingNow()                           // on request: everything waiting, backoff or not
//
// - Rules: "published" (the default) is met once relays of two operators confirmed the event (OK
//   true); "any" once one relay did (a live score, where the next one follows soon). Retrying also
//   ends when every relay answered for good, whatever the rule.
// - Answers: OK true (also "duplicate:") is a confirmed copy; "invalid:", "blocked:", "restricted:"
//   and "pow:" are final refusals; everything else ("rate-limited:", "mute:", "error:", no answer,
//   no connection) is tried again with capped exponential backoff and jitter.
// - coalesce: of replaceable and addressable events only the newest per coordinate stays (a newer
//   live score replaces the waiting one); an older one handed over later is dropped.
// - Copies still missing on some relay once the rule is met are sent again on every start of the
//   app, for a week (decision 0002 §5: "Fehlende Kopien werden beim Öffnen der App erneut gesendet").
// - One tab of a browser sends at a time (Web Locks); the others only add. resumeOutbox() runs the
//   sending in a tab (lib/sync/service.ts calls it at start). Nothing here ever waits on a UI path.

export type DeliveryRule = "published" | "any"

export interface EnqueueOptions {
  rule?: DeliveryRule
  coalesce?: boolean
}

export interface Delivery {
  event: NostrEvent
  relays: readonly string[]
}

// One relay's last answer.
interface RelayAnswer {
  ok: boolean
  code: RelayCode
  reason: string
  // When it came (ms).
  at: number
}

interface Entry extends Keyed {
  // The event id.
  id: string
  event: NostrEvent
  relays: string[]
  rule: DeliveryRule
  // The coordinate of a coalesced event.
  coalesce: string | null
  answers: Record<string, RelayAnswer>
  attempts: number
  queuedAt: number
  // When to try the relays without a final answer again (ms); null once the rule is met.
  retryAt: number | null
}

// "waiting": the rule isn't met yet, it is tried again. "delivered": the rule is met (copies on
// further relays may still follow). "refused": every relay answered for good without meeting it.
export type DeliveryState = "waiting" | "delivered" | "refused"

export interface DeliveryStatus {
  id: string
  kind: number
  rule: DeliveryRule
  state: DeliveryState
  relays: string[]
  // Each relay's last answer; relays not tried yet are missing.
  results: PublishResult[]
  // Relays that confirmed a copy, and how many operators they stand for.
  confirmed: string[]
  operators: number
  attempts: number
  retryAt: number | null
}

type Clock = () => number

const LOCK = "blueline-outbox"
const PERMANENT = new Set<RelayCode>(["invalid", "blocked", "restricted", "pow"])
const BACKOFF = { firstMs: 5000, maxMs: 10 * 60_000 }
// Entries sent at once per round. The lock is given up between rounds, so deliverNow() from
// another call or tab never waits behind a long queue.
const ROUND_SIZE = 16
// Another tab holds the lock: look again this much later (it may have been closed meanwhile).
const BUSY_RETRY_MS = 2000
// How long missing copies are sent again on each start, once the rule is met.
const HEAL_FOR_MS = 7 * 24 * 60 * 60_000

// ---- Rules ------------------------------------------------------------------------------------

const isFinal = (answer: RelayAnswer | undefined) => !!answer && (answer.ok || PERMANENT.has(answer.code))
const confirmedOf = (entry: Entry) => entry.relays.filter((url) => entry.answers[url]?.ok)
const openRelays = (entry: Entry) => entry.relays.filter((url) => !isFinal(entry.answers[url]))

function ruleMet(entry: Entry) {
  const confirmed = confirmedOf(entry)
  return entry.rule === "any" ? confirmed.length > 0 : isPublished(confirmed)
}

// The wait before attempt number `attempts + 1`: doubling from 5 s up to 10 min, half of it fixed
// and half random, so many entries (and devices) don't retry in step.
export function backoffMs(attempts: number, random = Math.random()): number {
  const full = Math.min(BACKOFF.maxMs, BACKOFF.firstMs * 2 ** Math.max(0, attempts - 1))
  return Math.round(full / 2 + (full / 2) * random)
}

function statusOf(entry: Entry): DeliveryStatus {
  const confirmed = confirmedOf(entry)
  return {
    id: entry.id,
    kind: entry.event.kind,
    rule: entry.rule,
    state: ruleMet(entry) ? "delivered" : openRelays(entry).length === 0 ? "refused" : "waiting",
    relays: entry.relays,
    results: entry.relays.flatMap((url) => {
      const answer = entry.answers[url]
      return answer ? [{ url, ok: answer.ok, code: answer.code, reason: answer.reason }] : []
    }),
    confirmed,
    operators: countOperators(confirmed),
    attempts: entry.attempts,
    retryAt: entry.retryAt,
  }
}

// Gone from the outbox: every relay answered for good, or the rule was met so long ago that
// missing copies are no longer chased.
const finished = (entry: Entry, now: number) => openRelays(entry).length === 0 || (entry.retryAt === null && now - entry.queuedAt > HEAL_FOR_MS)
const saveEntry = (entry: Entry, now: number): WriteOp => (finished(entry, now) ? { store: "outbox", delete: entry.id } : putEntry(entry))

// ---- One sender per browser -------------------------------------------------------------------

let localTail: Promise<unknown> = Promise.resolve()
let localBusy = 0

// Runs the task holding the outbox lock. Without `wait` it gives up (null) while another tab or
// call holds it. Without Web Locks (older browsers) the lock covers this page only.
async function withLock<T>(wait: boolean, task: () => Promise<T>): Promise<T | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (locks) return locks.request(LOCK, { ifAvailable: !wait }, (lock) => (lock ? task() : null))
  if (!wait && localBusy > 0) return null
  localBusy++
  const run = localTail.then(task).finally(() => localBusy--)
  localTail = run.catch(() => undefined)
  return run
}

const readEntries = () => dbGetAll<Entry>("outbox")
const putEntry = (entry: Entry): WriteOp => ({ store: "outbox", put: entry })

// ---- Adding -----------------------------------------------------------------------------------

const newer = (a: NostrEvent, b: NostrEvent) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id)

// Queues signed events for their relays. An event already queued gets the new relays added and
// is due again; a coalesced one older than a queued version of its coordinate is dropped.
// Resolves once the queue is stored, before anything is sent.
export async function enqueue(deliveries: readonly Delivery[], options: EnqueueOptions = {}, now: Clock = Date.now): Promise<void> {
  if (deliveries.length === 0) return
  await withLock(true, async () => {
    const entries = new Map((await readEntries()).map((e) => [e.id, e]))
    const ops = new Map<string, WriteOp>()
    const put = (entry: Entry) => {
      entries.set(entry.id, entry)
      ops.set(entry.id, putEntry(entry))
    }
    for (const delivery of deliveries) {
      const { event } = delivery
      const relays = mergeRelays(delivery.relays)
      const known = entries.get(event.id)
      if (known) {
        const added = relays.filter((url) => !known.relays.includes(url))
        if (added.length > 0) put({ ...known, relays: [...known.relays, ...added], retryAt: now() })
        continue
      }
      const coalesce = options.coalesce ? coordinateOf(event) : null
      if (coalesce) {
        const versions = [...entries.values()].filter((e) => e.coalesce === coalesce)
        if (versions.some((e) => newer(e.event, event))) continue
        for (const old of versions) {
          entries.delete(old.id)
          ops.set(old.id, { store: "outbox", delete: old.id })
        }
      }
      put({ id: event.id, event, relays, rule: options.rule ?? "published", coalesce, answers: {}, attempts: 0, queuedAt: now(), retryAt: now() })
    }
    await dbWrite([...ops.values()])
  })
  schedule()
}

// ---- Sending ----------------------------------------------------------------------------------

// One attempt for each entry, on its relays without a final answer, all at once. Each comes back
// with its next try set: after a backoff, or none once the rule is met.
function attempt(entries: readonly Entry[], now: Clock): Promise<Entry[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const results = await send(entry.event, openRelays(entry))
      const answers = { ...entry.answers }
      for (const r of results) answers[r.url] = { ok: r.ok, code: r.code, reason: r.reason, at: now() }
      const tried = { ...entry, answers, attempts: entry.attempts + 1 }
      return { ...tried, retryAt: ruleMet(tried) ? null : now() + backoffMs(tried.attempts) }
    }),
  )
}

// Sends the given entries now, due or not, and returns their state. Entries not in the outbox
// (never queued, or done and gone) are left out.
export async function deliverNow(ids: readonly string[], now: Clock = Date.now): Promise<DeliveryStatus[]> {
  const wanted = new Set(ids)
  const statuses = await withLock(true, async () => {
    const entries = (await readEntries()).filter((e) => wanted.has(e.id))
    const tried = await attempt(
      entries.filter((e) => openRelays(e).length > 0),
      now,
    )
    await dbWrite(tried.map((e) => saveEntry(e, now())))
    return [...new Map([...entries, ...tried].map((e) => [e.id, e])).values()].map(statusOf)
  })
  schedule()
  return statuses ?? []
}

// Sends what is due, a round at a time, until nothing is due or another tab is sending.
export async function flushDue(now: Clock = Date.now): Promise<void> {
  let busy = false
  for (;;) {
    const sent = await withLock(false, async () => {
      const at = now()
      const due = (await readEntries()).filter((e) => e.retryAt !== null && e.retryAt <= at).slice(0, ROUND_SIZE)
      if (due.length === 0) return false
      const tried = await attempt(due, now)
      await dbWrite(tried.map((e) => saveEntry(e, now())))
      return true
    })
    busy = sent === null
    if (!sent) break
  }
  schedule(busy ? BUSY_RETRY_MS : 0)
}

// Makes entries due now and sends them: every waiting one, or also the delivered ones still
// missing copies (a start of the app). Missing copies older than a week are given up instead.
async function dueNow(withMissingCopies: boolean, now: Clock) {
  await withLock(true, async () => {
    const at = now()
    const ops = (await readEntries()).flatMap((e): WriteOp[] => {
      if (e.retryAt !== null) return e.retryAt > at ? [putEntry({ ...e, retryAt: at })] : []
      if (!withMissingCopies || openRelays(e).length === 0) return []
      return [finished(e, at) ? { store: "outbox", delete: e.id } : putEntry({ ...e, retryAt: at })]
    })
    await dbWrite(ops)
  })
  await flushDue(now)
}

// Sends everything waiting right away, whatever its backoff says: the device is back online, or
// the person asked for it ("Jetzt abgleichen", "Erneut versuchen").
export const sendWaitingNow = (now: Clock = Date.now) => dueNow(false, now)

// ---- Reading ----------------------------------------------------------------------------------

export async function deliveryStatus(id: string): Promise<DeliveryStatus | null> {
  const entry = (await readEntries()).find((e) => e.id === id)
  return entry ? statusOf(entry) : null
}

// Everything in the outbox, oldest first: waiting events, and delivered ones still missing copies.
export async function outboxStatus(): Promise<DeliveryStatus[]> {
  return (await readEntries()).sort((a, b) => a.queuedAt - b.queuedAt).map(statusOf)
}

export interface OutboxCounts {
  // Entries whose rule isn't met yet.
  waiting: number
  // Entries meant for two operators (decision 0002 §5) that fewer than two confirmed so far.
  fewCopies: number
  // Everything kept, missing copies included.
  kept: number
}

export async function outboxCounts(): Promise<OutboxCounts> {
  const entries = await outboxStatus()
  return {
    waiting: entries.filter((e) => e.state === "waiting").length,
    fewCopies: entries.filter((e) => e.rule === "published" && e.operators < 2).length,
    kept: entries.length,
  }
}

// ---- Running in the background ----------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined
let resumed = false

// Wakes this tab up when the next entry falls due (no earlier than `atLeastMs`).
function schedule(atLeastMs = 0) {
  if (!resumed) return
  void readEntries().then(
    (entries) => {
      clearTimeout(timer)
      const due = Math.min(...entries.flatMap((e) => (e.retryAt === null ? [] : [e.retryAt])))
      if (!Number.isFinite(due)) return
      timer = setTimeout(() => void flushDue(), Math.min(Math.max(atLeastMs, due - Date.now()), 2 ** 31 - 1))
      ;(timer as { unref?: () => void }).unref?.()
    },
    () => {
      // The database can't be read now; the next change or start schedules again.
    },
  )
}

// Starts sending in this tab: missing copies and everything due now, then whenever something
// falls due, the device is back online or the app is shown again. Once per page.
export async function resumeOutbox(): Promise<void> {
  if (resumed) return
  resumed = true
  if (typeof window !== "undefined") window.addEventListener("online", () => void sendWaitingNow())
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void flushDue())
  // Another tab queued or sent something.
  onStorageChange((message) => {
    if (message.type === "wipe" || message.stores.includes("outbox")) schedule()
  })
  await dueNow(true, Date.now)
}
