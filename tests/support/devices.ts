import { IDBFactory } from "fake-indexeddb"
import { MemoryStorage } from "../storage-helpers.ts"
import { closeDatabase } from "../../lib/storage/db.ts"

// Several devices of one person in one Node process, for the sync tests: each has its own
// IndexedDB and localStorage, and the app runs on one of them at a time.

export interface Device {
  idb: IDBFactory
  local: MemoryStorage
}

export const newDevice = (): Device => ({ idb: new IDBFactory(), local: new MemoryStorage() })

// Makes `device` the one the app runs on: its database and localStorage, nothing of the previous.
export async function switchTo(device: Device) {
  await closeDatabase()
  Object.assign(globalThis, { indexedDB: device.idb })
  ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage = device.local
}
