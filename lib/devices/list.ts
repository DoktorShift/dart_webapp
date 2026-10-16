import { query } from "../nostr/client.ts"
import { nowSeconds } from "../nostr/time.ts"
import { ownEvents, ownRelaySettings } from "../profile/own-events.ts"
import { publishTargets } from "../profile/relay-list.ts"
import { getSigner } from "../profile/session.ts"
import { KIND_PRIVATE } from "../protocol/kinds.ts"
import { recordSlot } from "../protocol/private.ts"
import { backupStatus, updateBackupStatus } from "../recovery/status.ts"
import { kvGet, kvSet } from "../storage/db.ts"
import { storedDataKey, type DataKey } from "../sync/data-key.ts"
import { syncMeta } from "../sync/engine.ts"
import { deliverNow, enqueue } from "../sync/outbox.ts"
import { compareVersions, nextCreatedAt, openRecords, sealRecord } from "../sync/records.ts"
import { MAX_DEVICE_NAME } from "./device-name.ts"

// Profil › Geräte: the profile's devices, as a private record on its relays
// (docs/protocol/families/private-records.md, type "devices"). It is a list the person keeps,
// nothing more (decision 0002 §10): a device that has the key keeps the key, whatever the list
// says. Each device writes itself in once it has the profile (after a pairing or a restore,
// the first device when it first opens the list), under the id it syncs with
// (lib/sync/engine.ts), so "this device" is the same device the sync knows. The newest version
// wins; this device keeps its last copy in kv "profile.devices", which goes with the profile.
//
// The record also notes when a backup file of the profile was last saved, on whatever device:
// a device that gets the profile learns so (lib/recovery/status.ts) instead of asking for a
// backup that exists.

export const DEVICES_RECORD = "devices"
const KEY = "profile.devices"

export interface DeviceEntry {
  id: string
  name: string
  // When it was added (unix seconds).
  added: number
}

// When a backup file was last saved (ms), on any device.
interface BackupMark {
  file: { at: number } | null
}

interface StoredList {
  pubkey: string
  rev: number
  device: string
  entries: DeviceEntry[]
  backup: BackupMark
  createdAt: number
  // Whether this device wrote itself into the list; once it did, a removal elsewhere stands.
  listed: boolean
}

// Whether the relays were read: every one, some, or none (then the entries are this device's
// last copy, maybe stale).
export type ListState = "complete" | "partial" | "unavailable"

export interface DeviceList {
  entries: DeviceEntry[]
  thisDevice: string
  state: ListState
  // False while the list can't be kept on relays: the profile has no data key here yet (nothing
  // was synced so far, or the signer can't decrypt).
  available: boolean
}

export type DeviceListProblem = "no-key" | "clock" | "signer"

export class DeviceListError extends Error {
  problem: DeviceListProblem
  constructor(problem: DeviceListProblem, message: string) {
    super(message)
    this.name = "DeviceListError"
    this.problem = problem
  }
}

const HEX_ID = /^[0-9a-f]{16}$/

async function local(pubkey: string): Promise<StoredList | null> {
  const stored = await kvGet<StoredList>(KEY)
  return stored?.pubkey === pubkey ? stored : null
}

// The entries of a record's data, those that have the shape; the rest is left out.
function entriesOf(data: Record<string, unknown> | null): DeviceEntry[] {
  const devices = (data as { devices?: unknown } | null)?.devices
  if (!Array.isArray(devices)) return []
  return devices.flatMap((d: Partial<DeviceEntry>) =>
    typeof d?.id === "string" && HEX_ID.test(d.id) && typeof d.name === "string" && d.name.trim() !== "" && Number.isInteger(d.added)
      ? [{ id: d.id, name: d.name.slice(0, MAX_DEVICE_NAME), added: d.added as number }]
      : [],
  )
}

const backupOf = (data: Record<string, unknown> | null): BackupMark => {
  const at = (data as { backup?: { file?: { at?: unknown } } } | null)?.backup?.file?.at
  return { file: Number.isInteger(at) ? { at: at as number } : null }
}

const targetsOf = async (pubkey: string) => publishTargets(KIND_PRIVATE, ownRelaySettings(await ownEvents(pubkey)))

