import type { NostrEvent } from "../nostr/types.ts"
import type { SealedSecret } from "../profile/vault.ts"
import { dbDelete, dbGet, dbKeys, dbWrite, kvGet, kvSet, type Keyed } from "../storage/db.ts"
import type { TournamentDraft } from "./draft.ts"

// What a device keeps about tournaments. The local copy comes first (decision 0002 §1): a
// tournament shows at once and offline, relays add what is new. Kept are the signed events
// themselves, never a state derived from them, so every reader replays the same records
// (lib/protocol/tournament-state.ts) and the engine builds the same pairings from them.
//
// - "objects" tournament:<id>: the tournament as this device knows it. Not tied to the profile:
//   a guest looks at a tournament, a board device scores for one, so signing out keeps it.
// - "kv" tournament-draft:<id>: a tournament being created, saved as it is typed.
// - "pending" tournament-board:<tournament id>: this device as a board of a tournament, with the
//   board key sealed by the device's vault key (lib/profile/vault.ts) and the results it signed
//   but no relay has yet (an offline board finishes its match and sends later).

export const TOURNAMENT_OBJECT_PREFIX = "tournament:"
const DRAFT_PREFIX = "tournament-draft:"
const BOARD_PREFIX = "tournament-board:"

export interface StoredTournament extends Keyed {
  tournament: string
  events: NostrEvent[]
  // Relays a link named, read along with the usual ones.
  relays: string[]
  // Events signed here that no relay confirmed yet, oldest first; sent again from "Erneut
  // senden" and whenever the tournament is opened. The coordinator moves this onto the
  // persistent outbox (lib/sync/outbox.ts) at integration.
  unsent: string[]
  // When relays last answered for it (ms); null if they never did.
  loadedAt: number | null
  // The organizer's device: the draw seed behind each commitment it published, until revealed.
  seeds: Record<string, string>
  // The organizer's device: the key of each board it authorized, sealed, so the board's code can
  // be shown again.
  boardKeys: Record<string, SealedSecret>
  // When this device last opened it (ms): the home list shows recently opened ones too.
  openedAt: number | null
}

const objectId = (tournament: string) => `${TOURNAMENT_OBJECT_PREFIX}${tournament}`

const empty = (tournament: string): StoredTournament => ({
  id: objectId(tournament),
  tournament,
  events: [],
  relays: [],
  unsent: [],
  loadedAt: null,
  seeds: {},
  boardKeys: {},
  openedAt: null,
})

export async function loadStoredTournament(tournament: string): Promise<StoredTournament | null> {
  return (await dbGet<StoredTournament>("objects", objectId(tournament))) ?? null
}

export async function storedTournaments(): Promise<StoredTournament[]> {
  const ids = (await dbKeys("objects")).filter((id) => id.startsWith(TOURNAMENT_OBJECT_PREFIX))
  const found = await Promise.all(ids.map((id) => dbGet<StoredTournament>("objects", id)))
  return found.filter((t): t is StoredTournament => t !== undefined)
}

export interface TournamentChange {
  events?: readonly NostrEvent[]
  relays?: readonly string[]
  // Own events just handed to relays: confirmed ones leave `unsent`, the others join it.
  sent?: { confirmed: readonly string[]; missing: readonly string[] }
  // Relays answered (a fetch): events they returned count as sent.
  loadedAt?: number
  seed?: { commit: string; seed: string }
  boardKey?: { board: string; key: SealedSecret }
  openedAt?: number
}

// Changes of one tournament, one after another within this tab, so two quick writes never lose
// each other. Events are only ever added, so another tab writing at the same moment can at
// most drop events the next load brings back from relays.
const queues = new Map<string, Promise<unknown>>()

export function updateTournament(tournament: string, change: TournamentChange): Promise<StoredTournament> {
  const run = (queues.get(tournament) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const stored = (await loadStoredTournament(tournament)) ?? empty(tournament)
    const next = merge(stored, change)
    await dbWrite([{ store: "objects", put: next }])
    return next
  })
  queues.set(tournament, run)
  return run
}

