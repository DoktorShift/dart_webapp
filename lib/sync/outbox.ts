import { coordinateOf, publish as send, supersedes, type PublishResult, type RelayCode } from "../nostr/client.ts"
import { countOperators, isPublished, mergeRelays, PUBLISHED_MIN_OPERATORS } from "../nostr/relays.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { dbGetAll, dbWrite, onStorageChange, type Keyed, type WriteOp } from "../storage/db.ts"

// The persistent outbox (docs/decisions/0002 §5, PLAN.md "Zuverlässige Speicherung"): the one
// way signed events leave the device. They wait here, in IndexedDB, until relays have them. It
// knows nothing about profiles, games or clubs: callers hand over an event, its relays, a
// delivery rule and, where order matters, the events it goes out after.
//
//   await enqueue([{ event, relays, after: [founding.id] }], { rule: "published", coalesce: true })
//   const [status] = await deliverNow([event.id])   // one attempt right away, if the caller waits for it
//   await deliveryStatus(event.id)                   // later: waiting, delivered or refused; null once gone
//   await sendWaitingNow()                           // on request: everything waiting, backoff or not
//   await pendingEvents(select)                      // what another device takes over (and withdraw() here)
//
// - Rules: "published" (the default) is met once relays of two operators confirmed the event (OK
//   true); "any" once one relay did (a live score, where the next one follows soon). Retrying also
//   ends when every relay answered for good, whatever the rule.
// - Answers: OK true (also "duplicate:") is a confirmed copy; "invalid:", "blocked:", "restricted:"
//   and "pow:" are final refusals; everything else ("rate-limited:", "mute:", "error:", no answer,
//   no connection) is tried again with capped exponential backoff and jitter. "mute:" is a relay's
//   current policy towards a key, not a verdict on the event, so it is tried again like
//   "rate-limited:"; a refusal that never lifts ends with the week below.
// - Order: an entry goes out once each event in its `after` has a copy on some relay, was refused
//   for good, or is no longer here (done, given up, never queued). One copy is the bar, the same
//   as rule "any": a reader merges what every relay has, and the earlier event is on its way to
//   the rest.
// - coalesce: of replaceable and addressable events only the newest per coordinate stays (a newer
//   live score replaces the waiting one); an older one handed over later is dropped.
// - Copies still missing on some relay once the rule is met are sent again on every start of the
//   app, for a week (decision 0002 §5: "Fehlende Kopien werden beim Öffnen der App erneut gesendet").
//   The week counts from the first attempt, so an event queued offline or before the app was
//   closed for longer waits as long as it takes. After that week an entry is given up, met or
//   not: a record a relay keeps refusing is written anew by the next full sync, not chased
//   forever. An entry every relay refused for good stays until then as "refused" (sent no more),
//   so callers can tell a refusal from a delivery; one every relay answered for good that some
//   relay took is done and gone at once.
// - The lock (Web Locks, one per browser) covers the queue's state only, never the network: a
//   round picks its entries under it and leases them, sends without it, and merges the answers
//   under it again. Other tabs' rounds pass leased entries over; enqueue() only ever waits for
//   state writes. Nothing here ever waits on a UI path. The sending runs in a page once
//   resumeOutbox() was called (at start by the shell when something waits,
//   components/shell/outbox-start.ts, and by lib/sync/service.ts) or something was queued.

export type DeliveryRule = "published" | "any"

export interface EnqueueOptions {
  rule?: DeliveryRule
  coalesce?: boolean
}

export interface Delivery {
  event: NostrEvent
  relays: readonly string[]
  // Ids of the events this one goes out after (see the header).
  after?: readonly string[]
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
  after: string[]
  answers: Record<string, RelayAnswer>
  attempts: number
  queuedAt: number
  // When the first round got answers (ms); the week it is kept counts from here. Missing until
  // then, and in entries stored before it was recorded: not tried yet.
  firstTriedAt?: number
  // When to try the relays without a final answer again (ms); null once the rule is met or every
  // relay refused it for good.
  retryAt: number | null
  // Until when a round is sending it (ms): other rounds pass it over meanwhile.
  sendingUntil: number | null
}

// "waiting": the rule isn't met yet, it is tried again. "delivered": the rule is met (copies on
// further relays may still follow), or every relay answered for good and some took it, which is
// as far as it gets (a profile with relays of one operator). "refused": every relay answered for
// good and none took it.
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
// Entries sent at once per round.
const ROUND_SIZE = 16
// A round's lease on the entries it sends: longer than a send can take (connect and publish
// timeouts, lib/nostr/client.ts), short enough that a closed tab's entries are soon free again.
const LEASE_MS = 30_000
// Another tab holds the lock: look again this much later (it may have been closed meanwhile).
const BUSY_RETRY_MS = 2000
// How long an entry is kept: missing copies are sent again on each start until then.
const HEAL_FOR_MS = 7 * 24 * 60 * 60_000