// Takes the newest version the relays hold over this device's copy.
async function refresh(pubkey: string, dataKey: DataKey, copy: StoredList | null): Promise<{ current: StoredList | null; state: ListState }> {
  const result = await query([{ kinds: [KIND_PRIVATE], authors: [pubkey], "#d": [recordSlot(dataKey.key, DEVICES_RECORD)] }], await targetsOf(pubkey))
  const state: ListState = result.answered.length === 0 ? "unavailable" : result.failed.length === 0 ? "complete" : "partial"
  const version = openRecords(result.events, dataKey.key, pubkey).versions.get(DEVICES_RECORD)
  if (!version || (copy && compareVersions(version.record, copy) <= 0)) return { current: copy, state }
  const current: StoredList = { pubkey, rev: version.record.rev, device: version.record.device, entries: entriesOf(version.data), backup: backupOf(version.data), createdAt: version.events[0].created_at, listed: copy?.listed ?? false }
  await kvSet(KEY, current)
  // A backup file saved on another device counts for the profile.
  const known = (await backupStatus(pubkey)).file
  if (current.backup.file && (!known || known.at < current.backup.file.at)) await updateBackupStatus(pubkey, { file: current.backup.file })
  return { current, state }
}

export async function loadDeviceList(pubkey: string): Promise<DeviceList> {
  const [meta, copy, dataKey] = await Promise.all([syncMeta(pubkey), local(pubkey), storedDataKey(pubkey)])
  if (!dataKey) return { entries: copy?.entries ?? [], thisDevice: meta.device, state: "unavailable", available: false }
  const { current, state } = await refresh(pubkey, dataKey, copy)
  return { entries: current?.entries ?? [], thisDevice: meta.device, state, available: true }
}

// Writes the list as a new version above this device's copy, signed by the profile, and hands
// it to the outbox (lib/sync/outbox.ts): sent now, and again until relays have it.
async function write(pubkey: string, entries: DeviceEntry[], listed: boolean, backup?: BackupMark) {
  const [meta, copy, dataKey] = await Promise.all([syncMeta(pubkey), local(pubkey), storedDataKey(pubkey)])
  backup ??= copy?.backup ?? { file: null }
  if (!dataKey) throw new DeviceListError("no-key", "the profile has no data key on this device yet")
  const at = nowSeconds()
  const created_at = nextCreatedAt(at, copy?.createdAt ?? 0, at)
  if (created_at === null) throw new DeviceListError("clock", "this device's clock is behind the version on the relays")
  const rev = (copy?.rev ?? 0) + 1
  const templates = sealRecord({ type: DEVICES_RECORD, id: DEVICES_RECORD, rev, device: meta.device, at }, { devices: entries, backup }, dataKey.key, created_at)
  const events = []
  try {
    const signer = await getSigner()
    for (const template of templates) events.push(await signer.signEvent(template))
  } catch (error) {
    throw new DeviceListError("signer", error instanceof Error ? error.message : String(error))
  }
  const targets = await targetsOf(pubkey)
  await kvSet(KEY, { pubkey, rev, device: meta.device, entries, backup, createdAt: created_at, listed } satisfies StoredList)
  await enqueue(events.map((event) => ({ event, relays: targets })), { coalesce: true })
  await deliverNow(events.map((event) => event.id))
}

// Puts this device into the list, once: after it got the profile, or when the first device
// opens the list. A device the person removed elsewhere doesn't put itself back.
export async function addThisDevice(pubkey: string, name: string) {
  const copy = await local(pubkey)
  if (copy?.listed) return
  const list = await loadDeviceList(pubkey)
  if (!list.available) throw new DeviceListError("no-key", "the profile has no data key on this device yet")
  const entries = list.entries.some((d) => d.id === list.thisDevice) ? list.entries : [...list.entries, { id: list.thisDevice, name: name.slice(0, MAX_DEVICE_NAME), added: nowSeconds() }]
  await write(pubkey, entries, true)
}

export async function renameDevice(pubkey: string, id: string, name: string) {
  const trimmed = name.trim().slice(0, MAX_DEVICE_NAME)
  if (!trimmed) return
  const copy = await local(pubkey)
  await write(
    pubkey,
    (copy?.entries ?? []).map((d) => (d.id === id ? { ...d, name: trimmed } : d)),
    copy?.listed ?? false,
  )
}

// A backup file was saved here: noted for the profile's other devices.
export async function noteBackupFile(pubkey: string, at: number) {
  const copy = await local(pubkey)
  await write(pubkey, copy?.entries ?? [], copy?.listed ?? false, { file: { at } })
}

export async function removeDevice(pubkey: string, id: string) {
  const copy = await local(pubkey)
  await write(
    pubkey,
    (copy?.entries ?? []).filter((d) => d.id !== id),
    copy?.listed ?? false,
  )
}
