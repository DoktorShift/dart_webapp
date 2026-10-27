import { query } from "../nostr/client.ts"
import { nowSeconds } from "../nostr/time.ts"
import { ownEvents, ownRelaySettings } from "../profile/own-events.ts"
import { publishTargets } from "../profile/relay-list.ts"
import { getSession, getSigner } from "../profile/session.ts"
import { KIND_PRIVATE } from "../protocol/kinds.ts"
import { recordSlot } from "../protocol/private.ts"
import { kvGet, kvSet } from "../storage/db.ts"
import { storedDataKey, type DataKey } from "./data-key.ts"
import { syncMeta } from "./engine.ts"
import { deliverNow, enqueue } from "./outbox.ts"
import { compareVersions, nextCreatedAt, openRecords, sealRecord } from "./records.ts"

// A small private record the person keeps as one list (the profile's devices, its friends):
// one record on its relays (docs/protocol/families/private-records.md), whose newest version
// wins. Every change is made on the version the relays hold now: read first, the change applied
// to it, signed by the profile and handed to the outbox (./outbox.ts), sent now and again until
// relays have it. Nothing is written while no relay answers: a version made from this device's
// copy alone would replace a newer one. This device keeps its last copy in kv, which goes with
// the profile, and with it a few notes of its own that never reach the relays (`local`).
//
// Only for the profile still signed in, with its own signature: relays answer slowly, and
// another profile signing in meanwhile must neither sign at this profile's slot (that would
// link the two) nor get its copy back.

// Whether the relays were read: every one, some, or none (then the value is this device's last
// copy, maybe stale).
export type RecordState = "complete" | "partial" | "unavailable"

// "offline": no relay answered, so the record can't be read before it is changed. "switched":
// the profile signed out, or another one signed in, while the change was made. "refused": every
// relay refused the new version for good.
export type SmallRecordProblem = "no-key" | "offline" | "clock" | "signer" | "switched" | "refused" | "full"

export class SmallRecordError extends Error {
  problem: SmallRecordProblem
  constructor(problem: SmallRecordProblem, message: string) {
    super(message)
    this.name = "SmallRecordError"
    this.problem = problem
  }
}

export interface SmallRecordSpec<T, L extends object> {
  // The record's id on the relays, which is also its type.
  id: string
  // The kv key of this device's copy.
  key: string
  // The value a version's data holds; shapes that don't fit are left out, never trusted.
  read: (data: Record<string, unknown> | null) => T
  write: (value: T) => Record<string, unknown>
  // What this device notes for itself beside its copy.
  emptyLocal: L
  // A copy written in an earlier shape, brought to this one; null to read the relays afresh.
  upgrade?: (stored: Record<string, unknown>) => Copy<T, L> | null
}

export interface Copy<T, L> {
  pubkey: string
  rev: number
  device: string
  createdAt: number
  value: T
  local: L
}

export interface Loaded<T, L> {
  // Null before any version exists.
  value: T | null
  local: L
  thisDevice: string
  state: RecordState
  // False while the record can't be kept on relays: the profile has no data key here yet, or
  // this device hasn't synced once (nothing was synced so far, or the signer can't decrypt).
  available: boolean
}

export interface Current<T, L> {
  value: T | null
  local: L
  thisDevice: string
}