// ---- Rules ------------------------------------------------------------------------------------

const isFinal = (answer: RelayAnswer | undefined) => !!answer && (answer.ok || PERMANENT.has(answer.code))
const confirmedOf = (entry: Entry) => entry.relays.filter((url) => entry.answers[url]?.ok)
const openRelays = (entry: Entry) => entry.relays.filter((url) => !isFinal(entry.answers[url]))

function ruleMet(entry: Entry) {
  const confirmed = confirmedOf(entry)
  return entry.rule === "any" ? confirmed.length > 0 : isPublished(confirmed)
}

// Its turn: every event it goes out after has a copy somewhere, was refused for good, or is no
// longer here.
const ready = (entry: Entry, entries: Map<string, Entry>) =>
  entry.after.every((id) => {
    const before = entries.get(id)
    return !before || confirmedOf(before).length > 0 || openRelays(before).length === 0
  })

// Oldest first, and an entry after the ones it goes out after.
function inOrder(entries: readonly Entry[]): Entry[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const ordered: Entry[] = []
  const placed = new Set<string>()
  const place = (entry: Entry) => {
    if (placed.has(entry.id)) return
    placed.add(entry.id)
    for (const id of entry.after) {
      const before = byId.get(id)
      if (before) place(before)
    }
    ordered.push(entry)
  }
  for (const entry of [...entries].sort((a, b) => a.queuedAt - b.queuedAt)) place(entry)
  return ordered
}

// The wait before attempt number `attempts + 1`: doubling from 5 s up to 10 min, half of it fixed
// and half random, so many entries (and devices) don't retry in step.
export function backoffMs(attempts: number, random = Math.random()): number {
  const full = Math.min(BACKOFF.maxMs, BACKOFF.firstMs * 2 ** Math.max(0, attempts - 1))
  return Math.round(full / 2 + (full / 2) * random)
}

function stateOf(entry: Entry): DeliveryState {
  if (ruleMet(entry)) return "delivered"
  if (openRelays(entry).length > 0) return "waiting"
  return confirmedOf(entry).length > 0 ? "delivered" : "refused"
}

function statusOf(entry: Entry): DeliveryStatus {
  const confirmed = confirmedOf(entry)
  return {
    id: entry.id,
    kind: entry.event.kind,
    rule: entry.rule,
    state: stateOf(entry),
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

// Gone from the outbox: every relay answered for good and some took it, or a week went by since
// the first attempt. A refusal stays until then.
const finished = (entry: Entry, now: number) =>
  (openRelays(entry).length === 0 && stateOf(entry) === "delivered") || (entry.firstTriedAt !== undefined && now - entry.firstTriedAt > HEAL_FOR_MS)
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

// Queues signed events for their relays. An event already queued gets the new relays added and
// is due again (its order stays as first queued); a coalesced one older than a queued version of
// its coordinate is dropped. Resolves once the queue is stored, before anything is sent.
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
        if (versions.some((e) => supersedes(e.event, event))) continue
        for (const old of versions) {
          entries.delete(old.id)
          ops.set(old.id, { store: "outbox", delete: old.id })
        }
      }
      put({ id: event.id, event, relays, rule: options.rule ?? "published", coalesce, after: [...(delivery.after ?? [])], answers: {}, attempts: 0, queuedAt: now(), retryAt: now(), sendingUntil: null })
    }
    await dbWrite([...ops.values()])
  })
  // In a page the sending starts with the first thing queued; elsewhere (tests) it is explicit.
  if (resumed || typeof document === "undefined") schedule()
  else void resumeOutbox()
}

// ---- Sending ----------------------------------------------------------------------------------

// One round: picks entries under the lock (`choose`, among those not final, not leased and whose
// turn it is) and leases them, sends to their relays without a final answer, then merges the
// answers under the lock again. Null when `wait` is false and another tab or call holds the lock.
async function sendRound(choose: (open: Entry[], at: number) => Entry[], wait: boolean, now: Clock): Promise<Entry[] | null> {
  const picked = await withLock(wait, async () => {
    const at = now()
    const entries = new Map((await readEntries()).map((e) => [e.id, e]))
    const open = [...entries.values()].filter((e) => openRelays(e).length > 0 && (e.sendingUntil ?? 0) <= at && ready(e, entries))
    const chosen = choose(open, at)
    await dbWrite(chosen.map((e) => putEntry({ ...e, sendingUntil: at + LEASE_MS })))
    return chosen
  })
  if (!picked || picked.length === 0) return picked
  const answers = await Promise.all(picked.map(async (entry) => ({ id: entry.id, results: await send(entry.event, openRelays(entry)) })))
  return withLock(true, async () => {
    const at = now()
    const current = new Map((await readEntries()).map((e) => [e.id, e]))
    const merged = answers.flatMap(({ id, results }) => {
      const entry = current.get(id)
      return entry ? [withAnswers(entry, results, at)] : []
    })
    await dbWrite(merged.map((e) => saveEntry(e, at)))
    return merged
  })
}