function merge(stored: StoredTournament, change: TournamentChange): StoredTournament {
  const byId = new Map(stored.events.map((e) => [e.id, e]))
  for (const event of change.events ?? []) if (!byId.has(event.id)) byId.set(event.id, event)
  let unsent = stored.unsent
  if (change.loadedAt !== undefined) {
    const seen = new Set((change.events ?? []).map((e) => e.id))
    unsent = unsent.filter((id) => !seen.has(id))
  }
  if (change.sent) {
    const confirmed = new Set(change.sent.confirmed)
    unsent = [...new Set([...unsent.filter((id) => !confirmed.has(id)), ...change.sent.missing])]
  }
  return {
    ...stored,
    events: [...byId.values()],
    relays: change.relays ? [...new Set([...stored.relays, ...change.relays])] : stored.relays,
    unsent,
    loadedAt: change.loadedAt ?? stored.loadedAt,
    seeds: change.seed ? { ...stored.seeds, [change.seed.commit]: change.seed.seed } : stored.seeds,
    boardKeys: change.boardKey ? { ...stored.boardKeys, [change.boardKey.board]: change.boardKey.key } : stored.boardKeys,
    openedAt: change.openedAt ?? stored.openedAt,
  }
}

// Forgets a tournament this device only looked at.
export const forgetTournament = (tournament: string) => dbWrite([{ store: "objects", delete: objectId(tournament) }])

// ---- Drafts ----------------------------------------------------------------------------------

export const loadDraft = async (id: string) => (await kvGet<TournamentDraft>(`${DRAFT_PREFIX}${id}`)) ?? null
export const saveDraft = (draft: TournamentDraft) => kvSet(`${DRAFT_PREFIX}${draft.id}`, draft)
export const deleteDraft = (id: string) => dbDelete("kv", `${DRAFT_PREFIX}${id}`)

// Newest first.
export async function listDrafts(): Promise<TournamentDraft[]> {
  const ids = (await dbKeys("kv")).filter((id) => id.startsWith(DRAFT_PREFIX))
  const drafts = await Promise.all(ids.map((id) => kvGet<TournamentDraft>(id)))
  return drafts.filter((d): d is TournamentDraft => d !== undefined).sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---- This device as a board --------------------------------------------------------------------

export interface BoardGame {
  // The game on this device, and the live match it was founded as (lib/live).
  local: string
  match: string | null
  // The two participants the game was started for, in seat order.
  players: [string, string]
  // The tournament.result event reported for it, and what it stated (so a corrected game
  // reports again, an unchanged one not).
  reported: { event: string; key: string } | null
}

export interface BoardDeviceRecord extends Keyed {
  tournament: string
  board: string
  relays: string[]
  key: SealedSecret
  // Results signed here that no relay took yet, in order.
  outbox: NostrEvent[]
  games: Record<string, BoardGame>
}

const boardId = (tournament: string) => `${BOARD_PREFIX}${tournament}`

export const loadBoardDevice = async (tournament: string) => (await dbGet<BoardDeviceRecord>("pending", boardId(tournament))) ?? null
export const saveBoardDevice = (record: Omit<BoardDeviceRecord, "id">) => dbWrite([{ store: "pending", put: { ...record, id: boardId(record.tournament) } }])
export const dropBoardDevice = (tournament: string) => dbDelete("pending", boardId(tournament))

export async function listBoardDevices(): Promise<BoardDeviceRecord[]> {
  const ids = (await dbKeys("pending")).filter((id) => id.startsWith(BOARD_PREFIX))
  const found = await Promise.all(ids.map((id) => dbGet<BoardDeviceRecord>("pending", id)))
  return found.filter((r): r is BoardDeviceRecord => r !== undefined)
}
