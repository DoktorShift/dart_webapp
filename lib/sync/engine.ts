import { query, supersedes } from "../nostr/client.ts"
import { countOperators } from "../nostr/relays.ts"
import { nowSeconds, syncClock } from "../nostr/time.ts"
import type { Filter, NostrEvent, Signer } from "../nostr/types.ts"
import { fetchOwnEvents, ownEvents, ownRelaySettings } from "../profile/own-events.ts"
import { publishTargets } from "../profile/relay-list.ts"
import { getSession, getSigner } from "../profile/session.ts"
import { KIND_PRIVATE } from "../protocol/kinds.ts"
import { applySynced, deletedMatches, type ArchivedMatch } from "../storage/archive.ts"
import { dbGetAll, kvGet, kvSet, onStorageChange } from "../storage/db.ts"
import { randomHex } from "../storage/ids.ts"
import { listPlayers, type PlayerRecord } from "../storage/players.ts"
import { createDataKey, DataKeyError, isDataKeyEvent, keepDataKey, resignDataKey, settleDataKey, storedDataKey, unwrapDataKey, type DataKey } from "./data-key.ts"
import {
  decideMatch,
  hashOf,
  isMatchRecord,
  matchData,
  matchFromData,
  mergePlayers,
  playersData,
  playersFromData,
  profileRecords,
  PLAYERS_RECORD,
  sameContent,
  type HistoryRecord,
  type LocalRecord,
  type RecordType,
  type Version,
} from "./history.ts"
import { enqueue, outboxStatus, type Delivery } from "./outbox.ts"
import { compareVersions, nextCreatedAt, openRecords, sealRecord, type RecordVersion } from "./records.ts"
import type { SyncProblem, SyncState } from "./status.ts"

// One sync of the signed-in profile's private history with its relays (P3b.01, P3b.02), in steps
// over one context (Sync): read, settleKey, take, write, heal, then keep.
//
// 1. read: the profile's kind-30078 events from each relay, page by page: all of them ("full"),
//    or only those since the last sync with some overlap. A relay that doesn't answer is unknown,
//    never empty. Once relays answered the device is online, so the clock is corrected
//    (lib/nostr/time.ts) before anything is signed.
// 2. settleKey: the data key, kept here, or unwrapped from relays once, or made on first write
//    (only once relays of two operators, or all of them, said there is none). Two keys:
//    ./data-key.ts.
// 3. take: what changed elsewhere goes into the archive and the player directory (./history.ts
//    decides per record).
// 4. write: what changed here goes out as new versions: sealed, signed one after another, handed
//    to the outbox. Their created_at are spread over the last minutes, so paging by created_at
//    (step 1) never meets more events of one second than a relay sends at once, but always above
//    the version the relays hold, or they would keep that one. A device whose clock is too far
//    behind for that leaves the change for a later sync ("clock").
// 5. heal (full sync): every relay that answered but lacks this device's current version of a
//    record gets it again; a version no relay has any more is written anew.
// 6. keep: the queued events and the versions known now, then the sync's meta.
//
// Every write to this device first checks that the sync is still wanted: the session it started
// for is still there (not signed out, not another profile, not wiped). Otherwise the sync ends
// without a trace (null).
//
// Locally the archive stays the truth (decision 0002 §1); relays are copies. Per profile this
// device keeps, in kv "profile.sync*" (gone with the profile, lib/profile/session.ts), its device
// id, the times of the last syncs and the version of each record it last wrote or took.

const META_ID = "profile.sync"
const COPIES_ID = "profile.sync.records"
// Incremental syncs look back this far before the last one: created_at spread (below) and
// clocks of other devices that run a little behind.
const OVERLAP_SECONDS = 15 * 60
const SPREAD_SECONDS = 10 * 60
const PAGE = 500
const MAX_PAGES = 40
// Long loops give the page a turn this often, so a first sync of many games never stalls input.
const YIELD_EVERY = 25

interface Meta {
  pubkey: string
  // This device among the profile's (the record versions' tie-breaker).
  device: string
  lastSync: number | null
  lastCheck: number | null
  state: SyncState | null
  problem: SyncProblem | null
  // Records changed here that the last sync left unwritten (it only read, or couldn't write
  // them): they go out with the next sync that writes.
  pending: number
}

// The version of a record this device last wrote or took, with the ids of its events. The
// players record keeps its data too: the base of the next merge when relays bring nothing newer.
interface Copy extends Version {
  ids: string[]
  createdAt: number
  data?: Record<string, unknown>
}

