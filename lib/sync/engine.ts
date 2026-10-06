import { query } from "../nostr/client.ts"
import { countOperators } from "../nostr/relays.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { Filter, NostrEvent, Signer } from "../nostr/types.ts"
import { fetchOwnEvents, ownEvents, ownRelaySettings } from "../profile/own-events.ts"
import { publishTargets } from "../profile/relay-list.ts"
import { getSigner } from "../profile/session.ts"
import { KIND_PRIVATE } from "../protocol/kinds.ts"
import { dataKeySlot } from "../protocol/private.ts"
import { applySynced, type ArchivedMatch } from "../storage/archive.ts"
import { dbGetAll, kvGet, kvSet } from "../storage/db.ts"
import { randomHex } from "../storage/ids.ts"
import { listPlayers } from "../storage/players.ts"
import { createDataKey, DataKeyError, keepDataKey, settleDataKey, storedDataKey, unwrapDataKey } from "./data-key.ts"
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
  type RecordType,
  type Version,
} from "./history.ts"
import { enqueue, outboxStatus, type Delivery } from "./outbox.ts"
import { compareVersions, openRecords, sealRecord, type OpenedRecords } from "./records.ts"
import type { SyncProblem, SyncState } from "./status.ts"

// One sync of the signed-in profile's private history with its relays (P3b.01, P3b.02):
//
// 1. Read the profile's kind-30078 events from each relay, page by page: all of them ("full"), or
//    only those since the last sync with some overlap. A relay that doesn't answer is unknown,
//    never empty.
// 2. The data key: kept here, or unwrapped from relays once, or made on first use (only once
//    relays of two operators, or all of them, said there is none). Two keys: ./data-key.ts.
// 3. Take what changed elsewhere into the archive and the player directory (./history.ts decides
//    per record), then write what changed here as new versions: sealed, signed one after another,
//    handed to the outbox. Their created_at are spread over the last minutes, so paging by
//    created_at (step 1) never meets more events of one second than a relay sends at once.
// 4. A full sync also heals: every relay that answered but lacks this device's current version
//    of a record gets it again; a version no relay has any more is written anew.
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
}

// The version of a record this device last wrote or took, with the ids of its events. The
// players record keeps its data too: the base of the next merge when relays bring nothing newer.
interface Copy extends Version {
  ids: string[]
  createdAt: number
  data?: Record<string, unknown>
}

type Copies = Record<string, Copy>

export interface SyncResult {
  state: SyncState
  problem: SyncProblem | null
  lastSync: number | null
  lastCheck: number | null
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0))

export async function syncMeta(pubkey: string): Promise<Meta> {
  const stored = await kvGet<Meta>(META_ID)
  if (stored?.pubkey === pubkey) return stored
  return { pubkey, device: randomHex(8), lastSync: null, lastCheck: null, state: null, problem: null }
}

async function loadCopies(pubkey: string): Promise<Copies> {
  const stored = await kvGet<{ pubkey: string; copies: Copies }>(COPIES_ID)
  return stored?.pubkey === pubkey ? stored.copies : {}
}

// ---- Reading relays ---------------------------------------------------------------------------

// Every event matching the filter on one relay, newest pages first; null when it didn't answer.
async function readRelay(url: string, filter: Filter): Promise<NostrEvent[] | null> {
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
  return [...found.values()]
}

// ---- One sync ---------------------------------------------------------------------------------

interface Write {
  id: string
  type: RecordType
  data: Record<string, unknown> | null
  hash: string
  rev: number
  replaces: number
}

const newestFirst = (a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)

