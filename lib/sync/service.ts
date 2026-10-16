import { addDiagnostics, type DiagnosticsSection } from "../profile/diagnostics.ts"
import { getSession, loadSession, onSessionEnd, subscribeSession } from "../profile/session.ts"
import { onStorageChange } from "../storage/db.ts"
import { outboxCounts, outboxStatus, resumeOutbox, sendWaitingNow } from "./outbox.ts"
import { getSyncStatus, setSyncStatus, type SyncStatus } from "./status.ts"

// The sync in the background (started by components/sync/register.ts once the app is up with a
// profile, or as soon as one signs in):
//
// - The outbox sends for everyone, guests' live games included (./outbox.ts).
// - With a profile, its private history follows (./engine.ts, loaded only then): on start, when
//   the app is shown again and when the device is back online (a full sync with read-back and
//   healing at most once a day, otherwise what changed since), a little after games or players
//   changed here or in another tab, and on request ("Jetzt abgleichen", "Erneut versuchen"). A
//   requested sync that some relay didn't answer is followed by one more read a few seconds later:
//   a relay just restarted often answers the second time, and "Teilweise" shouldn't stay.
// - A profile in a signer app or extension would be asked to sign every record: its changes are
//   written at start, on request and when the app goes to the background (one moment for the
//   prompts); the syncs in between only read. A key kept here writes every time.
// - One sync at a time per browser (Web Locks); a tab that finds another one syncing leaves it,
//   except at start and on request, where it waits its turn.
// - A sync belongs to the session it started for: once that ends (sign-out, another profile),
//   its result is dropped and nothing queued for it runs; ./engine.ts keeps nothing of it either.
// - No notices in normal screens (decision 0002 §1): the state is in ./status.ts for the screens
//   that ask (Profil, Spiele, Erweitert) and in "Diagnose kopieren".

const LOCK = "blueline-sync"
const FULL_EVERY_MS = 24 * 60 * 60_000
const SHOWN_AGAIN_MS = 2 * 60_000
const AFTER_CHANGE_MS = 15_000
const AFTER_PARTIAL_MS = 5000
// A sync asked for by a tap shows as running at least this long: the tap gets visible feedback
// even when every relay refuses at once.
const SHOWN_FOR_MS = 700

// Why a sync runs. It decides whether the sync writes and how soon a queued one follows.
type Trigger = "change" | "retry" | "shown" | "online" | "hidden" | "start" | "request"
const STRENGTH: Record<Trigger, number> = { change: 0, retry: 1, shown: 2, online: 3, hidden: 4, start: 5, request: 6 }
// The moments a profile in a signer app or extension writes (see above).
const WRITING = new Set<Trigger>(["start", "hidden", "request"])

let started = false
let pubkey: string | null = null
// Counts the sessions followed; a sync started for an earlier one keeps nothing.
let generation = 0
let lastRun = 0
// Whether games or players changed here since the last sync that wrote.
let changed = false
// A sync asked for while one runs: done right after it, for the stronger of both reasons.
let again: Trigger | null = null
let changeTimer: ReturnType<typeof setTimeout> | undefined

const loadEngine = () => import("./engine.ts")
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const stronger = (a: Trigger | null, b: Trigger): Trigger => (a && STRENGTH[a] > STRENGTH[b] ? a : b)
const writesEveryTime = () => getSession()?.kind === "local"

// Runs one sync, unless another tab is running one (then its result arrives through storage).
async function withSyncLock<T>(wait: boolean, task: () => Promise<T>): Promise<T | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  return locks ? locks.request(LOCK, { ifAvailable: !wait }, async (lock) => (lock ? task() : null)) : task()
}

async function run(trigger: Trigger, fullAgain = false) {
  const current = pubkey
  const mine = generation
  if (!current) return
  if (getSyncStatus().running) {
    again = stronger(again, trigger)
    return
  }
  lastRun = Date.now()
  const write = writesEveryTime() || WRITING.has(trigger)
  if (write) changed = false
  setSyncStatus({ running: true })
  try {
    const { syncHistory } = await loadEngine()
    const sync = () => syncHistory(current, { full: trigger === "request" || fullAgain, write, alive: () => generation === mine })
    const [result] = await Promise.all([withSyncLock(WRITING.has(trigger), sync), trigger === "request" ? pause(SHOWN_FOR_MS) : null])
    if (result && generation === mine) setSyncStatus(result)
    // Full again, so a relay just back (and maybe empty) gets its missing copies.
    if (result?.problem === "relays" && trigger === "request") soon("retry", AFTER_PARTIAL_MS, true)
  } catch {
    // Something unexpected (the database, a bug): the next sync tries again.
    if (generation === mine) setSyncStatus({ state: "unavailable", problem: "offline" })
  } finally {
    if (generation === mine) setSyncStatus({ running: false, endedAt: Date.now() })
    const next = again
    again = null
    if (next && WRITING.has(next)) void run(next)
    else if (next) soon(next)
  }
}