type Copies = Record<string, Copy>

export interface SyncOptions {
  full: boolean
  // Whether changes made here are signed and sent now. Without it the sync only reads: a signer
  // app or extension would ask for each record, so lib/sync/service.ts picks the moments.
  write?: boolean
  // Whether the sync is still wanted, beside the session check made here.
  alive?: () => boolean
}

export interface SyncResult {
  state: SyncState
  problem: SyncProblem | null
  lastSync: number | null
  lastCheck: number | null
  pending: number
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0))

export async function syncMeta(pubkey: string): Promise<Meta> {
  const stored = await kvGet<Meta>(META_ID)
  if (stored?.pubkey === pubkey) return stored
  return { pubkey, device: randomHex(8), lastSync: null, lastCheck: null, state: null, problem: null, pending: 0 }
}

// A profile whose key was made on this device has nothing on relays yet: it counts as synced at
// its birth, so the screens say "no games yet" instead of waiting for games from other devices.
export async function markSyncedAtBirth(pubkey: string, at: number) {
  const meta = await syncMeta(pubkey)
  if (meta.lastSync === null) await kvSet(META_ID, { ...meta, lastSync: at, state: "complete" })
}

async function loadCopies(pubkey: string): Promise<Copies> {
  const stored = await kvGet<{ pubkey: string; copies: Copies }>(COPIES_ID)
  return stored?.pubkey === pubkey ? stored.copies : {}
}

// ---- Reading relays ---------------------------------------------------------------------------

interface Answer {
  url: string
  events: NostrEvent[]
}

// Every event matching the filter on one relay, newest pages first; null when it didn't answer.
async function readRelay(url: string, filter: Filter): Promise<Answer | null> {
  const found = new Map<string, NostrEvent>()
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await query([{ ...filter, limit: PAGE, ...(until === undefined ? {} : { until }) }], [url])
    if (result.answered.length === 0) return null
    const fresh = result.events.filter((e) => !found.has(e.id))
    if (fresh.length === 0) break
    for (const e of fresh) found.set(e.id, e)
    until = Math.min(...result.events.map((e) => e.created_at))
  }
  return { url, events: [...found.values()] }
}

// The relays that answered, each with everything it holds for the filter.
async function readRelays(targets: readonly string[], filter: Filter): Promise<Answer[]> {
  const answers = await Promise.all(targets.map((url) => readRelay(url, filter)))
  return answers.filter((a): a is Answer => a !== null)
}

// ---- One sync ---------------------------------------------------------------------------------

// What this device knows of the newest version of a record on the relays.
interface Remote extends Version {
  ids: string[]
  createdAt: number
  match: ArchivedMatch | null
}

// What a sync carries from step to step.
interface Sync {
  pubkey: string
  full: boolean
  write: boolean
  now: () => number
  meta: Meta
  copies: Copies
  dataKey: DataKey | null
  sign: () => Promise<Signer>
  alive: () => boolean
  targets: string[]
  // The relays that answered, and every event they hold, by id.
  answered: Answer[]
  events: Map<string, NostrEvent>
  // Enough answers to say "there is none": every relay, or relays of two operators.
  conclusive: boolean
  remote: Map<string, Remote>
  playersVersion: RecordVersion | undefined
  unreadable: number
  local: Map<string, LocalRecord>
  // The players record after the merge: the base it builds on, and the entries now.
  players: { base: Copy | undefined; merged: PlayerRecord[] }
  deliveries: Delivery[]
  // What keeps the sync from being complete, beside relays that didn't answer and records that
  // couldn't be read.
  problem: SyncProblem | null
  // Changes made here that this sync didn't write (see Meta).
  pending: number
}

// The sync ends without a trace when its session is gone.
class SessionGone extends Error {}

// A write to this device, only while the sync is still wanted.
async function store<T>(sync: Sync, task: () => Promise<T>): Promise<T> {
  if (!sync.alive()) throw new SessionGone()
  return task()
}

const recordOf = (local: LocalRecord | undefined): HistoryRecord | undefined => (local === "deleted" ? undefined : local)

