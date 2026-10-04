import type { MatchPlayer } from "../game/types.ts"
import { dbGet, dbGetAll, dbPut } from "./db.ts"
import { randomHex } from "./ids.ts"

// The players known on this device, each with an id that stays when nothing else does. Names
// are what people see; the id is who they are. Two people with the same name are never merged
// automatically, and a seat left without a name ("Spieler 1") is nobody in particular, so it
// never joins anyone.

export interface PlayerRecord {
  id: string
  // As last typed in setup (latest spelling).
  name: string
  // For lookups: trimmed, single spaces, lower case.
  nameKey: string
  // The public profile this local player belongs to, once linked (hex).
  pubkey?: string
  // Name groups from version 1.0.0 history the players chose to count for this player.
  importedNames?: string[]
  createdAt: string
  updatedAt: string
  lastPlayedAt?: string
}

const PLAYER_ID = /^pl_[0-9a-f]{32}$/
const PUBKEY = /^[0-9a-f]{64}$/

export const isPlayerId = (id: unknown): id is string => typeof id === "string" && PLAYER_ID.test(id)
export const isPubkey = (value: unknown): value is string => typeof value === "string" && PUBKEY.test(value)

// "pl_" and 128 random bits.
export const newPlayerId = () => `pl_${randomHex(16)}`

export const nameKey = (name: string) => name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase()

// What setup calls a seat left empty, in each language the app speaks ("Spieler 2", "Player 2").
const PLACEHOLDER = /^(spieler|player) \d+$/

export const isPlaceholderName = (name: string) => PLACEHOLDER.test(nameKey(name))

// No name, or only a seat number: not a known person.
export const isUnnamed = (name: string) => nameKey(name) === "" || isPlaceholderName(name)

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0)
const lastSeen = (p: PlayerRecord) => Math.max(time(p.lastPlayedAt), time(p.updatedAt), time(p.createdAt))

export function newPlayerRecord(name: string, at: string, id = newPlayerId()): PlayerRecord {
  return { id, name: name.trim(), nameKey: nameKey(name), createdAt: at, updatedAt: at }
}

// The player a name stands for: the one who played most recently when several share it, nobody
// for an empty seat.
export function findByName(players: PlayerRecord[], name: string): PlayerRecord | null {
  if (isUnnamed(name)) return null
  const key = nameKey(name)
  let best: PlayerRecord | null = null
  for (const p of players) if (p.nameKey === key && (!best || lastSeen(p) > lastSeen(best))) best = p
  return best
}

// Ids for the names entered in setup: a known name keeps its id, a new name gets a new player,
// an empty seat gets an id for this game only. `created` still has to be saved.
export function assignPlayers(names: string[], directory: PlayerRecord[], now = new Date()) {
  const at = now.toISOString()
  const created: PlayerRecord[] = []
  const used = new Set<string>()
  const players: MatchPlayer[] = names.map((name) => {
    if (isUnnamed(name)) return { id: newPlayerId(), name }
    // Two seats never share an id, even if their names differ only in spacing.
    const known = findByName(directory.filter((p) => !used.has(p.id)), name)
    const id = known?.id ?? newPlayerId()
    if (!known) created.push(newPlayerRecord(name, at, id))
    used.add(id)
    return { id, name }
  })
  return { players, created }
}

export interface ResolvedPlayer {
  playerId: string
  unnamed: boolean
  pubkey?: string
}

// Who played a finished game, for its archive entry. Games started by setup already carry
// stable ids; games from version 1.0.0 (resumed, or "play again") carry ids that were only for
// that screen, so their players are looked up by name. Returns the directory entries to save:
// new players, the latest spelling and when each last played.
export function resolvePlayers(players: MatchPlayer[], directory: PlayerRecord[], playedAt: string) {
  const byId = new Map(directory.map((p) => [p.id, p]))
  const used = new Set<string>()
  const records: PlayerRecord[] = []
  const resolved: ResolvedPlayer[] = players.map((p) => {
    // Two seats never share an id.
    const ownId = isPlayerId(p.id) && !used.has(p.id) ? p.id : null
    if (isUnnamed(p.name)) {
      const playerId = ownId ?? newPlayerId()
      used.add(playerId)
      return { playerId, unnamed: true }
    }
    const record = ownId
      ? (byId.get(ownId) ?? newPlayerRecord(p.name, playedAt, ownId))
      : (findByName([...byId.values()].filter((r) => !used.has(r.id)), p.name) ?? newPlayerRecord(p.name, playedAt))
    used.add(record.id)
    const respelled = record.nameKey === nameKey(p.name) && record.name !== p.name.trim()
    const updated: PlayerRecord = {
      ...record,
      ...(respelled ? { name: p.name.trim(), updatedAt: playedAt } : {}),
      lastPlayedAt: time(record.lastPlayedAt) > time(playedAt) ? record.lastPlayedAt : playedAt,
    }
    byId.set(updated.id, updated)
    records.push(updated)
    return { playerId: updated.id, unnamed: false, ...(updated.pubkey ? { pubkey: updated.pubkey } : {}) }
  })
  return { resolved, records }
}

