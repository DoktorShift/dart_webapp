import { ENGINE_VERSION, replay } from "../game/engine.ts"
import type { GameType, MatchConfig, Throw } from "../game/types.ts"
import {
  ARCHIVE_SCHEMA,
  importV1Matches,
  loadArchive,
  toV1Record,
  V1_SNAPSHOT_KEY,
  withArchive,
  type ArchivedMatch,
  type ArchivedPlayer,
  type V1Snapshot,
} from "./archive.ts"
import { announce, dbClear, dbGetAll, dbWrite, kvGet, STORES, type WriteOp } from "./db.ts"
import { listPlayers, parsePlayerRecord, type PlayerRecord } from "./players.ts"
import { isV1Record, mergeV1Records, readAllRaw, removeAllV1Data } from "./v1.ts"

// "Daten exportieren", "Daten importieren" and "Alle Daten auf diesem Gerät löschen". Loaded only
// when one of them is tapped (see components/data/data-section.tsx).
//
// The export is one readable JSON file: every archived game, the player directory and the raw
// text of every key version 1.0.0 keeps (settings, the running game, its history), so nothing
// on this device is missing from it. Importing merges by id and never overwrites what is here,
// except an imported 1.0.0 total that the file has in full.

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
}

export async function buildExport(now = new Date()): Promise<ExportFile> {
  await importV1Matches().catch(() => 0)
  const [matches, players, v1Snapshot] = await withArchive(() =>
    Promise.all([loadArchive(), listPlayers().catch((): PlayerRecord[] => []), kvGet<V1Snapshot>(V1_SNAPSHOT_KEY).catch(() => undefined)]),
  )
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    matches,
    players,
    v1: readAllRaw(),
    v1Snapshot: v1Snapshot ?? null,
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
      // Entries in the file that aren't valid games or players.
      skipped: number
    }
  // "format": not an export of this app. "newer": made by a newer version. "storage": could not
  // be saved; nothing was changed.
  | { ok: false; reason: "format" | "newer" | "storage" }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

// ---- Checking a file --------------------------------------------------------------------------

const GAME_TYPES: GameType[] = ["x01", "cricket", "clock"]
const isDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v))
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0

// The same checks 1.0.0 makes before it resumes a game (lib/game/storage.ts validConfig).
function isMatchConfig(config: unknown): config is MatchConfig {
  if (!isObject(config)) return false
  const players = config.players
  return (
    GAME_TYPES.includes(config.type as GameType) &&
    typeof config.modeId === "string" &&
    typeof config.modeName === "string" &&
    typeof config.startScore === "number" &&
    Array.isArray(players) &&
    players.length >= 1 &&
    players.length <= 6 &&
    players.every((p) => isObject(p) && typeof p.name === "string" && typeof p.id === "string") &&
    typeof config.legsToWin === "number" &&
    (config.setsToWin === undefined || typeof config.setsToWin === "number")
  )
}

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
  if (v.schemaVersion !== ARCHIVE_SCHEMA || (v.source !== "local" && v.source !== "imported-v1")) return null
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
  try {
    return await withArchive(async () => {
      const [stored, directory] = await Promise.all([dbGetAll<ArchivedMatch>("matches"), listPlayers()])
      const here = new Map(stored.map((m) => [m.id, m]))
      const ops: WriteOp[] = []
      const fresh: ArchivedMatch[] = []
      let completed = 0
      let known = 0
      for (const match of incoming.values()) {
        const have = here.get(match.id)
        if (!have) {
          fresh.push(match)
          ops.push({ store: "matches", putNew: match })
        } else if (have.source === "imported-v1" && match.source === "local") {
          completed++
          ops.push({ store: "matches", put: match })
        } else known++
      }
      const knownPlayers = new Set(directory.map((p) => p.id))
      const newPlayers = [...players.values()].filter((p) => !knownPlayers.has(p.id))
      for (const putNew of newPlayers) ops.push({ store: "players", putNew })
      await dbWrite(ops)
      // Games new to this device also go to 1.0.0's history, like games played here.
      mergeV1Records(fresh.filter((m) => m.players.length >= 2).map(toV1Record))
      return { ok: true as const, added: fresh.length, completed, known, playersAdded: newPlayers.length, skipped }
    })
  } catch {
    return { ok: false, reason: "storage" }
  }
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
    announce({ type: "wipe" })
    return ok
  })
}
