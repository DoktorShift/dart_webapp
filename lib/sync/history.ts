import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import { profilePlayers } from "../profile/claim.ts"
import { gamesOf } from "../profile/history.ts"
import { decodeThrows, encodeThrows } from "../protocol/throws.ts"
import type { ArchivedMatch } from "../storage/archive.ts"
import { parseArchivedMatch } from "../storage/data.ts"
import { importedAliases, nameKey, parsePlayerRecord, type PlayerRecord } from "../storage/players.ts"
import { compareVersions } from "./records.ts"

// The profile's private history (decision 0001 F2, PLAN.md "Historie Statistiken und Migration"):
// which of this device's data goes into private records, what it looks like there, and which
// version of a record wins.
//
// - One record per game of the profile: the games its Profile tab shows (gamesOf), imported 1.0.0
//   totals assigned to it included, with the throw log compacted (lib/protocol/throws.ts). Other
//   people's games on this device stay here.
// - One record "players": the directory entries those games name (and the profile's own), so
//   another device shows the same people under the same ids, and its setup finds them by name.
// - Games are whole records, versioned by (rev, device): a higher version replaces a lower one,
//   and a deletion is a version too (a tombstone), so an older copy never brings a game back.
//   The players record is a small list: read, merged entry by entry, written (decision below).

export const PLAYERS_RECORD = "players"
const MATCH_PREFIX = "match:"
// Record ids allow [A-Za-z0-9_.:-] up to 80 characters (lib/protocol/private.ts).
const PLAIN_ID = /^[A-Za-z0-9_.:-]{1,74}$/

export type RecordType = "match" | "players"

export interface HistoryRecord {
  type: RecordType
  data: Record<string, unknown>
  hash: string
}

// A version of a record as this device knows it: its own last one, or one found on relays.
export interface Version {
  rev: number
  device: string
  deleted: boolean
  // Of the data; "" for a deletion.
  hash: string
}

export const matchRecordId = (matchId: string) => `${MATCH_PREFIX}${PLAIN_ID.test(matchId) ? matchId : bytesToHex(sha256(utf8ToBytes(matchId))).slice(0, 32)}`

export const isMatchRecord = (recordId: string) => recordId.startsWith(MATCH_PREFIX)

// JSON with object keys sorted, so the same content always hashes the same, whichever device
// (or parser) put its fields in which order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

export const hashOf = (data: Record<string, unknown>) => bytesToHex(sha256(utf8ToBytes(canonical(data))))

export const sameContent = (a: unknown, b: unknown) => canonical(a) === canonical(b)

// ---- What a record holds -----------------------------------------------------------------------

export function matchData(match: ArchivedMatch): Record<string, unknown> {
  return { ...match, throws: match.throws === null ? null : encodeThrows(match.throws) }
}

// The game in a record, checked like a game from an exported file (replayed: the winner must be
// the one recorded); null if it isn't one.
export function matchFromData(data: Record<string, unknown>): ArchivedMatch | null {
  try {
    return parseArchivedMatch({ ...data, throws: typeof data.throws === "string" ? decodeThrows(data.throws) : data.throws })
  } catch {
    return null
  }
}

export const playersData = (players: readonly PlayerRecord[]) => ({ players: [...players].sort((a, b) => (a.id < b.id ? -1 : 1)) })

export function playersFromData(data: Record<string, unknown>): PlayerRecord[] {
  return Array.isArray(data.players) ? data.players.flatMap((p) => parsePlayerRecord(p) ?? []) : []
}

// ---- The profile's records on this device -----------------------------------------------------

export function profileRecords(pubkey: string, matches: readonly ArchivedMatch[], directory: readonly PlayerRecord[]): Map<string, HistoryRecord> {
  const records = new Map<string, HistoryRecord>()
  const { key, sameAs } = profilePlayers(pubkey, directory, matches)
  if (!key) return records
  const aliases = importedAliases([...directory])
  const named = new Set<string>()
  for (const { match } of gamesOf(matches, key, { aliases, sameAs })) {
    const data = matchData(match)
    records.set(matchRecordId(match.id), { type: "match", data, hash: hashOf(data) })
    for (const p of match.players) {
      const id = p.playerId ?? aliases.get(nameKey(p.name))
      if (id) named.add(id)
    }
  }
  const players = directory.filter((p) => named.has(p.id) || p.pubkey === pubkey)
  if (players.length > 0) {
    const data = playersData(players)
    records.set(PLAYERS_RECORD, { type: "players", data, hash: hashOf(data) })
  }
  return records
}

// ---- Which version wins -----------------------------------------------------------------------

// For one game: "take" the version found on relays, "write" this device's (a new version above
// both), or "keep" things as they are. `local` is the game here now, `copy` the version this
// device last wrote or took, `remote` the newest found on relays.
//
// A change made here since the last sync wins over one found on relays (it is the later intent):
// a game deleted here stays deleted, a correction stays. Without a change here, the newer version
// from relays is taken, deletions included. Two exceptions keep data whole: the full game wins
// over imported 1.0.0 totals of it, and imported totals never undo a deletion.
export function decideMatch(local: HistoryRecord | undefined, copy: Version | undefined, remote: (Version & { source?: unknown }) | undefined): "take" | "write" | "keep" {
  const importedHere = local?.data.source === "imported-v1"
  const changedHere = local ? !copy || copy.deleted || copy.hash !== local.hash : !!copy && !copy.deleted
  if (remote && (!copy || compareVersions(remote, copy) > 0)) {
    if (!changedHere) return "take"
    if (remote.deleted) return local && !importedHere ? "write" : "take"
    if (local && (remote.hash === local.hash || (importedHere && remote.source === "local"))) return "take"
    return "write"
  }
  if (!changedHere || (importedHere && copy?.deleted)) return "keep"
  return "write"
}

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0)

// One person as two devices know them: the more recently changed entry, played last at the later
// of both dates.
function mergePlayer(a: PlayerRecord, b: PlayerRecord): PlayerRecord {
  const [newer, older] = time(a.updatedAt) > time(b.updatedAt) || (time(a.updatedAt) === time(b.updatedAt) && canonical(a) >= canonical(b)) ? [a, b] : [b, a]
  const lastPlayed = [newer.lastPlayedAt, older.lastPlayedAt].filter((d): d is string => !!d).sort((x, y) => time(y) - time(x))[0]
  const merged: PlayerRecord = { ...newer, createdAt: time(older.createdAt) < time(newer.createdAt) ? older.createdAt : newer.createdAt }
  if (lastPlayed) merged.lastPlayedAt = lastPlayed
  return merged
}

// Read-merge-write for the players record: the entries found on relays and this device's, merged
// by id. What the merge changes here is stored here; if it adds anything to what relays have,
// it is written as the next version.
export function mergePlayers(found: readonly PlayerRecord[], here: readonly PlayerRecord[]): PlayerRecord[] {
  const byId = new Map(found.map((p) => [p.id, p]))
  for (const p of here) {
    const known = byId.get(p.id)
    byId.set(p.id, known ? mergePlayer(known, p) : p)
  }
  return playersData([...byId.values()]).players
}
