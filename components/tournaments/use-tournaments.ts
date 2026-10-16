"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import type { EventTemplate } from "@/lib/nostr/types"
import { nowSeconds } from "@/lib/nostr/time"
import { getSession, getSigner, loadSession, subscribeSession } from "@/lib/profile/session"
import { onStorageChange } from "@/lib/storage/db"
import type { TournamentDraft } from "@/lib/tournaments/draft"
import { freePlaces, readTournament, requests, type LiveInput, type TournamentRead } from "@/lib/tournaments/read"
import { admitTemplate } from "@/lib/tournaments/records"
import { send, type Author } from "@/lib/tournaments/send"
import { listBoardDevices, listDrafts, loadStoredTournament, storedTournaments, updateTournament, type BoardDeviceRecord, type StoredTournament } from "@/lib/tournaments/store"
import { discoverTournaments, refreshTournament, watchTournament } from "@/lib/tournaments/sync"

// The tournaments this device knows, as the signed-in profile (or a guest) reads them: one
// store for every tournament screen. The local copies show at once; relays bring what is new
// when the tab first opens for a profile and whenever a screen asks (refresh). Writes of this
// tab and of other tabs arrive through the storage channel, so every open screen stays in
// step. Live matches a tournament's boards are playing (lib/live) are reported here by the
// screen that follows them (setLive) and go into the reading.

export interface Entry {
  stored: StoredTournament
  read: TournamentRead
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
let drafts: TournamentDraft[] = []
let boards: BoardDeviceRecord[] = []
let snapshot: TournamentsSnapshot = { entries: [], drafts: [], boards: [], loaded: false, refreshing: false }
const listeners = new Set<() => void>()
let watching = false
// Which session the tournaments were last refreshed for (pubkey, "" for a guest); undefined: never.
let refreshedFor: string | undefined
let reading = 0

function emit(change: Partial<Omit<TournamentsSnapshot, "entries" | "drafts" | "boards">> = {}) {
  snapshot = { ...snapshot, ...change, entries: [...entries.values()], drafts, boards }
  for (const listener of listeners) listener()
}

const read = (stored: StoredTournament, pubkey: string | null): Entry => ({ stored, read: readTournament(stored, { pubkey, now: nowSeconds(), live: live.get(stored.tournament) ?? [] }) })

// Reads every local copy again (a write happened, or the session changed).
async function readLocal() {
  const run = ++reading
  const pubkey = (await loadSession())?.pubkey ?? null
  const [stored, found, devices] = await Promise.all([storedTournaments().catch(() => []), listDrafts().catch(() => []), listBoardDevices().catch(() => [])])
  if (run !== reading) return
  entries.clear()
  for (const s of stored) entries.set(s.tournament, read(s, pubkey))
  drafts = found
  boards = devices
  emit({ loaded: true })
}

async function refreshAll() {
  if (snapshot.refreshing) return
  emit({ refreshing: true })
  const pubkey = (await loadSession())?.pubkey ?? null
  if (pubkey) await discoverTournaments(pubkey).catch(() => false)
  // One tournament at a time: each is a relay query and, with unsent events, sends.
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

const EMPTY: TournamentsSnapshot = { entries: [], drafts: [], boards: [], loaded: false, refreshing: false }

export function useTournaments(): TournamentsSnapshot & { refresh: () => Promise<void> } {
  useEffect(() => {
    void start()
  }, [])
  const current = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)
  return { ...current, refresh: refreshAll }
}

// Re-reads one tournament's local copy (after a write by this tab, or new live matches).
async function reread(tournament: string) {
  const stored = await loadStoredTournament(tournament).catch(() => null)
  if (!stored) return
  entries.set(tournament, read(stored, (await loadSession())?.pubkey ?? null))
  emit()
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
    // New records while the screen is open (a registration, a result, a call) go into the
    // local copy, which every open screen reads again.
    const sub = watchTournament(tournament, hintKey ? hintKey.split(",") : [], (event) => void updateTournament(tournament, { events: [event] }))
    return () => sub.close()
    // Once per tournament the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, loaded])
  return { entry, loaded, missing: missing && !entry?.read.state, refresh }
}

// "Anmeldungen automatisch aufnehmen": the protocol admits only through the organizer's own
// record (docs/protocol/families/tournament.md), so the organizer's device signs one for each
// request as it sees it, while there is room and the field is not drawn. Only with a key kept
// by the app: a signer app would be asked out of the blue. One request at a time, never twice.
const admitting = new Set<string>()
export function useAutoAdmission(entry: Entry | undefined) {
  const state = entry?.read.state
  const organizer = entry?.read.me.organizer ?? false
  const waiting = state && organizer && state.settings.admission === "auto" && (state.phase === "registration" || state.phase === "checkin") ? requests(state).slice(0, Math.max(0, freePlaces(state))) : []
  const key = waiting.map((p) => p.id).join(",")
  useEffect(() => {
    if (!state || !key || getSession()?.kind !== "local") return
    const next = waiting.find((p) => !admitting.has(`${state.id}:${p.id}:${p.head}`))
    if (!next) return
    const mark = `${state.id}:${next.id}:${next.head}`
    admitting.add(mark)
    void act(state.id, [admitTemplate(state, next.id)]).catch(() => admitting.delete(mark))
    // The request list and the state it was read from decide; nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state?.id, state?.heads.core])
}

// The signed-in profile as the author of tournament records. Throws without a profile.
export async function tournamentAuthor(): Promise<Author> {
  const session = await loadSession()
  if (!session) throw new Error("no profile is signed in on this device")
  return { pubkey: session.pubkey, signer: await getSigner() }
}

// Signs and sends records of a tournament as the profile, then re-reads it. The caller gets
// the fresh reading, to build the next record on (a draw after its seed commitment).
export async function act(tournament: string, templates: readonly EventTemplate[]): Promise<Entry> {
  const author = await tournamentAuthor()
  await send(tournament, templates, author)
  const stored = await loadStoredTournament(tournament)
  if (!stored) throw new Error("the tournament is gone")
  const entry = read(stored, author.pubkey)
  entries.set(tournament, entry)
  emit()
  return entry
}
