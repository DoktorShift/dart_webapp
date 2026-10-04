import "fake-indexeddb/auto"
import { IDBFactory } from "fake-indexeddb"
import { replay } from "../lib/game/engine.ts"
import type { MatchConfig, SavedMatch, Throw } from "../lib/game/types.ts"
import { closeDatabase } from "../lib/storage/db.ts"
import { resetSaveState } from "../lib/storage/save-status.ts"

// The browser parts the storage code uses, for Node: IndexedDB (fake-indexeddb) and a
// localStorage that can be made to fail like a full disk.

export class MemoryStorage {
  private data = new Map<string, string>()
  // Every write throws QuotaExceededError, as a full or blocked storage does.
  failWrites = false

  get length() {
    return this.data.size
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
    this.data.set(key, String(value))
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  clear() {
    this.data.clear()
  }
}

export const localStore = new MemoryStorage()

Object.assign(globalThis, {
  window: {
    localStorage: localStore,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  },
})

// A fresh, empty device: new database, empty localStorage, no remembered save problems.
export async function resetStorage() {
  await closeDatabase()
  Object.assign(globalThis, { indexedDB: new IDBFactory() })
  localStore.clear()
  localStore.failWrites = false
  resetSaveState()
}

export const ANNA = `pl_${"a".repeat(32)}`
export const BEN = `pl_${"b".repeat(32)}`

export const saved = (config: MatchConfig, throws: Throw[], id: string): SavedMatch => ({
  id,
  config,
  throws,
  startedAt: "2026-10-01T18:00:00.000Z",
  acknowledgedLegs: replay(config, throws).legResults.length,
  status: "playing",
})

export const at = (iso: string) => new Date(iso)
