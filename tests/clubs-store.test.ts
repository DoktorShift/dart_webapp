import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { keep, waitingEvents } from "../lib/clubs/send.ts"
import { loadStoredClub, updateClub, type StoredClub } from "../lib/clubs/store.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { dbWrite } from "../lib/storage/db.ts"
import { deliverNow, outboxStatus } from "../lib/sync/outbox.ts"

// The local copy of a club (lib/clubs/store.ts) and how its events leave (lib/clubs/send.ts):
// kept here first, then queued in the one outbox of lib/sync for the club's relays, in the order
// they were written; games recorded here are remembered by their local id.

process.env.NEXT_PUBLIC_BLUELINE_RELAYS = "wss://one.example,wss://two.example"
const CLUB = "c".repeat(64)
const event = (id: string): NostrEvent => ({ id: id.repeat(64), pubkey: "a".repeat(64), created_at: 1, kind: 1180, tags: [["e", CLUB]], content: "", sig: "b".repeat(128) })

beforeEach(resetStorage)

test("a change is kept, then queued for the club's relays, each event after the one before and a later change after the club's last waiting event", async () => {
  await updateClub(CLUB, { relays: ["wss://hint.example"] })
  await keep(CLUB, { events: [event("1"), event("2")], keys: { [event("1").id]: "k".repeat(64) } })
  await keep(CLUB, { events: [event("3")], keys: {} })
  const stored = await loadStoredClub(CLUB)
  assert.deepEqual(stored?.events.map((e) => e.id), [event("1").id, event("2").id, event("3").id])
  assert.equal(stored?.keys[event("1").id], "k".repeat(64))
  assert.equal(await waitingEvents(CLUB), 3)

  const queued = await outboxStatus()
  assert.deepEqual(queued.map((s) => s.id), [event("1").id, event("2").id, event("3").id])
  assert.ok(queued.every((s) => s.rule === "published" && s.relays.join() === "wss://one.example,wss://two.example,wss://hint.example"))
  // Nothing goes out before what it builds on has a copy on some relay: neither the second event
  // of the change nor the next change.
  const [second, third] = await deliverNow([event("2").id, event("3").id])
  assert.equal(second.attempts, 0)
  assert.equal(third.attempts, 0)
})

test("recorded games are remembered by their local id; a copy from before the field existed reads as empty", async () => {
  await updateClub(CLUB, { recorded: { m1: event("1").id } })
  await updateClub(CLUB, { recorded: { m2: event("2").id } })
  assert.deepEqual((await loadStoredClub(CLUB))?.recorded, { m1: event("1").id, m2: event("2").id })
  const older: Partial<StoredClub> = { ...(await loadStoredClub(CLUB)) }
  delete older.recorded
  await dbWrite([{ store: "objects", put: older as StoredClub }])
  assert.deepEqual((await loadStoredClub(CLUB))?.recorded, {})
})