// Null when the session ended meanwhile: nothing of the sync was kept.
export async function syncHistory(pubkey: string, options: SyncOptions, now = Date.now): Promise<SyncResult | null> {
  let wiped = false
  const stop = onStorageChange((message) => {
    if (message.type === "wipe") wiped = true
  })
  const alive = () => !wiped && getSession()?.pubkey === pubkey && (options.alive?.() ?? true)
  try {
    const sync = await begin(pubkey, options, now, alive)
    if (!(await read(sync))) return finish(sync, "unavailable", "offline", false)
    const keyProblem = await settleKey(sync)
    if (keyProblem) return finish(sync, "unavailable", keyProblem, false)
    await take(sync)
    await writeChanges(sync)
    if (sync.full) heal(sync)
    await store(sync, () => enqueue(sync.deliveries, { coalesce: true }))
    await store(sync, () => kvSet(COPIES_ID, { pubkey, copies: sync.copies }))
    const problem = sync.problem ?? (sync.unreadable > 0 ? "records" : sync.answered.length < sync.targets.length ? "relays" : null)
    return finish(sync, problem ? "partial" : "complete", problem, true)
  } catch (error) {
    if (error instanceof SessionGone) return null
    throw error
  } finally {
    stop()
  }
}

async function begin(pubkey: string, options: SyncOptions, now: () => number, alive: () => boolean): Promise<Sync> {
  const meta = await syncMeta(pubkey)
  const [copies, dataKey] = await Promise.all([loadCopies(pubkey), storedDataKey(pubkey)])
  let signer: Promise<Signer> | null = null
  return {
    pubkey,
    full: options.full || meta.lastSync === null || dataKey === null,
    write: options.write ?? true,
    now,
    meta,
    copies,
    dataKey,
    sign: () => (signer ??= getSigner()),
    alive,
    targets: [],
    answered: [],
    events: new Map(),
    conclusive: false,
    remote: new Map(),
    playersVersion: undefined,
    unreadable: 0,
    local: new Map(),
    players: { base: undefined, merged: [] },
    deliveries: [],
    problem: null,
    pending: meta.pending,
  }
}

async function finish(sync: Sync, state: SyncState, problem: SyncProblem | null, read: boolean): Promise<SyncResult> {
  const at = sync.now()
  const next: Meta = { ...sync.meta, state, problem, pending: sync.pending, lastSync: read ? at : sync.meta.lastSync, lastCheck: read && sync.full ? at : sync.meta.lastCheck }
  await store(sync, () => kvSet(META_ID, next))
  return { state, problem, lastSync: next.lastSync, lastCheck: next.lastCheck, pending: next.pending }
}

// 1. Read. False when no relay answered.
async function read(sync: Sync): Promise<boolean> {
  if (sync.full) await fetchOwnEvents(sync.pubkey).catch(() => null)
  sync.targets = publishTargets(KIND_PRIVATE, ownRelaySettings(await ownEvents(sync.pubkey)))
  const since = sync.full || sync.meta.lastSync === null ? undefined : Math.floor(sync.meta.lastSync / 1000) - OVERLAP_SECONDS
  sync.answered = await readRelays(sync.targets, { kinds: [KIND_PRIVATE], authors: [sync.pubkey], ...(since ? { since } : {}) })
  if (sync.answered.length === 0) return false
  await syncClock()
  sync.events = new Map(sync.answered.flatMap((r) => r.events.map((e) => [e.id, e] as const)))
  sync.conclusive = sync.answered.length === sync.targets.length || countOperators(sync.answered.map((r) => r.url)) >= 2
  return true
}

// 2. The data key. Returns the problem that leaves the sync unable to read, or null.
async function settleKey(sync: Sync): Promise<SyncProblem | null> {
  const found = [...sync.events.values()].filter((e) => isDataKeyEvent(e, sync.pubkey)).reduce<NostrEvent | undefined>((newest, e) => (!newest || supersedes(e, newest) ? e : newest), undefined)
  try {
    if (!sync.dataKey && found) {
      const dataKey = await unwrapDataKey(found, await sync.sign(), sync.pubkey)
      await store(sync, () => keepDataKey(sync.pubkey, dataKey))
      sync.dataKey = dataKey
    } else if (sync.dataKey && found) {
      const settled = await settleDataKey(sync.dataKey, found, sync.sign, sync.pubkey)
      let dataKey = settled.dataKey
      // Another key won: every record is sealed anew under it.
      if (settled.outcome === "adopted") sync.copies = {}
      // Ours stays: signed again above the other's version, so relays keep it.
      if (settled.outcome === "kept" && sync.write) {
        dataKey = await resignDataKey(sync.dataKey, await sync.sign(), found.created_at)
        sync.deliveries.push({ event: dataKey.event, relays: sync.targets })
      }
      if (dataKey.event.id !== sync.dataKey.event.id) await store(sync, () => keepDataKey(sync.pubkey, dataKey))
      sync.dataKey = dataKey
    }
  } catch (error) {
    if (error instanceof SessionGone) throw error
    // Ours is the right key; this device can't sign it above the other's version now.
    if (error instanceof DataKeyError && error.problem === "clock") sync.problem = "clock"
    else return error instanceof DataKeyError ? error.problem : "signer"
  }
  return null
}

