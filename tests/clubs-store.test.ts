import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { loadStoredClub, updateClub, type StoredClub } from "../lib/clubs/store.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { dbWrite } from "../lib/storage/db.ts"

// The local copy of a club (lib/clubs/store.ts): what this device wrote stays "not sent" until
// relays of two operators confirmed it, whatever a fetch returns meanwhile; games recorded here
// are remembered by their local id.

const CLUB = "c".repeat(64)
const event = (id: string): NostrEvent => ({ id: id.repeat(64), pubkey: "a".repeat(64), created_at: 1, kind: 1180, tags: [["e", CLUB]], content: "", sig: "b".repeat(128) })

beforeEach(resetStorage)

test("own events are unsent from the moment they are kept, until a confirmed publish; a fetch never clears them", async () => {
  await updateClub(CLUB, { events: [event("1"), event("2")], unsent: [event("1").id, event("2").id] })
  assert.deepEqual((await loadStoredClub(CLUB))?.unsent, [event("1").id, event("2").id])
  // One relay returned them on a fetch: still not published (decision 0002 §5).
  await updateClub(CLUB, { events: [event("1"), event("2")], loadedAt: 5 })
  assert.deepEqual((await loadStoredClub(CLUB))?.unsent, [event("1").id, event("2").id])
  await updateClub(CLUB, { sent: [event("2").id] })
  const stored = await loadStoredClub(CLUB)
  assert.deepEqual(stored?.unsent, [event("1").id])
  assert.equal(stored?.loadedAt, 5)
  assert.equal(stored?.events.length, 2)
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
