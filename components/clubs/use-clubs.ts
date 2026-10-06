"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import type { ClubView } from "@/lib/clubs/club"
import type { Author } from "@/lib/clubs/send"
import { storedClubs } from "@/lib/clubs/store"
import { discoverClubs, refreshClub, viewClub, type Reader } from "@/lib/clubs/sync"
import { getSession, getSigner, loadSession, subscribeSession } from "@/lib/profile/session"
import { onStorageChange } from "@/lib/storage/db"

// The clubs this device knows, as the signed-in profile (or a guest) reads them: one store for
// every club screen. The local copies show at once; relays bring what is new when the Clubs tab
// first opens for a profile and whenever a screen asks (refresh). Writes of this tab and of other
// tabs arrive through the storage channel, so every open screen stays in step.

export interface ClubsSnapshot {
  // By name.
  views: readonly ClubView[]
  // The local copies were read once.
  loaded: boolean
  refreshing: boolean
  // What the last refresh found: whether any relay answered; null before the first.
  online: boolean | null
}

const views = new Map<string, ClubView>()
let snapshot: ClubsSnapshot = { views: [], loaded: false, refreshing: false, online: null }
const listeners = new Set<() => void>()
let watching = false
// Which session the clubs were last refreshed for (pubkey, "" for a guest); undefined: never.
let refreshedFor: string | undefined
let reading = 0

const byName = (a: ClubView, b: ClubView) => (a.info?.name ?? "￿").localeCompare(b.info?.name ?? "￿")

function emit(change: Partial<Omit<ClubsSnapshot, "views">> = {}) {
  snapshot = { ...snapshot, ...change, views: [...views.values()].sort(byName) }
  for (const listener of listeners) listener()
}

async function reader(): Promise<Reader> {
  const session = await loadSession()
  if (!session) return { pubkey: null, signer: null }
  return { pubkey: session.pubkey, signer: await getSigner().catch(() => null) }
}

// Reads every club's local copy again (a write happened, or the session changed).
async function readLocal() {
  const run = ++reading
  const r = await reader()
  const stored = await storedClubs().catch(() => [])
  const read = await Promise.all(stored.map((s) => viewClub(s, r).catch(() => null)))
  if (run !== reading) return
  views.clear()
  for (const view of read) if (view) views.set(view.id, view)
  emit({ loaded: true })
}

async function refreshAll() {
  if (snapshot.refreshing) return
  emit({ refreshing: true })
  const r = await reader()
  let online = false
  if (r.pubkey) online = await discoverClubs(r.pubkey).catch(() => false)
  const stored = await storedClubs().catch(() => [])
  // One club at a time: each is a few relay queries and, in a closed club, signer calls.
  for (const s of stored) {
    const view = await refreshClub(s.club, r).catch(() => null)
    if (!view) continue
    if (view.loadedAt !== null) online = true
    views.set(view.id, view)
    emit()
  }
  emit({ refreshing: false, online })
}

function watch() {
  if (watching) return
  watching = true
  onStorageChange((message) => {
    if (message.type === "wipe") {
      views.clear()
      emit()
    } else if (message.stores.includes("objects")) void readLocal()
  })
  let last = getSession()?.pubkey ?? null
  subscribeSession(() => {
    const next = getSession()?.pubkey ?? null
    if (next === last) return
    last = next
    refreshedFor = undefined
    void start()
  })
}

async function start() {
  watch()
  await readLocal()
  const key = (await loadSession())?.pubkey ?? ""
  if (refreshedFor === key) return
  refreshedFor = key
  await refreshAll()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const EMPTY: ClubsSnapshot = { views: [], loaded: false, refreshing: false, online: null }

export function useClubs(): ClubsSnapshot & { refresh: () => Promise<void> } {
  useEffect(() => {
    void start()
  }, [])
  const current = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)
  return { ...current, refresh: refreshAll }
}

// One club, from the store; a club not kept here yet (opened from a link or the public list) is
// fetched once. undefined while nothing is known yet.
export function useClub(club: string | null): { view: ClubView | undefined; loaded: boolean; missing: boolean; refresh: () => Promise<ClubView | null> } {
  const { views: all, loaded } = useClubs()
  const view = club ? all.find((v) => v.id === club) : undefined
  // Relays were asked for a club not kept here, and had nothing.
  const [missing, setMissing] = useState(false)
  const refresh = async () => {
    if (!club) return null
    const next = await refreshClub(club, await reader()).catch(() => null)
    if (next) {
      views.set(next.id, next)
      emit()
    }
    return next
  }
  useEffect(() => {
    if (club && loaded && !view) void refresh().then((next) => setMissing(!next))
    // Once, when the club turns out not to be here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club, loaded, view === undefined])
  return { view, loaded, missing: missing && !view, refresh }
}

// The signed-in profile as the author of club records. Throws without a profile.
export async function clubAuthor(): Promise<Author> {
  const session = await loadSession()
  if (!session) throw new Error("no profile is signed in on this device")
  return { pubkey: session.pubkey, signer: await getSigner() }
}