// The profile's records on this device: its games, deletions made here, and its players.
async function localRecords(sync: Sync) {
  const [matches, directory, deleted] = await Promise.all([dbGetAll<ArchivedMatch>("matches"), listPlayers(), deletedMatches()])
  return { directory, records: profileRecords(sync.pubkey, matches, directory, deleted) }
}

// The players record: the version found on relays when it is newer than the one last synced
// (then it becomes the base), merged with this device's entries. `changed` is what the merge
// changes on this device.
function mergePlayersRecord(found: RecordVersion | undefined, copy: Copy | undefined, here: readonly PlayerRecord[], directory: readonly PlayerRecord[]) {
  let base = copy
  if (found && !found.record.deleted && (!copy || compareVersions(found.record, copy) > 0)) {
    const data = playersData(playersFromData(found.data ?? {}))
    base = { rev: found.record.rev, device: found.record.device, deleted: false, hash: hashOf(data), ids: found.events.map((e) => e.id), createdAt: found.events[0].created_at, data }
  }
  const merged = mergePlayers(playersFromData(base?.data ?? {}), here)
  const known = new Map(directory.map((p) => [p.id, p]))
  return { base, merged, changed: merged.filter((p) => !sameContent(p, known.get(p.id))) }
}

// 3. Take what changed elsewhere into the archive and the player directory.
async function take(sync: Sync) {
  const opened = sync.dataKey ? openRecords([...sync.events.values()], sync.dataKey.key, sync.pubkey) : { versions: new Map<string, RecordVersion>(), unreadable: 0 }
  sync.unreadable = opened.unreadable
  sync.playersVersion = opened.versions.get(PLAYERS_RECORD)
  const here = await localRecords(sync)
  const { directory } = here
  let local = here.records
  const put: ArchivedMatch[] = []
  const remove: string[] = []
  let count = 0
  for (const [id, version] of opened.versions) {
    if (!isMatchRecord(id)) continue
    if (++count % YIELD_EVERY === 0) await pause()
    const match = version.data ? matchFromData(version.data) : null
    if (version.data && !match) {
      sync.unreadable++
      continue
    }
    const { rev, device } = version.record
    const found: Remote = { rev, device, deleted: !match, hash: match ? hashOf(matchData(match)) : "", ids: version.events.map((e) => e.id), createdAt: version.events[0].created_at, match }
    sync.remote.set(id, found)
    const mine = local.get(id)
    if (decideMatch(mine, sync.copies[id], { ...found, source: match?.source }) !== "take") continue
    const record = recordOf(mine)
    if (match && record?.hash !== found.hash) put.push(match)
    else if (!match && record) remove.push(record.data.id as string)
    sync.copies[id] = { rev, device, deleted: found.deleted, hash: found.hash, ids: found.ids, createdAt: found.createdAt }
  }

  const { base, merged, changed } = mergePlayersRecord(sync.playersVersion, sync.copies[PLAYERS_RECORD], playersFromData(recordOf(local.get(PLAYERS_RECORD))?.data ?? {}), directory)
  if (base) sync.copies[PLAYERS_RECORD] = base
  sync.players = { base, merged }
  if (put.length > 0 || remove.length > 0 || changed.length > 0) {
    await store(sync, () => applySynced({ put, remove, players: changed }))
    ;({ records: local } = await localRecords(sync))
  }
  sync.local = local
}

interface Write {
  id: string
  type: RecordType
  data: Record<string, unknown> | null
  hash: string
  rev: number
  replaces: number
}

