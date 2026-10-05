// The app's database in the browser: IndexedDB "blueline". Kept small and generic: every store
// holds plain objects keyed by their `id`, and a write is one transaction across the stores it
// touches. Nothing opens until the first call, so starting the app costs nothing.
//
// Where IndexedDB can't be used (storage switched off, some private windows) the same calls work
// on memory for as long as the page stays open, and isStorageUnavailable() says so, so a screen
// can tell the players honestly. A database that is only slow to open is not given up on: the
// calls that can't wait fail (a write then says so), and later calls use it once it is open.
//
// Other tabs hear about every write through BroadcastChannel("blueline"), so open screens stay
// in step (localStorage's "storage" event doesn't exist for IndexedDB).

export const DB_NAME = "blueline"
export const DB_VERSION = 1
export const STORES = ["matches", "players", "kv", "outbox", "payments", "objects", "pending"] as const
export type StoreName = (typeof STORES)[number]

export interface Keyed {
  id: string
}

// "putNew" stores a value only if nothing with its id is there yet, checked inside the same
// transaction, so a write from another tab in between is never overwritten.
export type WriteOp =
  | { store: StoreName; put: Keyed }
  | { store: StoreName; putNew: Keyed }
  | { store: StoreName; delete: string }
  | { store: StoreName; clear: true }

// "change": these stores were written. "wipe": all data on this device was deleted.
export type StorageMessage = { type: "change"; stores: StoreName[] } | { type: "wipe" }

const CHANNEL_NAME = "blueline"
// How long a call waits for the database to open before it fails.
const OPEN_TIMEOUT_MS = 5000

interface Backend {
  get(store: StoreName, id: string): Promise<unknown>
  getAll(store: StoreName): Promise<unknown[]>
  keys(store: StoreName): Promise<string[]>
  write(ops: WriteOp[]): Promise<void>
  close(): void
}

let backend: Promise<Backend> | null = null
let unavailable = false

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

// Behaves like IndexedDB: values are copied in and out, lists come sorted by id, and a write
// either applies whole or not at all.
function memoryBackend(): Backend {
  const data = new Map<StoreName, Map<string, unknown>>(STORES.map((store) => [store, new Map()]))
  const sorted = (store: StoreName) => [...data.get(store)!.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return {
    get: async (store, id) => clone(data.get(store)!.get(id)),
    getAll: async (store) => sorted(store).map(([, value]) => clone(value)),
    keys: async (store) => sorted(store).map(([id]) => id),
    write: async (ops) => {
      const copies = ops.map((op) => ("put" in op ? { ...op, put: clone(op.put) } : "putNew" in op ? { ...op, putNew: clone(op.putNew) } : op))
      for (const op of copies) {
        const store = data.get(op.store)!
        if ("put" in op) store.set(op.put.id, op.put)
        else if ("putNew" in op) {
          if (!store.has(op.putNew.id)) store.set(op.putNew.id, op.putNew)
        } else if ("delete" in op) store.delete(op.delete)
        else store.clear()
      }
    },
    close: () => {},
  }
}

function idbBackend(db: IDBDatabase): Backend {
  const read = <T>(store: StoreName, run: (s: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(store, "readonly").objectStore(store))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  return {
    get: (store, id) => read(store, (s) => s.get(id)),
    getAll: (store) => read(store, (s) => s.getAll()),
    keys: (store) => read(store, (s) => s.getAllKeys()).then((keys) => keys.map(String)),
    write: (ops) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([...new Set(ops.map((op) => op.store))], "readwrite", { durability: "strict" })
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error ?? new DOMException("The write was cancelled.", "AbortError"))
        try {
          for (const op of ops) {
            const store = tx.objectStore(op.store)
            if ("put" in op) store.put(op.put)
            else if ("putNew" in op) {
              const value = structuredClone(op.putNew)
              const check = store.getKey(value.id)
              check.onsuccess = () => {
                if (check.result === undefined) store.put(value)
              }
            } else if ("delete" in op) store.delete(op.delete)
            else store.clear()
          }
        } catch (error) {
          // A value that can't be stored: nothing of this write may land.
          tx.abort()
          reject(error)
        }
      }),
    close: () => db.close(),
  }
}

