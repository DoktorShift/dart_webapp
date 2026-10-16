import type { NostrEvent } from "../nostr/types.ts"
import type { SealedSecret } from "../profile/vault.ts"
import { dbDelete, dbGet, dbKeys, kvGet, kvSet, type Keyed } from "../storage/db.ts"
import { updateStored } from "../storage/lock.ts"
import { addToCopy } from "../storage/record-copy.ts"
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
//   board key sealed by the device's vault key (lib/profile/vault.ts) and the games it started.
//
// What this device signed waits in the persistent outbox (lib/sync/outbox.ts) until relays have
// it; nothing here keeps a second list of it (send.ts).

export const TOURNAMENT_OBJECT_PREFIX = "tournament:"
const DRAFT_PREFIX = "tournament-draft:"
const BOARD_PREFIX = "tournament-board:"

export interface StoredTournament extends Keyed {
  tournament: string
  events: NostrEvent[]
  // Relays a link named, read along with the usual ones.
  relays: string[]
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
  // Every relay that answered a fetch was read to the end.
  loadedAt?: number
  seed?: { commit: string; seed: string }
  boardKey?: { board: string; key: SealedSecret }
  openedAt?: number
}

// Changes of one tournament, one after another in every tab: the copy also holds what no relay
// can bring back (the draw seeds, the board keys).
export const updateTournament = (tournament: string, change: TournamentChange) =>
  updateStored<StoredTournament>("objects", objectId(tournament), (stored) => merge(stored ?? empty(tournament), change))

function merge(stored: StoredTournament, change: TournamentChange): StoredTournament {
  return {
    ...addToCopy(stored, change),
    loadedAt: change.loadedAt ?? stored.loadedAt,
    seeds: change.seed ? { ...stored.seeds, [change.seed.commit]: change.seed.seed } : stored.seeds,
    boardKeys: change.boardKey ? { ...stored.boardKeys, [change.boardKey.board]: change.boardKey.key } : stored.boardKeys,
    openedAt: change.openedAt ?? stored.openedAt,
  }
}

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
  // The game started for each slot called to this board.
  games: Record<string, BoardGame>
}

const boardId = (tournament: string) => `${BOARD_PREFIX}${tournament}`

export const loadBoardDevice = async (tournament: string) => (await dbGet<BoardDeviceRecord>("pending", boardId(tournament))) ?? null

// The board record written on top of what is stored now (the board screen starts games, the
// game screen reports them, a new code replaces the board), one change after another in every
// tab. `change` gets the record as stored (or null) and returns the new one, or null to write
// nothing.
export const changeBoardDevice = (tournament: string, change: (record: BoardDeviceRecord | null) => Omit<BoardDeviceRecord, "id"> | null) =>
  updateStored<BoardDeviceRecord>("pending", boardId(tournament), (stored) => {
    const next = change(stored ?? null)
    return next && { ...next, id: boardId(tournament) }
  })

// A game of the board, written on top of the record as it is now; nothing without a record.
export const rememberGame = (tournament: string, slot: string, game: (before: BoardGame | undefined) => BoardGame) =>
  changeBoardDevice(tournament, (record) => record && { ...record, games: { ...record.games, [slot]: game(record.games[slot]) } })

export async function listBoardDevices(): Promise<BoardDeviceRecord[]> {
  const ids = (await dbKeys("pending")).filter((id) => id.startsWith(BOARD_PREFIX))
  const found = await Promise.all(ids.map((id) => dbGet<BoardDeviceRecord>("pending", id)))
  return found.filter((r): r is BoardDeviceRecord => r !== undefined)
}