// What this device writes as new versions: games changed or deleted here, the players record when
// the merge adds to what the relays have, and (full sync) versions no relay holds any more.
async function plannedWrites(sync: Sync): Promise<Write[]> {
  const { local, copies, remote } = sync
  const latest = (id: string) => Math.max(copies[id]?.createdAt ?? 0, remote.get(id)?.createdAt ?? 0)
  // Above every version seen: this device's, the relays' (a deleted players record included).
  const nextRev = (id: string) => Math.max(copies[id]?.rev ?? 0, remote.get(id)?.rev ?? 0, id === PLAYERS_RECORD ? (sync.playersVersion?.record.rev ?? 0) : 0) + 1
  // A version no relay that answered holds, and the outbox doesn't either, is lost: written anew.
  const waiting = sync.full ? new Set((await outboxStatus()).map((s) => s.id)) : new Set<string>()
  const lost = (copy: Copy) => sync.full && sync.conclusive && !copy.ids.some((id) => sync.events.has(id) || waiting.has(id))
  const writes: Write[] = []
  for (const id of new Set([...local.keys(), ...Object.keys(copies)])) {
    if (!isMatchRecord(id)) continue
    const here = local.get(id)
    const record = recordOf(here)
    const copy = copies[id]
    const found = remote.get(id)
    const decision = decideMatch(here, copy, found && { ...found, source: found.match?.source })
    // A lost deletion is written again as a deletion, whatever came back here meanwhile.
    const data = decision === "write" ? (record ?? null) : copy && lost(copy) ? (copy.deleted ? null : record) : undefined
    if (data !== undefined) writes.push({ id, type: "match", data: data?.data ?? null, hash: data?.hash ?? "", rev: nextRev(id), replaces: latest(id) })
  }
  const { base, merged } = sync.players
  const data = playersData(merged)
  const hash = hashOf(data)
  if (merged.length > 0 && (!base || base.hash !== hash || lost(base))) writes.push({ id: PLAYERS_RECORD, type: "players", data, hash, rev: nextRev(PLAYERS_RECORD), replaces: latest(PLAYERS_RECORD) })
  return writes
}

// The first data key of a profile whose relays confirmed it has none.
async function newDataKey(sync: Sync): Promise<DataKey> {
  const dataKey = await createDataKey(await sync.sign())
  await store(sync, () => keepDataKey(sync.pubkey, dataKey))
  sync.dataKey = dataKey
  sync.deliveries.push({ event: dataKey.event, relays: sync.targets })
  return dataKey
}

// 4. Write what changed here. A sync that only reads still counts the changes, so the screens
// can say what waits for the next one that writes.
async function writeChanges(sync: Sync) {
  const writes = await plannedWrites(sync)
  sync.pending = writes.length
  // No key is made while a relay that didn't answer may hold one: the change waits.
  if (!sync.write || writes.length === 0 || (!sync.dataKey && !sync.conclusive)) return
  try {
    const dataKey = sync.dataKey ?? (await newDataKey(sync))
    const at = nowSeconds()
    for (const [i, write] of writes.entries()) {
      if (i % YIELD_EVERY === YIELD_EVERY - 1) await pause()
      const created_at = nextCreatedAt(at - Math.min(writes.length - 1 - i, SPREAD_SECONDS), write.replaces, at)
      if (created_at === null) {
        sync.problem = "clock"
        continue
      }
      const templates = sealRecord({ type: write.type, id: write.id, rev: write.rev, device: sync.meta.device, at }, write.data, dataKey.key, created_at)
      const signed: NostrEvent[] = []
      for (const template of templates) signed.push(await (await sync.sign()).signEvent(template))
      for (const event of signed) sync.deliveries.push({ event, relays: sync.targets })
      sync.pending--
      sync.copies[write.id] = {
        rev: write.rev,
        device: sync.meta.device,
        deleted: write.data === null,
        hash: write.hash,
        ids: signed.map((e) => e.id),
        createdAt: created_at,
        ...(write.type === "players" && write.data ? { data: write.data } : {}),
      }
    }
  } catch (error) {
    if (error instanceof SessionGone) throw error
    // What is signed so far goes out; the rest waits for the next sync.
    sync.problem = error instanceof DataKeyError ? error.problem : "signer"
  }
}

// 5. Heal: this device's current versions, again to each relay that answered without them.
function heal(sync: Sync) {
  const held = sync.answered.map((r) => ({ url: r.url, ids: new Set(r.events.map((e) => e.id)) }))
  const current = [...Object.values(sync.copies).flatMap((c) => c.ids.flatMap((id) => sync.events.get(id) ?? [])), ...(sync.dataKey ? [sync.dataKey.event] : [])]
  for (const event of current) {
    const lacking = held.filter((r) => !r.ids.has(event.id)).map((r) => r.url)
    if (lacking.length > 0) sync.deliveries.push({ event, relays: lacking })
  }
}
