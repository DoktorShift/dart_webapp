import { query } from "../nostr/client.ts"
import { nowSeconds } from "../nostr/time.ts"
import { ownEvents, ownRelaySettings } from "../profile/own-events.ts"
import { publishTargets } from "../profile/relay-list.ts"
import { getSigner } from "../profile/session.ts"
import { KIND_PRIVATE, MAX_HANDSHAKE_SECONDS } from "../protocol/kinds.ts"
import { recordSlot } from "../protocol/private.ts"
import { backupStatus, updateBackupStatus, type BackupStatus } from "../recovery/status.ts"
import { kvGet, kvSet } from "../storage/db.ts"
import { storedDataKey, type DataKey } from "../sync/data-key.ts"
import { syncMeta } from "../sync/engine.ts"
import { deliverNow, enqueue } from "../sync/outbox.ts"
import { compareVersions, nextCreatedAt, openRecords, sealRecord } from "../sync/records.ts"
import { MAX_DEVICE_NAME } from "./device-name.ts"

// Profil › Geräte: the profile's devices, as a private record on its relays
// (docs/protocol/families/private-records.md, type "devices"). It is a list the person keeps,
// nothing more (decision 0002 §10): a device that has the key keeps the key, whatever the list
// says. Each device writes itself in once it has the profile and synced (after any sync,
// components/devices/register.ts; with a signer app, when Profil › Geräte opens), under the id
// it syncs with (lib/sync/engine.ts), so "this device" is the same device the sync knows. The
// newest version wins, so every change is made on the version the relays hold now; this device
// keeps its last copy in kv "profile.devices", which goes with the profile.
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
type BackupMark = Pick<BackupStatus, "file">

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
  // False while the list can't be kept on relays: the profile has no data key here yet, or this
  // device hasn't synced once (nothing was synced so far, or the signer can't decrypt).
  available: boolean
  // Devices this one just gave the profile to that aren't in the list yet.
  arriving: Pick<DeviceEntry, "id" | "name">[]
}

// "offline": no relay answered, so the list can't be read before it is changed.
export type DeviceListProblem = "no-key" | "offline" | "clock" | "signer"

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

// What the list needs on this device: the data key it is sealed with, and this device's id,
// which the sync fixes on its first run (until then it isn't kept). null before both.
async function ready(pubkey: string): Promise<{ device: string; dataKey: DataKey } | null> {
  const [meta, dataKey] = await Promise.all([syncMeta(pubkey), storedDataKey(pubkey)])
  return dataKey && meta.state !== null ? { device: meta.device, dataKey } : null
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

// The later of two backup marks.
const newest = (a: BackupMark["file"], b: BackupMark["file"]): BackupMark => ({ file: !a || (b && b.at > a.at) ? b : a })

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
  const [meta, copy, here] = await Promise.all([syncMeta(pubkey), local(pubkey), ready(pubkey)])
  if (!here) return { entries: copy?.entries ?? [], thisDevice: meta.device, state: "unavailable", available: false, arriving: [] }
  const { current, state } = await refresh(pubkey, here.dataKey, copy)
  const entries = current?.entries ?? []
  return { entries, thisDevice: here.device, state, available: true, arriving: stillArriving(pubkey, entries) }
}

interface Entries {
  entries: DeviceEntry[]
  listed: boolean
}