function soon(trigger: Trigger, delayMs = AFTER_CHANGE_MS, fullAgain = false) {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => void run(trigger, fullAgain), delayMs)
}

// What this device knows of the profile's last syncs, also those another tab ran.
async function refresh(current: string) {
  const { syncMeta } = await loadEngine()
  const meta = await syncMeta(current)
  if (pubkey === current) setSyncStatus({ pubkey: current, state: meta.state, problem: meta.problem, lastSync: meta.lastSync, lastCheck: meta.lastCheck, pending: meta.pending })
  return meta
}

function forget() {
  generation++
  pubkey = null
  again = null
  changed = false
  clearTimeout(changeTimer)
  setSyncStatus(null)
}

// Follows the session: a new profile starts syncing, none stops it.
function follow() {
  const session = getSession()
  const next = session?.pubkey ?? null
  if (next === pubkey) return
  forget()
  if (!session) return
  pubkey = next
  const mine = generation
  setSyncStatus({ pubkey: next })
  const seeded = session.madeHere ? loadEngine().then(({ markSyncedAtBirth }) => markSyncedAtBirth(session.pubkey, session.createdAt)) : Promise.resolve()
  void seeded.then(() => refresh(session.pubkey)).then((meta) => {
    if (generation === mine) void run("start", meta.lastCheck === null || Date.now() - meta.lastCheck > FULL_EVERY_MS)
  })
}

// "Jetzt abgleichen", "Erneut versuchen": a full sync, then everything waiting in the outbox,
// whatever its backoff says.
export async function syncNow() {
  await run("request")
  await sendWaitingNow()
}

export function startSyncService() {
  if (started) return
  started = true
  void resumeOutbox()
  addDiagnostics(diagnostics)
  onSessionEnd(forget)
  subscribeSession(follow)
  void loadSession().then(follow)
  onStorageChange((message) => {
    if (!pubkey || message.type !== "change") return
    if (message.stores.includes("matches") || message.stores.includes("players")) {
      changed = true
      // This sync's own changes come back here too; one more quick sync then finds nothing.
      if (getSyncStatus().running) again = stronger(again, "change")
      else soon("change")
    } else if (message.stores.includes("kv") && !getSyncStatus().running) void refresh(pubkey)
  })
  if (typeof window !== "undefined") window.addEventListener("online", () => void run("online"))
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", () => {
      if (!pubkey) return
      if (document.visibilityState === "visible" && Date.now() - lastRun > SHOWN_AGAIN_MS) void run("shown")
      // The one moment a signer app or extension is asked for the changes made since.
      if (document.visibilityState === "hidden" && changed && !writesEveryTime()) void run("hidden")
    })
}

const when = (ms: number | null) => (ms === null ? "never" : new Date(ms).toISOString())

// The sync's part of "Diagnose kopieren" (lib/profile/diagnostics.ts): no secrets, no game data.
async function diagnostics(): Promise<DiagnosticsSection> {
  const status: SyncStatus = getSyncStatus()
  const [counts, entries] = await Promise.all([outboxCounts(), outboxStatus()])
  const problems = [...new Set(entries.flatMap((e) => e.results.filter((r) => !r.ok).map((r) => `${r.url} ${r.code || "no reason"}`)))]
  return {
    title: "Sync",
    lines: [
      `outbox: ${counts.waiting} waiting, ${counts.kept} kept`,
      `fewer than 2 confirmed copies: ${counts.fewCopies}`,
      `changes not written yet: ${status.pending}`,
      `last sync: ${when(status.lastSync)} (${status.state ?? "none yet"}${status.problem ? `, ${status.problem}` : ""}${status.running ? ", running" : ""})`,
      `last check of copies: ${when(status.lastCheck)}`,
      ...problems.slice(0, 10).map((p) => `relay problem: ${p}`),
    ],
  }
}