export async function syncHistory(pubkey: string, options: { full: boolean }, now = Date.now): Promise<SyncResult> {
  const meta = await syncMeta(pubkey)
  let copies = await loadCopies(pubkey)
  let dataKey = await storedDataKey(pubkey)
  const full = options.full || meta.lastSync === null || dataKey === null
  let signer: Promise<Signer> | null = null
  const sign = () => (signer ??= getSigner())
  const finish = async (state: SyncState, problem: SyncProblem | null, read: boolean): Promise<SyncResult> => {
    const at = now()
    const next: Meta = { ...meta, state, problem, lastSync: read ? at : meta.lastSync, lastCheck: read && full ? at : meta.lastCheck }
    await kvSet(META_ID, next)
    return { state, problem, lastSync: next.lastSync, lastCheck: next.lastCheck }
  }

  // 1. Read.
  if (full) await fetchOwnEvents(pubkey).catch(() => null)
  const targets = publishTargets(KIND_PRIVATE, ownRelaySettings(await ownEvents(pubkey)))
  const since = full || meta.lastSync === null ? undefined : Math.floor(meta.lastSync / 1000) - OVERLAP_SECONDS
  const reads = await Promise.all(targets.map(async (url) => ({ url, events: await readRelay(url, { kinds: [KIND_PRIVATE], authors: [pubkey], ...(since ? { since } : {}) }) })))
  const answered = reads.filter((r): r is { url: string; events: NostrEvent[] } => r.events !== null)
  if (answered.length === 0) return finish("unavailable", "offline", false)
  const events = new Map(answered.flatMap((r) => r.events.map((e) => [e.id, e] as const)))
  // Enough answers to say "there is none": every relay, or relays of two operators.
  const conclusive = answered.length === targets.length || countOperators(answered.map((r) => r.url)) >= 2
  const deliveries: Delivery[] = []

  // 2. The data key.
  const keySlot = dataKeySlot(pubkey)
  const keyEvent = [...events.values()].filter((e) => e.tags[0]?.[1] === keySlot).sort(newestFirst)[0]
  try {
    if (!dataKey && keyEvent) {
      dataKey = await unwrapDataKey(keyEvent, await sign())
      await keepDataKey(pubkey, dataKey)
    } else if (dataKey && keyEvent) {
      const settled = await settleDataKey(dataKey, keyEvent, sign)
      if (settled.dataKey.event.id !== dataKey.event.id) await keepDataKey(pubkey, settled.dataKey)
      // Another key won: every record is sealed anew under it.
      if (settled.outcome === "adopted") copies = {}
      if (settled.outcome === "kept") deliveries.push({ event: settled.dataKey.event, relays: targets })
      dataKey = settled.dataKey
    }
  } catch (error) {
    if (error instanceof DataKeyError) return finish("unavailable", error.problem, false)
    return finish("unavailable", "signer", false)
  }

  // 3a. Take what changed elsewhere.
  const opened: OpenedRecords = dataKey ? openRecords([...events.values()], dataKey.key, pubkey) : { versions: new Map(), unreadable: 0 }
  let unreadable = opened.unreadable
  let [matches, directory] = await Promise.all([dbGetAll<ArchivedMatch>("matches"), listPlayers()])
  let local = profileRecords(pubkey, matches, directory)
  const remote = new Map<string, Version & { ids: string[]; createdAt: number; match: ArchivedMatch | null }>()
  const put: ArchivedMatch[] = []
  const remove: string[] = []
  let count = 0
  for (const [id, version] of opened.versions) {
    if (!isMatchRecord(id)) continue
    if (++count % YIELD_EVERY === 0) await pause()
    const match = version.data ? matchFromData(version.data) : null
    if (version.data && !match) {
      unreadable++
      continue
    }
    const { rev, device } = version.record
    const found = { rev, device, deleted: !match, hash: match ? hashOf(matchData(match)) : "", ids: version.events.map((e) => e.id), createdAt: version.events[0].created_at, match }
    remote.set(id, found)
    const here = local.get(id)
    if (decideMatch(here, copies[id], { ...found, source: match?.source }) !== "take") continue
    if (match && here?.hash !== found.hash) put.push(match)
    else if (!match && here) remove.push(here.data.id as string)
    copies[id] = { rev, device, deleted: found.deleted, hash: found.hash, ids: found.ids, createdAt: found.createdAt }
  }

  // The players record: entries found on relays (or as last synced) merged with this device's.
  const playersVersion = opened.versions.get(PLAYERS_RECORD)
  const playersCopy = copies[PLAYERS_RECORD]
  const playersNewer = playersVersion && !playersVersion.record.deleted && (!playersCopy || compareVersions(playersVersion.record, playersCopy) > 0)
  if (playersNewer) {
    const data = playersData(playersFromData(playersVersion.data ?? {}))
    copies[PLAYERS_RECORD] = { rev: playersVersion.record.rev, device: playersVersion.record.device, deleted: false, hash: hashOf(data), ids: playersVersion.events.map((e) => e.id), createdAt: playersVersion.events[0].created_at, data }
  }
  const base = copies[PLAYERS_RECORD]
  const merged = mergePlayers(playersFromData(base?.data ?? {}), playersFromData(local.get(PLAYERS_RECORD)?.data ?? {}))
  const byId = new Map(directory.map((p) => [p.id, p]))
  const players = merged.filter((p) => !sameContent(p, byId.get(p.id)))

  if (put.length > 0 || remove.length > 0 || players.length > 0) {
    await applySynced({ put, remove, players })
    ;[matches, directory] = await Promise.all([dbGetAll<ArchivedMatch>("matches"), listPlayers()])
    local = profileRecords(pubkey, matches, directory)
  }

  // 3b. Write what changed here.
  const writes: Write[] = []
  const latest = (id: string) => Math.max(copies[id]?.createdAt ?? 0, remote.get(id)?.createdAt ?? 0)
  const nextRev = (id: string) => Math.max(copies[id]?.rev ?? 0, remote.get(id)?.rev ?? 0, id === PLAYERS_RECORD ? (playersVersion?.record.rev ?? 0) : 0) + 1
  // A version no relay that answered holds, and the outbox doesn't either, is lost: written anew.
  const waiting = full ? new Set((await outboxStatus()).map((s) => s.id)) : new Set<string>()
  const lost = (copy: Copy) => full && conclusive && !copy.ids.some((id) => events.has(id) || waiting.has(id))
  for (const id of new Set([...local.keys(), ...Object.keys(copies)])) {
    if (!isMatchRecord(id)) continue
    const here = local.get(id)
    const copy = copies[id]
    const found = remote.get(id)
    const decision = decideMatch(here, copy, found && { ...found, source: found.match?.source })
    // A lost deletion is written again as a deletion, whatever came back here meanwhile.
    const data = decision === "write" ? (here ?? null) : copy && lost(copy) ? (copy.deleted ? null : here) : undefined
    if (data !== undefined) writes.push({ id, type: "match", data: data?.data ?? null, hash: data?.hash ?? "", rev: nextRev(id), replaces: latest(id) })
  }
  const mergedData = playersData(merged)
  const mergedHash = hashOf(mergedData)
  if (merged.length > 0 && (!base || base.hash !== mergedHash || lost(base)))
    writes.push({ id: PLAYERS_RECORD, type: "players", data: mergedData, hash: mergedHash, rev: nextRev(PLAYERS_RECORD), replaces: latest(PLAYERS_RECORD) })

  let problem: SyncProblem | null = null
  if (writes.length > 0 && !dataKey && !conclusive) problem = "offline"
  else if (writes.length > 0) {
    try {
      if (!dataKey) {
        dataKey = await createDataKey(await sign())
        await keepDataKey(pubkey, dataKey)
        deliveries.push({ event: dataKey.event, relays: targets })
      }
      const at = nowSeconds()
      for (const [i, write] of writes.entries()) {
        if (i % YIELD_EVERY === YIELD_EVERY - 1) await pause()
        const created_at = Math.min(Math.max(at - Math.min(writes.length - 1 - i, SPREAD_SECONDS), write.replaces + 1), at + SPREAD_SECONDS)
        const templates = sealRecord({ type: write.type, id: write.id, rev: write.rev, device: meta.device, at }, write.data, dataKey.key, created_at)
        const signed: NostrEvent[] = []
        for (const template of templates) signed.push(await (await sign()).signEvent(template))
        for (const event of signed) deliveries.push({ event, relays: targets })
        copies[write.id] = {
          rev: write.rev,
          device: meta.device,
          deleted: write.data === null,
          hash: write.hash,
          ids: signed.map((e) => e.id),
          createdAt: created_at,
          ...(write.type === "players" && write.data ? { data: write.data } : {}),
        }
      }
    } catch (error) {
      // What is signed so far goes out; the rest waits for the next sync.
      problem = error instanceof DataKeyError ? error.problem : "signer"
    }
  }

  // 4. Heal: this device's current versions, again to each relay that answered without them.
  if (full) {
    const held = answered.map((r) => ({ url: r.url, ids: new Set(r.events.map((e) => e.id)) }))
    const current = [...Object.values(copies).flatMap((c) => c.ids.flatMap((id) => events.get(id) ?? [])), ...(dataKey ? [dataKey.event] : [])]
    for (const event of current) {
      const lacking = held.filter((r) => !r.ids.has(event.id)).map((r) => r.url)
      if (lacking.length > 0) deliveries.push({ event, relays: lacking })
    }
  }

  await enqueue(deliveries, { coalesce: true })
  await kvSet(COPIES_ID, { pubkey, copies })
  const partial = answered.length < targets.length || unreadable > 0 || problem !== null
  return finish(partial ? "partial" : "complete", problem ?? (unreadable > 0 ? "unreadable" : answered.length < targets.length ? "offline" : null), true)
}
