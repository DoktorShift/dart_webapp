import { nowSeconds } from "../nostr/time.ts"
import { MAX_HANDSHAKE_SECONDS } from "../protocol/kinds.ts"
import { backupStatus, updateBackupStatus, type BackupStatus } from "../recovery/status.ts"
import { smallRecord, SmallRecordError, type RecordState } from "../sync/small-record.ts"
import { MAX_DEVICE_NAME } from "./device-name.ts"

// Profil › Geräte: the profile's devices, as a private record on its relays
// (docs/protocol/families/private-records.md, type "devices"; kept by lib/sync/small-record.ts,
// newest version wins). It is a list the person keeps, nothing more (decision 0002 §10): a
// device that has the key keeps the key, whatever the list says. Each device writes itself in
// once it has the profile and synced (after any sync, components/devices/register.ts; with a
// signer app, when Profil › Geräte opens), under the id it syncs with (lib/sync/engine.ts), so
// "this device" is the same device the sync knows. This device keeps its last copy in kv
// "profile.devices", which goes with the profile.
//
// The record also notes when a backup file of the profile was last saved, on whatever device:
// a device that gets the profile learns so (lib/recovery/status.ts) instead of asking for a
// backup that exists.

export const DEVICES_RECORD = "devices"

export interface DeviceEntry {
  id: string
  name: string
  // When it was added (unix seconds).
  added: number
}

// When a backup file was last saved (ms), on any device.
type BackupMark = Pick<BackupStatus, "file">

interface Value {
  entries: DeviceEntry[]
  backup: BackupMark
}

// Whether this device wrote itself into the list; once it did, a removal elsewhere stands.
interface Local {
  listed: boolean
}

export type ListState = RecordState

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

export type DeviceListProblem = SmallRecordError["problem"]

export class DeviceListError extends Error {
  problem: DeviceListProblem
  constructor(problem: DeviceListProblem, message: string) {
    super(message)
    this.name = "DeviceListError"
    this.problem = problem
  }
}

const HEX_ID = /^[0-9a-f]{16}$/

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

const record = smallRecord<Value, Local>({
  id: DEVICES_RECORD,
  key: "profile.devices",
  read: (data) => ({ entries: entriesOf(data), backup: backupOf(data) }),
  write: ({ entries, backup }) => ({ devices: entries, backup }),
  emptyLocal: { listed: false },
  // The copy as the first version of this module kept it: the value's fields beside the head.
  upgrade: (stored) =>
    typeof stored.rev === "number" && typeof stored.device === "string" && typeof stored.createdAt === "number"
      ? { pubkey: stored.pubkey as string, rev: stored.rev, device: stored.device, createdAt: stored.createdAt, value: { entries: entriesOf({ devices: stored.entries }), backup: stored.backup as BackupMark }, local: { listed: stored.listed === true } }
      : null,
})

// A backup file saved on another device counts for the profile.
async function learnBackup(pubkey: string, value: Value | null) {
  const known = (await backupStatus(pubkey)).file
  if (value?.backup.file && (!known || known.at < value.backup.file.at)) await updateBackupStatus(pubkey, { file: value.backup.file })
}

export async function loadDeviceList(pubkey: string): Promise<DeviceList> {
  const loaded = await record.load(pubkey)
  await learnBackup(pubkey, loaded.value)
  const entries = loaded.value?.entries ?? []
  return { entries, thisDevice: loaded.thisDevice, state: loaded.state, available: loaded.available, arriving: stillArriving(pubkey, entries) }
}

// Changes the list on the version the relays hold now (lib/sync/small-record.ts); the newest
// backup mark known here goes along.
async function change(pubkey: string, edit: (list: { entries: DeviceEntry[]; listed: boolean; thisDevice: string }) => { entries: DeviceEntry[]; listed: boolean }) {
  try {
    await record.change(pubkey, async ({ value, local, thisDevice }) => {
      await learnBackup(pubkey, value)
      const { entries, listed } = edit({ entries: value?.entries ?? [], listed: local.listed, thisDevice })
      const backup = newest(value?.backup.file ?? null, (await backupStatus(pubkey)).file)
      return { value: { entries, backup }, local: { listed } }
    })
  } catch (error) {
    throw error instanceof SmallRecordError ? new DeviceListError(error.problem, error.message) : error
  }
}

// Puts this device into the list, once: after it got the profile, or when the first device
// opens the list. A device the person removed elsewhere doesn't put itself back.
export async function addThisDevice(pubkey: string, name: string) {
  if ((await record.copy(pubkey))?.local.listed) return
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
