"use client"

import { useEffect, useState } from "react"
import type { EventTemplate } from "@/lib/nostr/types"
import { profileStore } from "@/components/profile/follow-profile"
import { getSession, getSigner, loadSession } from "@/lib/profile/session"
import type { Reason } from "@/lib/protocol/reasons"
import { onStorageChange } from "@/lib/storage/db"
import type { TournamentDraft } from "@/lib/tournaments/draft"
import { nextAdmission, readTournament, type LiveInput, type TournamentRead } from "@/lib/tournaments/read"
import { admitNext } from "@/lib/tournaments/admission"
import { send, waitingRecords, type Author } from "@/lib/tournaments/send"
import { listBoardDevices, listDrafts, loadStoredTournament, storedTournaments, updateTournament, type BoardDeviceRecord, type StoredTournament } from "@/lib/tournaments/store"
import { discoverTournaments, keepPlayed, refreshTournament, watchTournament } from "@/lib/tournaments/sync"

// The tournaments this device knows, as the signed-in profile (or a guest) reads them: one
// store for every tournament screen. The local copies show at once; relays bring what is new
// when the tab first opens for a profile and whenever a screen asks (refresh). Writes of this
// tab and of other tabs arrive through the storage channel, so every open screen stays in
// step; so does what still waits in the outbox. Live matches a tournament's boards are playing
// (lib/live) are reported here by the screen that follows them (setLive) and go into the reading.

export interface Entry {
  stored: StoredTournament
  read: TournamentRead
  // Records of it this device signed that relays don't have safely yet (lib/sync/outbox.ts).
  waiting: number
}

export interface TournamentsSnapshot {
  entries: readonly Entry[]
  drafts: readonly TournamentDraft[]
  // Tournaments this device is a board of.
  boards: readonly BoardDeviceRecord[]
  // The local copies were read once.
  loaded: boolean
  refreshing: boolean
}

const entries = new Map<string, Entry>()
const live = new Map<string, LiveInput[]>()
let waiting = new Map<string, number>()
let drafts: TournamentDraft[] = []
let boards: BoardDeviceRecord[] = []
let watching = false
let reading = 0

function emit(change: Partial<Omit<TournamentsSnapshot, "entries" | "drafts" | "boards">> = {}) {
  store.set({ ...store.get(), ...change, entries: [...entries.values()], drafts, boards })
}

const read = (stored: StoredTournament, pubkey: string | null): Entry => ({
  stored,
  read: readTournament(stored, { pubkey, live: live.get(stored.tournament) ?? [] }),
  waiting: waiting.get(stored.tournament) ?? 0,
})

// The profile's own copies of the board matches it played follow the tournament as read now.
function keepOwn({ stored, read: r }: Entry, pubkey: string | null) {
  if (pubkey) void keepPlayed(r, stored.events, pubkey).catch(() => {})
}

// Reads every local copy again (a write happened, or the session changed).
async function readLocal() {
  const run = ++reading
  const pubkey = (await loadSession())?.pubkey ?? null
  const [stored, found, devices, counts] = await Promise.all([
    storedTournaments().catch(() => []),
    listDrafts().catch(() => []),
    listBoardDevices().catch(() => []),
    waitingRecords().catch(() => new Map<string, number>()),
  ])
  if (run !== reading) return
  waiting = counts
  entries.clear()
  for (const s of stored) entries.set(s.tournament, read(s, pubkey))
  drafts = found
  boards = devices
  for (const entry of entries.values()) keepOwn(entry, pubkey)
  emit({ loaded: true })
}

// The outbox changed (something was queued or reached relays): only the counts change.
async function readWaiting() {
  const counts = await waitingRecords().catch(() => null)
  if (!counts) return
  waiting = counts
  for (const [id, entry] of entries) if (entry.waiting !== (counts.get(id) ?? 0)) entries.set(id, { ...entry, waiting: counts.get(id) ?? 0 })
  emit()
}

async function refreshAll() {
  if (store.get().refreshing) return
  emit({ refreshing: true })
  const pubkey = (await loadSession())?.pubkey ?? null
  if (pubkey) await discoverTournaments(pubkey).catch(() => false)
  // One tournament at a time: each is a few relay queries.
  for (const s of await storedTournaments().catch(() => [])) await refreshTournament(s.tournament).catch(() => null)
  emit({ refreshing: false })
}

function watch() {
  if (watching) return
  watching = true
  onStorageChange((message) => {
    if (message.type === "wipe") {
      entries.clear()
      drafts = []
      boards = []
      emit()
    } else if (message.stores.some((store) => store === "objects" || store === "kv" || store === "pending")) void readLocal()
    else if (message.stores.includes("outbox")) void readWaiting()
  })
}

