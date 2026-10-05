// Whether the game's latest writes worked. A failed write is shown in the game with a way to
// try again; nothing says "saved" while one is failing. The page keeps everything entered in
// memory meanwhile, so retrying writes the current state, not an old one.

// "game": the running game (localStorage). "archive:<match id>": that finished game's archive
// entry. Each game has its own, so one game saving fine never hides another game's failure.
export type SaveKind = "game" | `archive:${string}`
export const archiveSaveKind = (matchId: string): SaveKind => `archive:${matchId}`
type Attempt = () => boolean | Promise<boolean>

export interface SaveState {
  failing: boolean
  // The players hid the alert. It comes back when another write starts failing.
  dismissed: boolean
  // Counts retries that made everything saved again, for the short "saved" confirmation.
  recovered: number
}

const INITIAL: SaveState = { failing: false, dismissed: false, recovered: 0 }

let state = INITIAL
const attempts = new Map<SaveKind, Attempt>()
const latest = new Map<SaveKind, number>()
const failed = new Set<SaveKind>()
const listeners = new Set<() => void>()

function update(next: Partial<SaveState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function settle(kind: SaveKind, ok: boolean) {
  // A write that starts failing (another game, or one that worked before) shows the alert again,
  // even if the players hid it for an earlier one.
  const fresh = !ok && !failed.has(kind)
  if (ok) {
    failed.delete(kind)
    // Nothing left to retry: let go of the game it would have written.
    attempts.delete(kind)
  } else failed.add(kind)
  const failing = failed.size > 0
  if (failing !== state.failing || (fresh && state.dismissed)) update({ failing, dismissed: failing && !fresh && state.dismissed })
}

// Runs a write and remembers whether it worked. Only the latest write of each kind counts: an
// older one finishing late doesn't overrule it. Resolves to whether this write worked.
export function trackSave(kind: SaveKind, attempt: Attempt): Promise<boolean> {
  attempts.set(kind, attempt)
  const id = (latest.get(kind) ?? 0) + 1
  latest.set(kind, id)
  const done = (ok: boolean) => {
    if (latest.get(kind) === id) settle(kind, ok)
    return ok
  }
  try {
    const result = attempt()
    return typeof result === "boolean" ? Promise.resolve(done(result)) : result.then(done, () => done(false))
  } catch {
    return Promise.resolve(done(false))
  }
}

// "Erneut versuchen": runs the latest failed write of each kind again.
export async function retrySaves() {
  await Promise.all([...failed].map((kind) => trackSave(kind, attempts.get(kind)!)))
  const ok = failed.size === 0
  if (ok) update({ recovered: state.recovered + 1 })
  return ok
}

export const dismissSaveAlert = () => update({ dismissed: true })

export const getSaveState = () => state
export const getInitialSaveState = () => INITIAL

export function subscribeSaveState(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// For tests.
export function resetSaveState() {
  attempts.clear()
  latest.clear()
  failed.clear()
  state = INITIAL
}