function openDatabase(idb: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" })
    }
    request.onsuccess = () => {
      const db = request.result
      // A newer version of the app wants to upgrade the database: step aside, reconnect later.
      db.onversionchange = () => {
        db.close()
        backend = null
      }
      // The browser closed the connection (storage cleared, low memory): reconnect next time.
      db.onclose = () => {
        backend = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
}

async function openBackend(): Promise<Backend> {
  try {
    const idb = globalThis.indexedDB
    if (idb) return idbBackend(await openDatabase(idb))
  } catch {
    // Falls through to memory.
  }
  unavailable = true
  return memoryBackend()
}

// Waits for the database, but not forever. The opening itself goes on, so a later call finds
// the database once the browser has opened it.
function ready(opening: Promise<Backend>) {
  return new Promise<Backend>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException("The database did not open in time.", "TimeoutError")), OPEN_TIMEOUT_MS)
    opening.then(
      (b) => {
        clearTimeout(timer)
        resolve(b)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

// Runs a call on the open database. A connection the browser has closed in the meantime is
// opened again once.
async function run<T>(call: (b: Backend) => Promise<T>): Promise<T> {
  backend ??= openBackend()
  const current = backend
  try {
    return await call(await ready(current))
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error
    if (backend === current) backend = null
    backend ??= openBackend()
    return call(await ready(backend))
  }
}

// ---- Change notifications -------------------------------------------------------------------

type Listener = (message: StorageMessage) => void
const listeners = new Set<Listener>()
let channel: BroadcastChannel | null | undefined

const isMessage = (value: unknown): value is StorageMessage =>
  typeof value === "object" && value !== null && ((value as StorageMessage).type === "change" || (value as StorageMessage).type === "wipe")

function deliver(message: StorageMessage) {
  for (const listener of listeners) {
    try {
      listener(message)
    } catch {
      // One screen's problem never stops the others from hearing about the change.
    }
  }
}

function getChannel() {
  if (channel !== undefined) return channel
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME)
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        if (isMessage(event.data)) deliver(event.data)
      }
      // Node (the unit tests) would otherwise keep running for the open channel.
      ;(channel as { unref?: () => void }).unref?.()
    }
  } catch {
    channel = null
  }
  return channel
}

// Listens for writes in this tab and in other tabs. Returns the function that stops listening.
export function onStorageChange(listener: Listener) {
  getChannel()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Tells this tab and the others; BroadcastChannel itself never reaches the tab that sent it.
export function announce(message: StorageMessage) {
  deliver(message)
  announceElsewhere(message)
}

// Tells only the other tabs.
export function announceElsewhere(message: StorageMessage) {
  try {
    getChannel()?.postMessage(message)
  } catch {
    // No other tabs to tell.
  }
}

// ---- Calls ------------------------------------------------------------------------------------

export const dbGet = <T extends Keyed>(store: StoreName, id: string) => run((b) => b.get(store, id)) as Promise<T | undefined>

export const dbGetAll = <T extends Keyed>(store: StoreName) => run((b) => b.getAll(store)) as Promise<T[]>

export const dbKeys = (store: StoreName) => run((b) => b.keys(store))

// Applies all operations in one transaction, then tells every open screen which stores changed.
export async function dbWrite(ops: WriteOp[]) {
  if (ops.length === 0) return
  await run((b) => b.write(ops))
  announce({ type: "change", stores: [...new Set(ops.map((op) => op.store))] })
}

const list = <T>(value: T | T[]) => (Array.isArray(value) ? value : [value])

export const dbPut = (store: StoreName, values: Keyed | Keyed[]) => dbWrite(list(values).map((put) => ({ store, put })))

export const dbDelete = (store: StoreName, ids: string | string[]) => dbWrite(list(ids).map((id) => ({ store, delete: id })))

export const dbClear = (stores: StoreName | StoreName[]) => dbWrite(list(stores).map((store) => ({ store, clear: true as const })))

// Small values under a name, in the "kv" store.
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const record = await dbGet<{ id: string; value: T }>("kv", key)
  return record?.value
}

export const kvSet = (key: string, value: unknown) => dbPut("kv", { id: key, value } as Keyed)

// True once the database turned out not to be usable here: data then lasts only while the page
// is open. Opens the database first, so the answer is final; one that doesn't open in time
// counts as unavailable for now.
export async function storageUnavailable() {
  try {
    await run(async () => undefined)
    return unavailable
  } catch {
    return true
  }
}

export const isStorageUnavailable = () => unavailable

// Closes the connection; the next call opens it again. For the tests.
export async function closeDatabase() {
  const current = backend
  backend = null
  unavailable = false
  // One still opening is closed once it is open.
  void current?.then((b) => b.close())
}
