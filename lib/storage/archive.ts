import { ENGINE_VERSION, replay, type MatchState } from "../game/engine.ts"
import type { MatchConfig, SavedMatch, Throw } from "../game/types.ts"
import { dbDelete, dbGet, dbGetAll, dbKeys, dbWrite, type Keyed, type WriteOp } from "./db.ts"
import { isUnnamed, listPlayers, resolvePlayers, type PlayerRecord } from "./players.ts"
import {
  clearV1Records,
  findV1Record,
  isV1Record,
  readAllRaw,
  readV1Records,
  removeV1Record,
  replaceV1Records,
  upsertV1Record,
  V1_KEYS,
  type V1MatchRecord,
  type V1PlayerResult,
} from "./v1.ts"

// Every finished game, kept whole: rules, the full throw log and who played (by stable id). The
// throw log is the truth; statistics are rebuilt from it by the engine.
//
// Results from version 1.0.0 are taken over as "imported-v1": only the totals it stored, never
// invented throws. Games with two or more players are also written in the 1.0.0 format to its
// own history (dart-scorer.matches.v1), so going back to 1.0.0 loses no game.

export const ARCHIVE_SCHEMA = 1

// "local": played and scored on this device. "imported-v1": totals taken over from 1.0.0.
export type ArchiveSource = "local" | "imported-v1"

export interface ArchivedPlayer extends V1PlayerResult {
  // The player directory's id; null in imported results, which know only names.
  playerId: string | null
  // An empty seat ("Spieler 1"): not a known person.
  unnamed?: boolean
  // The public profile linked to the player when the game was archived.
  pubkey?: string
}

// The 1.0.0 result fields, plus everything needed to replay the game.
export interface ArchivedMatch extends V1MatchRecord {
  schemaVersion: typeof ARCHIVE_SCHEMA
  source: ArchiveSource
  players: ArchivedPlayer[]
  startedAt: string | null
  // When this device stored it (finishedAt is when the game was won).
  archivedAt: string
  // Null for imported results.
  config: MatchConfig | null
  throws: Throw[] | null
  engineVersion: number | null
}

// One archive change at a time: a quick Undo right after the winning dart must not overtake the
// write of the game it undoes.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

const newestFirst = (matches: ArchivedMatch[]) => matches.sort((a, b) => (Date.parse(b.finishedAt) || 0) - (Date.parse(a.finishedAt) || 0))

// The result in the 1.0.0 format, field for field.
export function toV1Record(match: ArchivedMatch): V1MatchRecord {
  return {
    id: match.id,
    finishedAt: match.finishedAt,
    modeId: match.modeId,
    modeName: match.modeName,
    modeType: match.modeType,
    players: match.players.map(({ name, won, darts, points }) => ({ name, won, darts, points })),
  }
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0)

export function fromV1Record(record: V1MatchRecord, now = new Date()): ArchivedMatch {
  return {
    id: record.id,
    schemaVersion: ARCHIVE_SCHEMA,
    source: "imported-v1",
    finishedAt: record.finishedAt,
    archivedAt: now.toISOString(),
    startedAt: null,
    modeId: typeof record.modeId === "string" ? record.modeId : record.modeType,
    modeName: record.modeName,
    modeType: record.modeType,
    config: null,
    throws: null,
    engineVersion: null,
    players: record.players.map((p) => ({
      playerId: null,
      name: p.name,
      ...(isUnnamed(p.name) ? { unnamed: true } : {}),
      won: p.won,
      darts: count(p.darts),
      points: count(p.points),
    })),
  }
}

// Before this version first writes to the archive or to 1.0.0's history, it keeps an exact copy
// of every key 1.0.0 uses ("kv" store), so a repair can always start from the history as it was
// before the upgrade. (The running game and settings are rewritten as the app is used, as in
// 1.0.0, so their copy is just the latest state.) Taken once; resetting the Rangliste empties
// its history, and deleting all data removes it.
export const V1_SNAPSHOT_KEY = "v1-snapshot"

export interface V1Snapshot {
  takenAt: string
  // localStorage key -> its exact text, null where not set.
  raw: Record<string, string | null>
}

async function snapshotOps(now: Date): Promise<WriteOp[]> {
  if (await dbGet("kv", V1_SNAPSHOT_KEY)) return []
  const raw = readAllRaw()
  if (Object.values(raw).every((text) => text === null)) return []
  const snapshot: V1Snapshot = { takenAt: now.toISOString(), raw }
  return [{ store: "kv", putNew: { id: V1_SNAPSHOT_KEY, value: snapshot } as Keyed }]
}

const sameGame = (stored: ArchivedMatch, match: SavedMatch) =>
  JSON.stringify(stored.throws) === JSON.stringify(match.throws) && JSON.stringify(stored.config) === JSON.stringify(match.config)

