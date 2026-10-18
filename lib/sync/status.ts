import { useSyncExternalStore } from "react"

// Where the private history stands on this device, for the screens (Profil, Spiele, Erweitert).
// Light on purpose (no network, no nostr-core, no storage): the sync itself (./service.ts) loads
// on demand and reports here.

// "complete": every relay answered and every record could be read. "partial": some relays didn't
// answer, some records couldn't be read, or some changes couldn't be written. "unavailable":
// nothing could be read or written.
export type SyncState = "complete" | "partial" | "unavailable"

// Why not complete: no relay answered ("offline"), not every relay did ("relays"), the signer
// didn't answer or declined ("signer"), it can't decrypt ("unsupported", the Android signer), the
// profile's data key doesn't open ("key"), some records don't ("records"), or this device's clock
// is too far behind to write versions relays would keep ("clock").
export type SyncProblem = "offline" | "relays" | "signer" | "unsupported" | "key" | "records" | "clock"

export interface SyncStatus {
  // The profile it is about; null without one.
  pubkey: string | null
  running: boolean
  // When the last sync in this tab ended (ms), whatever came of it; null before the first.
  endedAt: number | null
  // How the last sync went; null before the first on this device.
  state: SyncState | null
  problem: SyncProblem | null
  // When relays last answered a sync (ms). Null: the profile's games from its other devices
  // haven't been looked for yet, so none here doesn't mean none at all.
  lastSync: number | null
  // When the copies on relays were last read back and checked (ms).
  lastCheck: number | null
  // Records changed here that the last sync left unwritten (it only read, or couldn't write
  // them); they go out with the next sync that writes.
  pending: number
}

const NOTHING: SyncStatus = { pubkey: null, running: false, endedAt: null, state: null, problem: null, lastSync: null, lastCheck: null, pending: 0 }

let status = NOTHING
const listeners = new Set<() => void>()

export const getSyncStatus = () => status

export function setSyncStatus(change: Partial<SyncStatus> | null) {
  status = change === null ? NOTHING : { ...status, ...change }
  for (const listener of listeners) listener()
}

export function subscribeSyncStatus(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, () => NOTHING)
}