// Imported 1.0.0 name groups assigned to a player: name key -> player id.
export function importedAliases(players: PlayerRecord[]) {
  const aliases = new Map<string, string>()
  for (const p of players) for (const key of p.importedNames ?? []) aliases.set(key, p.id)
  return aliases
}

// A player record from a file or another device, checked and tidied; null if it isn't one.
export function parsePlayerRecord(value: unknown): PlayerRecord | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  if (!isPlayerId(v.id) || typeof v.name !== "string" || isUnnamed(v.name) || v.name.length > 100) return null
  const date = (d: unknown, fallback: string) => (typeof d === "string" && !Number.isNaN(Date.parse(d)) ? d : fallback)
  const createdAt = date(v.createdAt, new Date(0).toISOString())
  const imported = Array.isArray(v.importedNames) ? v.importedNames.filter((n): n is string => typeof n === "string" && n.length <= 100) : []
  return {
    ...newPlayerRecord(v.name, createdAt, v.id),
    updatedAt: date(v.updatedAt, createdAt),
    ...(typeof v.lastPlayedAt === "string" && !Number.isNaN(Date.parse(v.lastPlayedAt)) ? { lastPlayedAt: v.lastPlayedAt } : {}),
    ...(isPubkey(v.pubkey) ? { pubkey: v.pubkey } : {}),
    ...(imported.length > 0 ? { importedNames: imported.map(nameKey) } : {}),
  }
}

// ---- Stored directory -------------------------------------------------------------------------

export const listPlayers = () => dbGetAll<PlayerRecord>("players")

export const getPlayer = (id: string) => dbGet<PlayerRecord>("players", id)

export const savePlayers = (records: PlayerRecord[]) => dbPut("players", records)

export async function findPlayerByName(name: string) {
  return findByName(await listPlayers(), name)
}

async function update(id: string, change: (p: PlayerRecord) => PlayerRecord) {
  const record = await getPlayer(id)
  if (!record) return null
  const updated = { ...change(record), updatedAt: new Date().toISOString() }
  await dbPut("players", updated)
  return updated
}

// A new name for the same person: their id, results and profile link stay. A seat number is
// not a name, so it is refused (null), as is an unknown id.
export function renamePlayer(id: string, name: string) {
  if (isUnnamed(name)) return Promise.resolve(null)
  return update(id, (p) => ({ ...p, name: name.trim(), nameKey: nameKey(name) }))
}

// Links a local player to a public profile, or unlinks them (null).
export function linkPubkey(id: string, pubkey: string | null) {
  if (pubkey !== null && !isPubkey(pubkey)) return Promise.resolve(null)
  return update(id, (p) => {
    const next = { ...p }
    if (pubkey) next.pubkey = pubkey
    else delete next.pubkey
    return next
  })
}

// Counts an imported 1.0.0 name group for one player and nobody else, or for nobody (null).
export async function assignImportedName(importedName: string, playerId: string | null) {
  const key = nameKey(importedName)
  const players = await listPlayers()
  if (playerId !== null && !players.some((p) => p.id === playerId)) return false
  const now = new Date().toISOString()
  const changed = players.flatMap((p) => {
    const had = p.importedNames ?? []
    const names = [...had.filter((n) => n !== key), ...(p.id === playerId ? [key] : [])]
    if (names.length === had.length && names.every((n, i) => n === had[i])) return []
    const next: PlayerRecord = { ...p, importedNames: names, updatedAt: now }
    if (names.length === 0) delete next.importedNames
    return [next]
  })
  await savePlayers(changed)
  return true
}