// The entry as stored now (relays may have been added meanwhile) with a round's answers. Due
// again after a backoff, at once for relays not tried yet, or never once the rule is met or every
// relay refused it for good.
function withAnswers(entry: Entry, results: readonly PublishResult[], at: number): Entry {
  const answers = { ...entry.answers }
  for (const r of results) answers[r.url] = { ok: r.ok, code: r.code, reason: r.reason, at }
  const tried: Entry = { ...entry, answers, attempts: entry.attempts + 1, firstTriedAt: entry.firstTriedAt ?? at, sendingUntil: null }
  const untried = tried.relays.some((url) => !answers[url])
  return { ...tried, retryAt: untried ? at : ruleMet(tried) || openRelays(tried).length === 0 ? null : at + backoffMs(tried.attempts) }
}

// Sends the given entries now, due or not, and returns their state. Entries not in the outbox
// (never queued, or done and gone) are left out.
export async function deliverNow(ids: readonly string[], now: Clock = Date.now): Promise<DeliveryStatus[]> {
  const wanted = new Set(ids)
  const sent = (await sendRound((open) => open.filter((e) => wanted.has(e.id)), true, now)) ?? []
  const rest = (await readEntries()).filter((e) => wanted.has(e.id) && !sent.some((s) => s.id === e.id))
  schedule()
  return [...sent, ...rest].map(statusOf)
}

// Sends what is due, a round at a time, until nothing is due or another tab is sending.
export async function flushDue(now: Clock = Date.now): Promise<void> {
  let busy = false
  for (;;) {
    const sent = await sendRound((open, at) => open.filter((e) => e.retryAt !== null && e.retryAt <= at).slice(0, ROUND_SIZE), false, now)
    busy = sent === null
    if (!sent || sent.length === 0) break
  }
  schedule(busy ? BUSY_RETRY_MS : 0)
}

// Makes entries due now and sends them: every waiting one, or also the delivered ones still
// missing copies (a start of the app). Entries tried for more than a week are given up instead.
async function dueNow(withMissingCopies: boolean, now: Clock) {
  await withLock(true, async () => {
    const at = now()
    const ops = (await readEntries()).flatMap((e): WriteOp[] => {
      if (finished(e, at)) return [{ store: "outbox", delete: e.id }]
      if (e.retryAt !== null) return e.retryAt > at ? [putEntry({ ...e, retryAt: at })] : []
      return withMissingCopies && openRelays(e).length > 0 ? [putEntry({ ...e, retryAt: at })] : []
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

// Everything in the outbox in sending order: waiting events, and delivered ones still missing
// copies.
export async function outboxStatus(): Promise<DeliveryStatus[]> {
  return inOrder(await readEntries()).map(statusOf)
}

// The events among those `select` picks that are still waiting (rule not met, some relay still
// tried), in sending order: what a handoff carries to the device that sends them from now on.
export async function pendingEvents(select: (event: NostrEvent) => boolean): Promise<NostrEvent[]> {
  return inOrder((await readEntries()).filter((e) => select(e.event) && stateOf(e) === "waiting")).map((e) => e.event)
}

// The events among those `select` picks that every relay refused for good (kept for their week).
export async function refusedEvents(select: (event: NostrEvent) => boolean): Promise<NostrEvent[]> {
  return inOrder((await readEntries()).filter((e) => select(e.event) && stateOf(e) === "refused")).map((e) => e.event)
}

// Takes the selected events out, sent or not: another device sends them from now on.
export async function withdraw(select: (event: NostrEvent) => boolean): Promise<void> {
  await withLock(true, async () => {
    const gone = (await readEntries()).filter((e) => select(e.event))
    await dbWrite(gone.map((e): WriteOp => ({ store: "outbox", delete: e.id })))
  })
  schedule()
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
    fewCopies: entries.filter((e) => e.rule === "published" && e.operators < PUBLISHED_MIN_OPERATORS).length,
    kept: entries.length,
  }
}

// ---- Running in the background ----------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined
let resumed = false

// Wakes this tab up when the next entry falls due (no earlier than `atLeastMs`). An entry a round
// is sending counts as due once its lease ends, not at its retryAt: a round can't pick it before,
// so a wake-up at retryAt would only find nothing and schedule the next one at once, in every
// open tab, as long as the send lasts. The merge rewrites the entry and announces that, so the
// tab wakes up earlier when the answers are in. An entry waiting for its turn isn't due by
// itself, for the same reason: the answers to the events before it announce themselves.
function schedule(atLeastMs = 0) {
  if (!resumed) return
  void readEntries().then(
    (entries) => {
      clearTimeout(timer)
      const byId = new Map(entries.map((e) => [e.id, e]))
      const due = Math.min(...entries.flatMap((e) => (e.retryAt === null || !ready(e, byId) ? [] : [Math.max(e.retryAt, e.sendingUntil ?? 0)])))
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
