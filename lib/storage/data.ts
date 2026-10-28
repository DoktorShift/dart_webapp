import { ENGINE_VERSION, replay } from "../game/engine.ts"
import { validConfig } from "../game/storage.ts"
import type { MatchConfig, Throw } from "../game/types.ts"
import {
  ARCHIVE_SCHEMA,
  importV1Matches,
  isImported,
  loadArchive,
  toV1Record,
  V1_SNAPSHOT_KEY,
  withArchive,
  type ArchivedMatch,
  type ArchivedPlayer,
  type V1Snapshot,
} from "./archive.ts"
import { announce, announceElsewhere, dbClear, dbGetAll, dbKeys, dbWrite, kvGet, STORES, type Keyed, type WriteOp } from "./db.ts"
import { exportSections } from "./export-sections.ts"
import { isPubkey, listPlayers, nameKey, parsePlayerRecord, type PlayerRecord } from "./players.ts"
import { linkOpsKey, loadLinkOps, parseLinkOp, type PlayerLinkOp } from "./player-link-ops.ts"
import { isV1Record, mergeV1Records, readAllRaw, removeAllV1Data } from "./v1.ts"

// "Daten exportieren", "Daten importieren" and "Alle Daten auf diesem Gerät löschen". Loaded only
// when one of them is tapped (see components/data/data-section.tsx).
//
// The export is one readable JSON file: every archived game, the player directory and the raw
// text of every key version 1.0.0 keeps (settings, the running game, its history), so nothing
// on this device is missing from it. Importing merges by id and never overwrites what is here,
// except imported totals (from 1.0.0 or a file) of a game the file has in full.

export const EXPORT_FORMAT = "blueline-data"
export const EXPORT_VERSION = 1

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  matches: ArchivedMatch[]
  players: PlayerRecord[]
  // localStorage key -> its exact text (null where not set), as 1.0.0 wrote it.
  v1: Record<string, string | null>
  // The same keys before this version first wrote to the archive (see archive.ts).
  v1Snapshot: V1Snapshot | null
  // What other areas keep on this device (badges), by section name (export-sections.ts).
  sections: Record<string, unknown>
  playerLinks?: { guest: Record<string, string>; profiles: Record<string, PlayerLinkOp[]> }
}

export async function buildExport(now = new Date()): Promise<ExportFile> {
  await importV1Matches().catch(() => 0)
  const [matches, players, v1Snapshot, playerLinks] = await withArchive(async () =>
    Promise.all([loadArchive(), listPlayers().catch((): PlayerRecord[] => []), kvGet<V1Snapshot>(V1_SNAPSHOT_KEY).catch(() => undefined), (async () => {
      const guest = await kvGet<Record<string, string>>("leaderboard.player-links") ?? {}
      const profiles: Record<string, PlayerLinkOp[]> = {}
      for (const key of await dbKeys("kv")) {
        const owner = key.startsWith("player-links.v2.") ? key.slice("player-links.v2.".length) : ""
        if (isPubkey(owner)) profiles[owner] = await loadLinkOps(owner)
      }
      return { guest, profiles }
    })()]),
  )
  const sections: Record<string, unknown> = {}
  for (const [name, section] of exportSections()) sections[name] = await section.build()
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    matches,
    players,
    v1: readAllRaw(),
    v1Snapshot: v1Snapshot ?? null,
    sections,
    playerLinks,
  }
}