// Archives a won game. Safe to call again and again (every render of the result screen, every
// reload): the finish time is taken once and kept, and an unchanged game writes nothing. A
// correction on the result screen updates the entry. Returns false when something could not be
// written, so the game can say so.
export function archiveFinished(match: SavedMatch, state: MatchState = replay(match.config, match.throws), now = new Date()) {
  return serial(async () => {
    if (state.winner === null) return true
    const versus = match.config.players.length >= 2
    let stored: ArchivedMatch | undefined
    let directory: PlayerRecord[] = []
    let readable = true
    try {
      ;[stored, directory] = await Promise.all([dbGet<ArchivedMatch>("matches", match.id), listPlayers()])
    } catch {
      readable = false
    }
    const v1 = versus ? findV1Record(match.id) : null
    const finishedAt = stored?.finishedAt ?? v1?.finishedAt ?? now.toISOString()

    if (stored?.source === "local" && sameGame(stored, match)) return versus && !v1 ? upsertV1Record(toV1Record(stored)) : true

    const { resolved, records } = resolvePlayers(match.config.players, readable ? directory : [], finishedAt)
    const record: ArchivedMatch = {
      id: match.id,
      schemaVersion: ARCHIVE_SCHEMA,
      source: "local",
      finishedAt,
      archivedAt: stored?.archivedAt ?? now.toISOString(),
      startedAt: typeof match.startedAt === "string" ? match.startedAt : null,
      modeId: match.config.modeId,
      modeName: match.config.modeName,
      modeType: match.config.type,
      config: match.config,
      throws: match.throws,
      engineVersion: ENGINE_VERSION,
      players: match.config.players.map((p, i) => ({
        playerId: resolved[i].playerId,
        name: p.name,
        ...(resolved[i].unnamed ? { unnamed: true } : {}),
        ...(resolved[i].pubkey ? { pubkey: resolved[i].pubkey } : {}),
        won: i === state.winner,
        darts: state.stats[i].darts,
        points: match.config.type === "x01" ? state.stats[i].points : 0,
      })),
    }

    let ok = readable
    // Without the directory, new player entries could double known players: don't write blind.
    if (readable) {
      try {
        const snapshot = await snapshotOps(now)
        await dbWrite([...snapshot, { store: "matches", put: record }, ...records.map((put): WriteOp => ({ store: "players", put }))])
      } catch {
        ok = false
      }
    }
    // The 1.0.0 copy comes second: another tab that takes over 1.0.0 results must find the game
    // archived already. If the database failed, this copy is what keeps the result.
    if (versus && !upsertV1Record(toV1Record(record))) ok = false
    return ok
  })
}

// Takes a game off again when its winning dart is undone (or a correction reopens it).
export function unarchive(id: string) {
  return serial(async () => {
    let ok = removeV1Record(id)
    try {
      if (await dbGet("matches", id)) await dbDelete("matches", id)
    } catch {
      ok = false
    }
    return ok
  })
}

// Games changed on another device of the profile (lib/sync), with the players they name: stored
// as they come, and kept in 1.0.0's history like games played here; deleted ones leave both, so
// no later start takes them over from there again. Throws when the archive can't be written;
// false when only 1.0.0's history couldn't.
export function applySynced(changes: { put: ArchivedMatch[]; remove: readonly string[]; players: readonly PlayerRecord[] }) {
  return serial(async () => {
    const { put, remove, players } = changes
    await dbWrite([
      ...put.map((m): WriteOp => ({ store: "matches", put: m })),
      ...remove.map((id): WriteOp => ({ store: "matches", delete: id })),
      ...players.map((p): WriteOp => ({ store: "players", put: p })),
    ])
    return replaceV1Records(put.filter((m) => m.players.length >= 2).map(toV1Record), remove)
  })
}

// Takes over 1.0.0 results not in the archive yet. Runs on every start and whenever another tab
// (possibly still running 1.0.0) adds a result; games this version wrote itself are already
// there under the same id, so nothing is ever taken twice. Returns how many were added.
export function importV1Matches(now = new Date()) {
  return serial(async () => {
    const ops = await snapshotOps(now)
    const records = readV1Records()
    const known = new Set(records.length > 0 ? await dbKeys("matches") : [])
    const fresh = records.filter((r) => !known.has(r.id) && !!known.add(r.id))
    // Only where nothing is stored yet: another tab may archive the full game meanwhile.
    await dbWrite([...ops, ...fresh.map((r): WriteOp => ({ store: "matches", putNew: fromV1Record(r, now) }))])
    return fresh.length
  })
}

// Everything to show, newest first. 1.0.0 results that couldn't be taken over yet (the database
// failed or isn't done) are included as they are, so a screen never shows less than 1.0.0 did.
export async function loadArchive(): Promise<ArchivedMatch[]> {
  let stored: ArchivedMatch[] = []
  try {
    stored = (await dbGetAll<ArchivedMatch>("matches")).filter(isV1Record)
  } catch {
    // Shown from the 1.0.0 history alone.
  }
  const known = new Set(stored.map((m) => m.id))
  const pending = readV1Records()
    .filter((r) => !known.has(r.id) && !!known.add(r.id))
    .map((r) => fromV1Record(r))
  return newestFirst([...stored, ...pending])
}

// "Rangliste zurücksetzen": the games on the Rangliste (two or more players), here and in the
// 1.0.0 history. Solo games stay for personal statistics. The copy of 1.0.0's history taken
// before the upgrade goes too (in the same write), so deleted results don't live on in it or in
// an export.
export function clearLeaderboard() {
  return serial(async () => {
    let ok = clearV1Records()
    try {
      const [all, snapshot] = await Promise.all([dbGetAll<ArchivedMatch>("matches"), dbGet<{ id: string; value: V1Snapshot }>("kv", V1_SNAPSHOT_KEY)])
      const ops: WriteOp[] = all.filter((m) => m.players.length >= 2).map((m) => ({ store: "matches", delete: m.id }))
      if (snapshot && typeof snapshot.value?.raw?.[V1_KEYS.matches] === "string") {
        const value: V1Snapshot = { ...snapshot.value, raw: { ...snapshot.value.raw, [V1_KEYS.matches]: "[]" } }
        ops.push({ store: "kv", put: { id: V1_SNAPSHOT_KEY, value } as Keyed })
      }
      await dbWrite(ops)
    } catch {
      ok = false
    }
    return ok
  })
}

// Runs a task once the archive changes before it are done, and before any that come after it
// (for an export, an import from a file, or deleting everything).
export const withArchive = <T>(task: () => Promise<T>) => serial(task)