const store = profileStore<TournamentsSnapshot>(
  { entries: [], drafts: [], boards: [], loaded: false, refreshing: false },
  async () => {
    watch()
    await readLocal()
  },
  refreshAll,
)

export function useTournaments(): TournamentsSnapshot & { refresh: () => Promise<void> } {
  return { ...store.useSnapshot(), refresh: refreshAll }
}

// Re-reads one tournament's local copy (after a write by this tab, or new live matches).
async function reread(tournament: string): Promise<Entry | null> {
  const stored = await loadStoredTournament(tournament).catch(() => null)
  if (!stored) return null
  const pubkey = (await loadSession())?.pubkey ?? null
  const entry = read(stored, pubkey)
  entries.set(tournament, entry)
  keepOwn(entry, pubkey)
  emit()
  return entry
}

// The matches the tournament's boards are playing now, as the screen following them reports.
export function setLive(tournament: string, inputs: LiveInput[]) {
  const before = live.get(tournament) ?? []
  if (before.length === inputs.length && before.every((b, i) => b.match === inputs[i].match && b.slot === inputs[i].slot)) return
  live.set(tournament, inputs)
  void reread(tournament)
}

export interface TournamentHandle {
  entry: Entry | undefined
  loaded: boolean
  // Relays were asked for a tournament not kept here, and had nothing.
  missing: boolean
  refresh: () => Promise<void>
}

// One tournament, from the store; one not kept here yet (opened from a link) is fetched once.
// While the screen is open, new records come in as they are sent, and whatever came while the
// device was offline or the app hidden is fetched when it is back.
export function useTournament(tournament: string | null, hints: readonly string[] = []): TournamentHandle {
  const { entries: all, loaded } = useTournaments()
  const entry = tournament ? all.find((e) => e.stored.tournament === tournament) : undefined
  const [missing, setMissing] = useState(false)
  const hintKey = hints.join(",")
  const refresh = async () => {
    if (!tournament) return
    const stored = await refreshTournament(tournament, hintKey ? hintKey.split(",") : []).catch(() => null)
    await reread(tournament)
    setMissing(stored !== null && stored.events.length === 0 && stored.loadedAt !== null)
  }
  useEffect(() => {
    if (!tournament || !loaded) return
    void updateTournament(tournament, { openedAt: Date.now(), ...(hintKey ? { relays: hintKey.split(",") } : {}) }).then(() => refresh())
    const sub = watchTournament(tournament, hintKey ? hintKey.split(",") : [], (event) => void updateTournament(tournament, { events: [event] }))
    const again = () => document.visibilityState === "visible" && void refresh()
    window.addEventListener("online", again)
    document.addEventListener("visibilitychange", again)
    return () => {
      sub.close()
      window.removeEventListener("online", again)
      document.removeEventListener("visibilitychange", again)
    }
    // Once per tournament the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, loaded])
  return { entry, loaded, missing: missing && !entry?.read.state, refresh }
}

// Automatic admission (lib/tournaments/admission.ts) while a screen of the tournament is open on
// the organizer's device. Only with a key kept by the app: a signer app would be asked out of
// the blue.
export function useAutoAdmission(entry: Entry | undefined) {
  const state = entry?.read.state
  const next = state && entry.read.me.organizer ? nextAdmission(state) : null
  const decision = next && state ? `${state.id}:${next.participant.id}:${next.participant.head}:${next.to}` : null
  useEffect(() => {
    if (!state || !decision || getSession()?.kind !== "local") return
    void tournamentAuthor()
      .then((author) => admitNext(state.id, author))
      .catch(() => {})
    // A decision is tried once; the next one follows the state it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision])
}

// The signed-in profile as the author of tournament records. Throws without a profile.
export async function tournamentAuthor(): Promise<Author> {
  const session = await loadSession()
  if (!session) throw new Error("no profile is signed in on this device")
  return { pubkey: session.pubkey, signer: await getSigner() }
}

export interface Acted {
  // The fresh reading, to build the next record on (a draw after its seed commitment).
  entry: Entry
  // Why the tournament did not take one of the records just sent: another device changed the
  // same thing meanwhile, say. A record that waits for one it builds on is not refused.
  refused: Reason | null
}

// Signs and sends records of a tournament as the profile, then re-reads it.
export async function act(tournament: string, templates: readonly EventTemplate[]): Promise<Acted> {
  const author = await tournamentAuthor()
  const sent = new Set((await send(tournament, templates, author)).map((e) => e.id))
  const entry = await reread(tournament)
  if (!entry) throw new Error("the tournament is gone")
  const refused = entry.read.state?.log.rejected.find((r) => sent.has(r.id))?.reason ?? null
  return { entry, refused }
}