export function smallRecord<T, L extends object>(spec: SmallRecordSpec<T, L>) {
  const copy = async (pubkey: string): Promise<Copy<T, L> | null> => {
    const stored = await kvGet<Record<string, unknown>>(spec.key)
    if (!stored || stored.pubkey !== pubkey) return null
    if ("value" in stored) return stored as unknown as Copy<T, L>
    return spec.upgrade?.(stored) ?? null
  }

  // What the record needs on this device: the data key it is sealed with, and this device's id,
  // which the sync fixes on its first run (until then it isn't kept). null before both.
  const ready = async (pubkey: string): Promise<{ device: string; dataKey: DataKey } | null> => {
    const [meta, dataKey] = await Promise.all([syncMeta(pubkey), storedDataKey(pubkey)])
    return dataKey && meta.state !== null ? { device: meta.device, dataKey } : null
  }

  const targetsOf = async (pubkey: string) => publishTargets(KIND_PRIVATE, ownRelaySettings(await ownEvents(pubkey)))

  // Changes run one after another: each edit sees the version the one before it wrote, so two
  // changes at once (a tap and a message arriving) never both build on the same revision.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <R>(run: () => Promise<R>): Promise<R> => {
    const next = queue.then(run, run)
    queue = next.catch(() => {})
    return next
  }

  // Takes the newest version the relays hold over this device's copy.
  const refresh = async (pubkey: string, dataKey: DataKey, known: Copy<T, L> | null): Promise<{ current: Copy<T, L> | null; state: RecordState }> => {
    const result = await query([{ kinds: [KIND_PRIVATE], authors: [pubkey], "#d": [recordSlot(dataKey.key, spec.id)] }], await targetsOf(pubkey))
    const state: RecordState = result.answered.length === 0 ? "unavailable" : result.failed.length === 0 ? "complete" : "partial"
    const version = openRecords(result.events, dataKey.key, pubkey).versions.get(spec.id)
    if (!version || (known && compareVersions(version.record, known) <= 0)) return { current: known, state }
    const current: Copy<T, L> = { pubkey, rev: version.record.rev, device: version.record.device, createdAt: version.events[0].created_at, value: spec.read(version.data), local: known?.local ?? spec.emptyLocal }
    await kvSet(spec.key, current)
    return { current, state }
  }

  return {
    copy,

    async load(pubkey: string): Promise<Loaded<T, L>> {
      const [meta, known, here] = await Promise.all([syncMeta(pubkey), copy(pubkey), ready(pubkey)])
      if (!here) return { value: known?.value ?? null, local: known?.local ?? spec.emptyLocal, thisDevice: meta.device, state: "unavailable", available: false }
      const { current, state } = await refresh(pubkey, here.dataKey, known)
      return { value: current?.value ?? null, local: current?.local ?? spec.emptyLocal, thisDevice: here.device, state, available: true }
    },

    // Changes the record as the relays hold it now. `edit` gets the current version and gives
    // the next value (and, if it likes, new notes for this device), or null to leave it as it
    // is: then nothing is written and the current value comes back.
    change(pubkey: string, edit: (current: Current<T, L>) => { value: T; local?: L } | null | Promise<{ value: T; local?: L } | null>): Promise<T> {
      return serialized(() => write(pubkey, edit))
    },

    // Changes only this device's notes beside its copy.
    async note(pubkey: string, local: Partial<L>) {
      const known = await copy(pubkey)
      if (known) await kvSet(spec.key, { ...known, local: { ...known.local, ...local } })
    },
  }

  async function write(pubkey: string, edit: (current: Current<T, L>) => { value: T; local?: L } | null | Promise<{ value: T; local?: L } | null>): Promise<T> {
    {
      const here = await ready(pubkey)
      if (!here) throw new SmallRecordError("no-key", "the profile has no data key or no device id here yet")
      const { current, state } = await refresh(pubkey, here.dataKey, await copy(pubkey))
      if (state === "unavailable") throw new SmallRecordError("offline", "no relay answered, so the record can't be read first")
      // The clock is checked before the edit runs: an edit may send something on the strength of
      // the write that follows, so what can be known to fail must fail first.
      const at = nowSeconds()
      const created_at = nextCreatedAt(at, current?.createdAt ?? 0, at)
      if (created_at === null) throw new SmallRecordError("clock", "this device's clock is behind the version on the relays")
      const next = await edit({ value: current?.value ?? null, local: current?.local ?? spec.emptyLocal, thisDevice: here.device })
      if (!next) return current?.value ?? spec.read({})
      const local = next.local ?? current?.local ?? spec.emptyLocal
      const rev = (current?.rev ?? 0) + 1
      const templates = sealRecord({ type: spec.id, id: spec.id, rev, device: here.device, at }, spec.write(next.value), here.dataKey.key, created_at)
      const events = []
      try {
        const signer = await getSigner()
        for (const template of templates) events.push(await signer.signEvent(template))
      } catch (error) {
        throw new SmallRecordError("signer", error instanceof Error ? error.message : String(error))
      }
      const targets = await targetsOf(pubkey)
      const signedIn = () => getSession()?.pubkey === pubkey
      if (!signedIn() || events.some((event) => event.pubkey !== pubkey)) throw new SmallRecordError("switched", "the profile signed out, or another one signed in, while the record was changed")
      await enqueue(events.map((event) => ({ event, relays: targets })), { coalesce: true })
      const sent = await deliverNow(events.map((event) => event.id))
      if (sent.some((status) => status.state === "refused")) throw new SmallRecordError("refused", "every relay refused the record")
      if (signedIn()) await kvSet(spec.key, { pubkey, rev, device: here.device, createdAt: created_at, value: next.value, local } satisfies Copy<T, L>)
      return next.value
    }
  }
}