// "blueline-daten-2026-10-04.json" (the first part in the player's language).
export function exportFileName(base: string, now = new Date()) {
  const pad = (n: number) => `${n}`.padStart(2, "0")
  return `${base}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

export type ImportResult =
  | {
      ok: true
      // Games that weren't on this device.
      added: number
      // Imported 1.0.0 totals replaced by the full game from the file.
      completed: number
      // Games already here.
      known: number
      playersAdded: number
      // Players already here.
      playersKnown: number
      // Entries in the file that aren't valid games or players.
      skipped: number
    }
  // "format": not an export of this app. "newer": made by a newer version. "storage": could not
  // be saved; nothing was changed.
  | { ok: false; reason: "format" | "newer" | "storage" }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

// ---- Checking a file --------------------------------------------------------------------------

const isDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v))
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0

// The checks 1.0.0 makes before it resumes a game, plus the mode fields an archived game needs.
const isMatchConfig = (config: unknown): config is MatchConfig =>
  validConfig(config) && typeof config.modeId === "string" && typeof config.modeName === "string" && typeof config.startScore === "number"

function parsePlayer(value: unknown): ArchivedPlayer | null {
  if (!isObject(value) || typeof value.name !== "string" || value.name.length > 100 || typeof value.won !== "boolean") return null
  if (!isCount(value.darts) || !isCount(value.points)) return null
  const playerId = value.playerId
  if (playerId !== null && (typeof playerId !== "string" || playerId.length === 0 || playerId.length > 100)) return null
  return {
    playerId,
    name: value.name,
    ...(value.unnamed === true ? { unnamed: true } : {}),
    ...(typeof value.pubkey === "string" && /^[0-9a-f]{64}$/.test(value.pubkey) ? { pubkey: value.pubkey } : {}),
    won: value.won,
    darts: value.darts,
    points: value.points,
  }
}

// An archive entry from an exported file, checked and rebuilt from known fields only; null if
// it isn't a valid finished game. Throw logs are replayed: the winner must be the one recorded.
export function parseArchivedMatch(value: unknown): ArchivedMatch | null {
  if (!isV1Record(value)) return null
  const v = value as unknown as Record<string, unknown>
  if (v.schemaVersion !== ARCHIVE_SCHEMA || (v.source !== "local" && v.source !== "imported-v1" && v.source !== "imported-file")) return null
  if (value.id.length === 0 || value.id.length > 200 || !isDate(value.finishedAt) || typeof v.modeId !== "string") return null
  if (value.players.length < 1 || value.players.length > 6) return null
  const players = value.players.map(parsePlayer)
  if (players.some((p) => p === null)) return null
  const engineVersion = v.engineVersion === null || isCount(v.engineVersion) ? (v.engineVersion as number | null) : undefined
  if (engineVersion === undefined) return null

  let config: MatchConfig | null = null
  let throws: Throw[] | null = null
  if (v.config !== null || v.throws !== null) {
    if (!isMatchConfig(v.config) || !Array.isArray(v.throws) || v.config.type !== value.modeType) return null
    if (v.config.players.length !== players.length) return null
    config = v.config
    throws = v.throws as Throw[]
    // Games scored by a newer engine are kept as they are, not replayed by these rules.
    if ((engineVersion ?? 0) <= ENGINE_VERSION) {
      try {
        const state = replay(config, throws)
        if (state.winner === null || players.some((p, i) => p!.won !== (i === state.winner))) return null
      } catch {
        return null
      }
    }
  }

  return {
    id: value.id,
    schemaVersion: ARCHIVE_SCHEMA,
    source: v.source,
    finishedAt: value.finishedAt,
    archivedAt: isDate(v.archivedAt) ? v.archivedAt : value.finishedAt,
    startedAt: isDate(v.startedAt) ? v.startedAt : null,
    modeId: v.modeId,
    modeName: value.modeName,
    modeType: value.modeType,
    config,
    throws,
    engineVersion,
    players: players as ArchivedPlayer[],
  }
}

export interface MergedMatches {
  // Games that weren't on this device.
  added: number
  // The games added, so an import can be taken back (removeMatches).
  ids: string[]
  // Imported totals replaced by the full game.
  completed: number
  // Games already here.
  known: number
}

// A game's facts without its id: when, what, who. Totals from a file have ids of their own, so
// this is how one of them is recognised as a game that is already here (played here, or synced).
const facts = (m: ArchivedMatch) => `${m.finishedAt}|${m.modeId}|${m.players.map((p) => nameKey(p.name)).sort().join(",")}`

// Writes the games that aren't here yet, in one write with `extra`. A full game replaces imported
// totals of the same game; nothing else here is overwritten. Runs inside withArchive.
async function mergeMatches(incoming: Map<string, ArchivedMatch>, extra: WriteOp[] = []): Promise<MergedMatches> {
  const stored = await dbGetAll<ArchivedMatch>("matches")
  const here = new Map(stored.map((m) => [m.id, m]))
  const knownFacts = new Set(stored.map(facts))
  const ops: WriteOp[] = [...extra]
  const fresh: ArchivedMatch[] = []
  let completed = 0
  let known = 0
  for (const match of incoming.values()) {
    const have = here.get(match.id)
    if (!have && match.source === "imported-file" && knownFacts.has(facts(match))) known++
    else if (!have) {
      fresh.push(match)
      knownFacts.add(facts(match))
      ops.push({ store: "matches", putNew: match })
    } else if (isImported(have) && match.source === "local") {
      completed++
      ops.push({ store: "matches", put: match })
    } else known++
  }
  await dbWrite(ops)
  // Games new to this device also go to 1.0.0's history, like games played here; totals from a
  // table stay in the archive alone, so taking the import back leaves nothing behind.
  mergeV1Records(fresh.filter((m) => m.players.length >= 2 && m.source !== "imported-file").map(toV1Record))
  return { added: fresh.length, ids: fresh.map((m) => m.id), completed, known }
}

// Takes games out again, by id: the way back from an import. Only games that came from a file
// go; anything else is left alone.
export async function removeMatches(ids: readonly string[]): Promise<number> {
  return withArchive(async () => {
    const stored = await dbGetAll<ArchivedMatch>("matches")
    const gone = stored.filter((m) => ids.includes(m.id) && m.source === "imported-file")
    if (gone.length > 0) await dbWrite(gone.map((m) => ({ store: "matches" as const, delete: m.id })))
    return gone.length
  })
}

// Games from a history file (lib/profile/import.ts): added where they aren't here yet. A seat's
// player id from another device means nothing here: such seats go by their name, like imported
// totals, so "that's me" and the Rangliste's assignment reach them. Rejects when nothing could
// be written; then nothing was changed.
export async function importMatches(matches: readonly ArchivedMatch[]): Promise<MergedMatches> {
  await importV1Matches().catch(() => 0)
  return withArchive(async () => {
    const directory = new Set((await listPlayers()).map((p) => p.id))
    const incoming = new Map<string, ArchivedMatch>()
    for (const raw of matches) {
      const match = { ...raw, players: raw.players.map((p) => (p.playerId && !directory.has(p.playerId) ? { ...p, playerId: null } : p)) }
      if (!incoming.has(match.id) || (match.source === "local" && incoming.get(match.id)!.source !== "local")) incoming.set(match.id, match)
    }
    return mergeMatches(incoming)
  })
}

export async function importData(text: string): Promise<ImportResult> {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return { ok: false, reason: "format" }
  }
  if (!isObject(file) || file.format !== EXPORT_FORMAT || !Number.isInteger(file.version) || (file.version as number) < 1)
    return { ok: false, reason: "format" }
  if ((file.version as number) > EXPORT_VERSION) return { ok: false, reason: "newer" }
  if (!Array.isArray(file.matches) || !Array.isArray(file.players)) return { ok: false, reason: "format" }

  let skipped = 0
  const incoming = new Map<string, ArchivedMatch>()
  for (const raw of file.matches) {
    const match = parseArchivedMatch(raw)
    if (!match) skipped++
    // The same game twice in one file: the full game wins over imported totals.
    else if (!incoming.has(match.id) || (match.source === "local" && incoming.get(match.id)!.source !== "local")) incoming.set(match.id, match)
  }
  const players = new Map<string, PlayerRecord>()
  for (const raw of file.players) {
    const player = parsePlayerRecord(raw)
    if (player) players.set(player.id, player)
    else skipped++
  }

  // 1.0.0 results first, so they count as already here.
  await importV1Matches().catch(() => 0)
  let result: ImportResult
  try {
    result = await withArchive(async () => {
      const directory = await listPlayers()
      const knownPlayers = new Set(directory.map((p) => p.id))
      const newPlayers = [...players.values()].filter((p) => !knownPlayers.has(p.id))
      const extra: WriteOp[] = newPlayers.map((putNew) => ({ store: "players", putNew }))
      const links = isObject(file.playerLinks) ? file.playerLinks : {}
      const allPlayers = new Map([...directory, ...newPlayers].map((p) => [p.id, p]))
      if (isObject(links.guest)) {
        const stored = await kvGet<Record<string, string>>("leaderboard.player-links") ?? {}
        const guest = { ...stored }
        for (const [source, target] of Object.entries(links.guest)) {
          if (typeof target !== "string" || source in guest || allPlayers.get(source)?.pubkey || !allPlayers.has(source) || !allPlayers.get(target)?.pubkey || source === target) continue
          guest[source] = target
        }
        extra.push({ store: "kv", put: { id: "leaderboard.player-links", value: guest } as Keyed })
      }
      if (isObject(links.profiles)) for (const [owner, raw] of Object.entries(links.profiles)) {
        if (!isPubkey(owner) || !Array.isArray(raw)) continue
        const existing = await loadLinkOps(owner)
        const seen = new Set(existing.map((op) => op.id))
        const fresh = raw.flatMap((value) => {
          const op = parseLinkOp(value)
          if (!op || seen.has(op.id)) return []
          seen.add(op.id)
          return [op]
        })
        if (fresh.length) extra.push({ store: "kv", put: { id: linkOpsKey(owner), value: [...existing, ...fresh] } as Keyed })
      }
      const { added, completed, known } = await mergeMatches(incoming, extra)
      return { ok: true as const, added, completed, known, playersAdded: newPlayers.length, playersKnown: players.size - newPlayers.length, skipped }
    })
  } catch {
    return { ok: false, reason: "storage" }
  }
  // The areas' sections, each on its own: the games are in either way, and a section that
  // fails is taken in by the next import of the file.
  const sections = isObject(file.sections) ? file.sections : {}
  for (const [name, section] of exportSections()) if (name in sections) await section.apply(sections[name]).catch(() => {})
  return result
}

// Deletes every key of version 1.0.0 (the running game, settings, language, appearance, the
// history) and everything in the database, then tells other open tabs. Returns false if
// anything could not be deleted.
export async function wipeAllData() {
  return withArchive(async () => {
    let ok = removeAllV1Data()
    try {
      await dbClear([...STORES])
    } catch {
      ok = false
    }
    // Other tabs start fresh either way, so they can't write back what is gone. This tab only
    // does after a complete wipe; otherwise it stays to say that not everything was deleted.
    if (ok) announce({ type: "wipe" })
    else announceElsewhere({ type: "wipe" })
    return ok
  })
}
