import { useSyncExternalStore } from "react"

// Where the private history stands on this device, for the screens (Profil, Spiele, Erweitert).
// Light on purpose (no network, no nostr-core, no storage): the sync itself (./service.ts) loads
// on demand and reports here.

// "complete": every relay answered and every record could be read. "partial": some relays didn't
// answer or some records couldn't be read. "unavailable": nothing could be read or written.
export type SyncState = "complete" | "partial" | "unavailable"

// Why not complete: no relay answered ("offline"), the signer didn't answer or declined
// ("signer"), it can't decrypt ("unsupported", the Android signer), or the profile's data key
// doesn't open ("unreadable").
export type SyncProblem = "offline" | "signer" | "unsupported" | "unreadable"

export interface SyncStatus {
  // The profile it is about; null without one.
  pubkey: string | null
  running: boolean
  // How the last sync went; null before the first on this device.
  state: SyncState | null
  problem: SyncProblem | null
  // When relays last answered a sync (ms). Null: the profile's games from its other devices
  // haven't been looked for yet, so none here doesn't mean none at all.
  lastSync: number | null
  // When the copies on relays were last read back and checked (ms).
  lastCheck: number | null
}

const NOTHING: SyncStatus = { pubkey: null, running: false, state: null, problem: null, lastSync: null, lastCheck: null }

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
