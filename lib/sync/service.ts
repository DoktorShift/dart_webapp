import { addDiagnostics, type DiagnosticsSection } from "../profile/diagnostics.ts"
import { getSession, loadSession, onSessionEnd, subscribeSession } from "../profile/session.ts"
import { onStorageChange } from "../storage/db.ts"
import { outboxCounts, outboxStatus, resumeOutbox, sendWaitingNow } from "./outbox.ts"
import { getSyncStatus, setSyncStatus, type SyncStatus } from "./status.ts"

// The sync in the background (started by components/sync/register.ts once the app is idle):
//
// - The outbox sends for everyone, guests' live games included (./outbox.ts).
// - With a profile, its private history follows (./engine.ts, loaded only then): on start, when
//   the app is shown again and when the device is back online (a full sync with read-back and
//   healing at most once a day, otherwise what changed since), a little after games or players
//   changed here or in another tab, and on request ("Jetzt abgleichen", "Erneut versuchen").
// - One sync at a time per browser (Web Locks); a tab that finds another one syncing leaves it.
// - No notices in normal screens (decision 0002 §1): the state is in ./status.ts for the screens
//   that ask (Profil, Spiele, Erweitert) and in "Diagnose kopieren".

const LOCK = "blueline-sync"
const FULL_EVERY_MS = 24 * 60 * 60_000
const SHOWN_AGAIN_MS = 2 * 60_000
const AFTER_CHANGE_MS = 15_000

let started = false
let pubkey: string | null = null
let lastRun = 0
// A sync asked for while one runs: done right after it, full if any request was.
let again: false | "incremental" | "full" = false
let changeTimer: ReturnType<typeof setTimeout> | undefined

const loadEngine = () => import("./engine.ts")

// Runs one sync, unless another tab is running one (then its result arrives through storage).
async function withSyncLock<T>(task: () => Promise<T>): Promise<T | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  return locks ? locks.request(LOCK, { ifAvailable: true }, async (lock) => (lock ? task() : null)) : task()
}

async function run(full: boolean) {
  const current = pubkey
  if (!current) return
  if (getSyncStatus().running) {
    again = full || again === "full" ? "full" : "incremental"
    return
  }
  lastRun = Date.now()
  setSyncStatus({ running: true })
  try {
    const { syncHistory } = await loadEngine()
    const result = await withSyncLock(() => syncHistory(current, { full }))
    if (result && pubkey === current) setSyncStatus(result)
  } catch {
    // Something unexpected (the database, a bug): the next sync tries again.
    if (pubkey === current) setSyncStatus({ state: "unavailable", problem: "offline" })
  } finally {
    if (pubkey === current) setSyncStatus({ running: false })
    if (again) {
      const next = again
      again = false
      soon(next === "full")
    }
  }
}

function soon(full = false) {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => void run(full), AFTER_CHANGE_MS)
}

// What this device knows of the profile's last syncs, also those another tab ran.
async function refresh(current: string) {
  const { syncMeta } = await loadEngine()
  const meta = await syncMeta(current)
  if (pubkey === current) setSyncStatus({ pubkey: current, state: meta.state, problem: meta.problem, lastSync: meta.lastSync, lastCheck: meta.lastCheck })
  return meta
}

// Follows the session: a new profile starts syncing, none stops it.
function follow() {
  const next = getSession()?.pubkey ?? null
  if (next === pubkey) return
  pubkey = next
  clearTimeout(changeTimer)
  setSyncStatus(null)
  if (!next) return
  setSyncStatus({ pubkey: next })
  void refresh(next).then((meta) => {
    if (pubkey === next) void run(meta.lastCheck === null || Date.now() - meta.lastCheck > FULL_EVERY_MS)
  })
}

// "Jetzt abgleichen", "Erneut versuchen": a full sync, then everything waiting in the outbox,
// whatever its backoff says.
export async function syncNow() {
  await run(true)
  await sendWaitingNow()
}

export function startSyncService() {
  if (started) return
  started = true
  void resumeOutbox()
  addDiagnostics(diagnostics)
  onSessionEnd(() => {
    pubkey = null
    setSyncStatus(null)
  })
  subscribeSession(follow)
  void loadSession().then(follow)
  onStorageChange((message) => {
    if (!pubkey || message.type !== "change") return
    if (message.stores.includes("matches") || message.stores.includes("players")) {
      // This sync's own changes come back here too; one more quick sync then finds nothing.
      if (getSyncStatus().running) again = again || "incremental"
      else soon()
    } else if (message.stores.includes("kv") && !getSyncStatus().running) void refresh(pubkey)
  })
  if (typeof window !== "undefined") window.addEventListener("online", () => void run(false))
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && pubkey && Date.now() - lastRun > SHOWN_AGAIN_MS) void run(false)
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
      `last sync: ${when(status.lastSync)} (${status.state ?? "none yet"}${status.problem ? `, ${status.problem}` : ""}${status.running ? ", running" : ""})`,
      `last check of copies: ${when(status.lastCheck)}`,
      ...problems.slice(0, 10).map((p) => `relay problem: ${p}`),
    ],
  }
}
