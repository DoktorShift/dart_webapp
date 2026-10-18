import { dbGet, dbWrite, type Keyed, type StoreName } from "./db.ts"

// Work that must not run twice at the same time, in any tab of the app: a read-modify-write of
// one stored object (a club's or a tournament's local copy also holds what no relay can bring
// back: invite tokens, draw seeds, board keys), or a decision a device signs once (a board's
// result, an automatic admission). One Web Lock per name, as the outbox does (lib/sync/outbox.ts);
// waiters go in the order they asked. Without Web Locks (Safari before 15.4) the lock covers
// this page only.

const tails = new Map<string, Promise<unknown>>()

export async function withLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (locks) return await locks.request(`blueline:${name}`, task)
  const run = (tails.get(name) ?? Promise.resolve()).catch(() => {}).then(task)
  tails.set(name, run)
  return run
}

// Writes `change(stored)` over the object as it is stored now, holding its lock, and resolves
// with what was written; null from `change` writes nothing.
export function updateStored<T extends Keyed>(store: StoreName, id: string, change: (stored: T | undefined) => T): Promise<T>
export function updateStored<T extends Keyed>(store: StoreName, id: string, change: (stored: T | undefined) => T | null): Promise<T | null>
export function updateStored<T extends Keyed>(store: StoreName, id: string, change: (stored: T | undefined) => T | null): Promise<T | null> {
  return withLock(`${store}:${id}`, async () => {
    const next = change(await dbGet<T>(store, id))
    if (next) await dbWrite([{ store, put: next }])
    return next
  })
}