// Changes the list as the relays hold it now: read first, the change made on the newest
// version, signed by the profile and handed to the outbox (lib/sync/outbox.ts), sent now and
// again until relays have it. Nothing is written while no relay answers: a list made from this
// device's copy alone would replace a newer one, and a device added elsewhere would drop out.
// The newest backup mark known here goes along.
async function change(pubkey: string, edit: (list: Entries & { thisDevice: string }) => Entries) {
  const here = await ready(pubkey)
  if (!here) throw new DeviceListError("no-key", "the profile has no data key or no device id here yet")
  const { current, state } = await refresh(pubkey, here.dataKey, await local(pubkey))
  if (state === "unavailable") throw new DeviceListError("offline", "no relay answered, so the list can't be read first")
  const { entries, listed } = edit({ entries: current?.entries ?? [], listed: current?.listed ?? false, thisDevice: here.device })
  const backup = newest(current?.backup.file ?? null, (await backupStatus(pubkey)).file)
  const at = nowSeconds()
  const created_at = nextCreatedAt(at, current?.createdAt ?? 0, at)
  if (created_at === null) throw new DeviceListError("clock", "this device's clock is behind the version on the relays")
  const rev = (current?.rev ?? 0) + 1
  const templates = sealRecord({ type: DEVICES_RECORD, id: DEVICES_RECORD, rev, device: here.device, at }, { devices: entries, backup }, here.dataKey.key, created_at)
  const events = []
  try {
    const signer = await getSigner()
    for (const template of templates) events.push(await signer.signEvent(template))
  } catch (error) {
    throw new DeviceListError("signer", error instanceof Error ? error.message : String(error))
  }
  const targets = await targetsOf(pubkey)
  await kvSet(KEY, { pubkey, rev, device: here.device, entries, backup, createdAt: created_at, listed } satisfies StoredList)
  await enqueue(events.map((event) => ({ event, relays: targets })), { coalesce: true })
  await deliverNow(events.map((event) => event.id))
}

// Puts this device into the list, once: after it got the profile, or when the first device
// opens the list. A device the person removed elsewhere doesn't put itself back.
export async function addThisDevice(pubkey: string, name: string) {
  if ((await local(pubkey))?.listed) return
  await change(pubkey, ({ entries, thisDevice }) => ({
    entries: entries.some((d) => d.id === thisDevice) ? entries : [...entries, { id: thisDevice, name: name.slice(0, MAX_DEVICE_NAME), added: nowSeconds() }],
    listed: true,
  }))
}

export async function renameDevice(pubkey: string, id: string, name: string) {
  const trimmed = name.trim().slice(0, MAX_DEVICE_NAME)
  if (!trimmed) return
  await change(pubkey, ({ entries, listed }) => ({ entries: entries.map((d) => (d.id === id ? { ...d, name: trimmed } : d)), listed }))
}

// A backup file was saved here (lib/recovery/status.ts knows already): noted in the list for
// the profile's other devices.
export async function noteBackupFile(pubkey: string) {
  await change(pubkey, ({ entries, listed }) => ({ entries, listed }))
}

export async function removeDevice(pubkey: string, id: string) {
  await change(pubkey, ({ entries, listed }) => ({ entries: entries.filter((d) => d.id !== id), listed }))
}

// ---- Devices on their way ----------------------------------------------------------------------

// A device this one just gave the profile to (./pairing.ts) writes itself into the list once the
// profile arrived there and it synced, which takes a moment, under the id the pairing gave it.
// Until that entry shows, the list names it from here, for as long as a pairing may take. Kept in
// memory only: the list on the relays is what lasts.
const arriving: { pubkey: string; id: string; name: string; at: number }[] = []
const arrivalListeners = new Set<() => void>()

export function deviceAdded(pubkey: string, id: string, name: string) {
  arriving.push({ pubkey, id, name, at: nowSeconds() })
  for (const listener of arrivalListeners) listener()
}

export function onDeviceAdded(listener: () => void): () => void {
  arrivalListeners.add(listener)
  return () => arrivalListeners.delete(listener)
}

// The arriving devices of this profile not in `entries` yet; the ones that are, or that took
// longer than a pairing may, are forgotten.
function stillArriving(pubkey: string, entries: readonly DeviceEntry[]): DeviceList["arriving"] {
  const gone = (a: (typeof arriving)[number]) => entries.some((d) => d.id === a.id) || a.at + MAX_HANDSHAKE_SECONDS < nowSeconds()
  for (let i = arriving.length - 1; i >= 0; i--) if (arriving[i].pubkey === pubkey && gone(arriving[i])) arriving.splice(i, 1)
  return arriving.filter((a) => a.pubkey === pubkey).map(({ id, name }) => ({ id, name }))
}
