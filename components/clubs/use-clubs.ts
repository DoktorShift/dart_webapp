"use client"

import { useEffect, useState } from "react"
import type { ClubView } from "@/lib/clubs/club"
import { confirmedCopies } from "@/lib/clubs/games"
import type { Author } from "@/lib/clubs/send"
import { storedClubs } from "@/lib/clubs/store"
import { watchInvitations } from "@/lib/clubs/invitations"
import { discoverClubs, refreshClub, viewClub, type Reader } from "@/lib/clubs/sync"
import { profileStore } from "@/components/profile/follow-profile"
import { keepCopies } from "@/lib/live/copy"
import { getSigner, loadSession } from "@/lib/profile/session"
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
  // All clubs are being refreshed (the tab's first open for a profile).
  refreshing: boolean
  // What the last refresh found: whether any relay answered; null before the first.
  online: boolean | null
}

const views = new Map<string, ClubView>()
let watching = false
let reading = 0

const byName = (a: ClubView, b: ClubView) => (a.info?.name ?? "￿").localeCompare(b.info?.name ?? "￿")

function emit(change: Partial<Omit<ClubsSnapshot, "views">> = {}) {
  store.set({ ...store.get(), ...change, views: [...views.values()].sort(byName) })
}

// The profile the clubs are read as (null: a guest), for a write that needs no signer.
export const readerKey = async () => (await loadSession())?.pubkey ?? null

// The signed-in profile (or the guest) as the clubs' reader. Only a key kept on this device
// signs without asking, so only then may a club's upkeep run by itself (lib/clubs/sync.ts).
export async function clubReader(): Promise<Reader> {
  const session = await loadSession()
  if (!session) return { pubkey: null, signer: null, automatic: false }
  return { pubkey: session.pubkey, signer: await getSigner().catch(() => null), automatic: session.kind === "local" }
}

// Reads every club's local copy again (a write happened, or the session changed), and keeps the
// profile's own copies of the club games it confirmed (lib/live/copy.ts) in step with them.
async function readLocal() {
  const run = ++reading
  const r = await clubReader()
  const stored = await storedClubs().catch(() => [])
  const read = await Promise.all(stored.map((s) => viewClub(s, r).catch(() => null)))
  if (run !== reading) return
  views.clear()
  for (const view of read) if (view) views.set(view.id, view)
  emit({ loaded: true })
  if (r.pubkey) for (const view of read) if (view) void keepCopies(r.pubkey, confirmedCopies(view.games, r.pubkey)).catch(() => {})
}

// Refreshes one club and tells whether a relay answered: the club's copy says when relays last
// did, so the time before the refresh is what to compare with (the storage channel may have
// replaced the view meanwhile).
async function refreshOne(club: string, r: Reader): Promise<{ view: ClubView; reached: boolean } | null> {
  const before = views.get(club)?.loadedAt ?? null
  const view = await refreshClub(club, r).catch(() => null)
  if (!view) return null
  views.set(view.id, view)
  return { view, reached: view.loadedAt !== null && view.loadedAt !== before }
}

async function refreshAll() {
  if (store.get().refreshing) return
  emit({ refreshing: true })
  const r = await clubReader()
  let online = false
  if (r.pubkey) online = await discoverClubs(r.pubkey).catch(() => false)
  const stored = await storedClubs().catch(() => [])
  // One club at a time: each is a few relay queries and, in a closed club, signer calls.
  for (const s of stored) {
    const result = await refreshOne(s.club, r)
    if (!result) continue
    if (result.reached) online = true
    emit()
  }
  emit({ refreshing: false, online })
}

// Invitations sent straight to this profile (lib/clubs/invitations.ts) arrive while the app is
// open; each opened one is refreshed like a scanned link. Only a key on this device decrypts
// without asking, so only then.
let inbox: { pubkey: string; close: () => void } | null = null
let inboxStarting: Promise<void> | null = null
function followInbox(): Promise<void> {
  // Two screens starting together share one attempt; the next load after it may look again.
  inboxStarting ??= (async () => {
    const r = await clubReader()
    if (inbox && inbox.pubkey !== r.pubkey) {
      inbox.close()
      inbox = null
    }
    if (inbox || !r.pubkey || !r.signer?.nip44 || !r.automatic) return
    const pubkey = r.pubkey
    const sub = watchInvitations({ pubkey, signer: r.signer }, (club) => void refreshOne(club, r).then(() => emit()))
    inbox = { pubkey, close: () => sub.close() }
  })().finally(() => {
    inboxStarting = null
  })
  return inboxStarting
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
}

const store = profileStore<ClubsSnapshot>(
  { views: [], loaded: false, refreshing: false, online: null },
  async () => {
    watch()
    await readLocal()
    void followInbox().catch(() => {})
  },
  refreshAll,
)

export function useClubs(): ClubsSnapshot & { refresh: () => Promise<void> } {
  return { ...store.useSnapshot(), refresh: refreshAll }
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
    const result = await refreshOne(club, await clubReader())
    if (result) emit({ online: result.reached })
    return result?.view ?? null
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
