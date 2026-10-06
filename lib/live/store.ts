import type { SeatHolder } from "../protocol/match-state.ts"
import type { SignedEvent } from "../protocol/tags.ts"
import { openSecret, sealSecret, type SealedSecret } from "../profile/vault.ts"
import { dbDelete, dbGet, dbGetAll, dbPut, type Keyed } from "../storage/db.ts"

// What a device keeps about live matches, in the "pending" store: running work that belongs to
// a match, not to a profile, so signing out leaves it alone. The keys are sealed with the
// device's vault key (lib/profile/vault.ts); once that is gone (signed out), they don't open
// and the match is simply no longer live here.

// The board side, by the id of the game on this device.
export interface BoardRecord extends Keyed {
  local: string
  // The match id: the id of the founding.
  match: string
  relays: string[]
  // authority, session and match key, sealed (BoardSecrets).
  keys: SealedSecret
  founding: SignedEvent
  // The match.session the board writes under now (the founding, or the latest handover), its
  // version and the end of its window.
  session: SignedEvent
  sv: number
  until: number
  // Counter and date of the last snapshot signed.
  n: number
  snapshotAt: number
  // Phones connected to the seats (match.seat).
  seats: (SeatHolder | null)[]
  // The newest result this session published: its event and what it states (content.ts
  // resultKey; "void" for a withdrawn one).
  result: { event: string; key: string } | null
  // Records signed but not yet on enough relays, in order.
  outbox: SignedEvent[]
}

export interface BoardSecrets {
  authority: string
  session: string
  match: string
}

// The phone side, by match id: the seat a player's phone was given.
export interface JoinedRecord extends Keyed {
  match: string
  relays: string[]
  seat: number
  // The profile the phone joined with; null: as a guest, with the key in `keys`.
  profile: string | null
  // The match key, and a guest's own key (JoinedSecrets), sealed.
  keys: SealedSecret
  // The result this device put into its own games (lib/storage/archive.ts).
  archived: string | null
}

export interface JoinedSecrets {
  match?: string
  guest?: string
}

const boardId = (local: string) => `live:board:${local}`
const joinedId = (match: string) => `live:joined:${match}`
const BOARD_PREFIX = "live:board:"

export const sealKeys = async (secrets: BoardSecrets | JoinedSecrets) => sealSecret(new TextEncoder().encode(JSON.stringify(secrets)), "match-keys")

export async function openKeys<T extends BoardSecrets | JoinedSecrets>(sealed: SealedSecret): Promise<T | null> {
  try {
    return JSON.parse(new TextDecoder().decode(await openSecret(sealed, "match-keys"))) as T
  } catch {
    return null
  }
}

export const loadBoard = async (local: string) => (await dbGet<BoardRecord>("pending", boardId(local))) ?? null
export const saveBoard = (record: Omit<BoardRecord, "id">) => dbPut("pending", { ...record, id: boardId(record.local) })
export const dropBoard = (local: string) => dbDelete("pending", boardId(local))
export const listBoards = async () => (await dbGetAll<BoardRecord>("pending")).filter((r) => r.id.startsWith(BOARD_PREFIX))

export const loadJoined = async (match: string) => (await dbGet<JoinedRecord>("pending", joinedId(match))) ?? null
export const saveJoined = (record: Omit<JoinedRecord, "id">) => dbPut("pending", { ...record, id: joinedId(record.match) })
export const dropJoined = (match: string) => dbDelete("pending", joinedId(match))
