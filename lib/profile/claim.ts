import { withArchive, type ArchivedMatch } from "../storage/archive.ts"
import { dbGet, dbGetAll, dbWrite, type WriteOp } from "../storage/db.ts"
import { isPlayerId, isUnnamed, nameKey, newPlayerRecord, type PlayerRecord } from "../storage/players.ts"

// Which local player a profile is, on this device. A player becomes the profile's by a
// deliberate choice ("Welcher Spieler bist du?"): the player directory links them to the
// profile, and their archived games are marked as the profile's, so private history and later
// areas know whose they are. Names never decide this on their own (PLAN.md: historical guest
// names are no proof of who someone is), and a player linked to another profile is never taken.

// The profile's players here: everyone the directory or the archive links to it. Several devices
// give one profile several player ids; `sameAs` makes their games count as one player's
// (lib/storage/stats.ts), under `key`.
export function profilePlayers(pubkey: string, directory: readonly PlayerRecord[], matches: readonly ArchivedMatch[]) {
  const linked = directory.filter((p) => p.pubkey === pubkey)
  const ids = new Set(linked.map((p) => p.id))
  for (const match of matches) for (const p of match.players) if (p.pubkey === pubkey && p.playerId) ids.add(p.playerId)
  const latest = [...linked].sort((a, b) => (b.lastPlayedAt ?? b.updatedAt).localeCompare(a.lastPlayedAt ?? a.updatedAt))[0]
  const main = latest?.id ?? [...ids][0] ?? null
  const sameAs = new Map([...ids].map((id) => [id, main as string]))
  return { player: latest ?? null, key: main ? `id:${main}` : null, sameAs }
}

// Marks a player's archived games as the profile's, in the same write as the player itself.
function claimOps(record: PlayerRecord, pubkey: string, matches: readonly ArchivedMatch[]): WriteOp[] {
  const player: PlayerRecord = { ...record, pubkey }
  const games = matches
    .filter((m) => m.players.some((p) => p.playerId === record.id && p.pubkey !== pubkey))
    .map((m): ArchivedMatch => ({ ...m, players: m.players.map((p) => (p.playerId === record.id ? { ...p, pubkey } : p)) }))
  return [{ store: "players", put: player }, ...games.map((put): WriteOp => ({ store: "matches", put }))]
}

const renamed = (record: PlayerRecord, name: string | undefined, at: string): PlayerRecord =>
  name && !isUnnamed(name) && name.trim() !== record.name ? { ...record, name: name.trim(), nameKey: nameKey(name), updatedAt: at } : record

// Makes a known player the profile's, optionally under a new name. False when the player is
// unknown or belongs to another profile.
export function claimPlayer(playerId: string, pubkey: string, name?: string) {
  return withArchive(async () => {
    const [record, matches] = await Promise.all([dbGet<PlayerRecord>("players", playerId), dbGetAll<ArchivedMatch>("matches")])
    if (!record || (record.pubkey && record.pubkey !== pubkey)) return false
    const at = new Date().toISOString()
    await dbWrite(claimOps({ ...renamed(record, name, at), updatedAt: at }, pubkey, matches))
    return true
  })
}

// Makes the player of one seat of a finished game the profile's: "only this seat's games are
// taken over". The seat is looked up in the archive, where the game is stored with the ids its
// players have in the directory.
export function claimSeat(matchId: string, seat: number, pubkey: string, name: string) {
  return withArchive(async () => {
    const [stored, matches] = await Promise.all([dbGet<ArchivedMatch>("matches", matchId), dbGetAll<ArchivedMatch>("matches")])
    const playerId = stored?.players[seat]?.playerId
    if (!playerId || !isPlayerId(playerId) || stored.players[seat].unnamed) return false
    const at = new Date().toISOString()
    const record = (await dbGet<PlayerRecord>("players", playerId)) ?? newPlayerRecord(stored.players[seat].name, at, playerId)
    if (record.pubkey && record.pubkey !== pubkey) return false
    await dbWrite(claimOps({ ...renamed(record, name, at), updatedAt: at }, pubkey, matches))
    return true
  })
}

// A player for a profile that has none on this device yet (signed in without taking over any
// games), so it can be picked in setup and its games count from now on.
export async function addProfilePlayer(pubkey: string, name: string) {
  if (isUnnamed(name)) return
  const directory = await dbGetAll<PlayerRecord>("players")
  if (directory.some((p) => p.pubkey === pubkey)) return
  const player: PlayerRecord = { ...newPlayerRecord(name, new Date().toISOString()), pubkey }
  await dbWrite([{ store: "players", put: player }])
}
