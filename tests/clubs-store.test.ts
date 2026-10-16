import { after, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { FakeNetwork } from "./support/fake-relay.ts"
import { keep, unsentEvents } from "../lib/clubs/send.ts"
import { loadStoredClub, storedClubs, updateClub, type StoredClub } from "../lib/clubs/store.ts"
import { refreshClub } from "../lib/clubs/sync.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { loadCore } from "../lib/nostr/core.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { signOut, startLocalProfile } from "../lib/profile/session.ts"
import { dbWrite } from "../lib/storage/db.ts"
import { deliverNow, outboxStatus } from "../lib/sync/outbox.ts"

// The local copy of a club (lib/clubs/store.ts) and how its events leave (lib/clubs/send.ts):
// kept here first, then queued in the one outbox of lib/sync for the club's relays, in the order
// they were written; games recorded here are remembered by their local id; nothing is written
// for a profile that is no longer signed in.

process.env.NEXT_PUBLIC_BLUELINE_RELAYS = "wss://one.example,wss://two.example"
const network = new FakeNetwork()
Object.assign(globalThis, { WebSocket: network.WebSocket })
const relays = ["wss://one.example", "wss://two.example"].map((url) => network.add(url))
const CLUB = "c".repeat(64)
const event = (id: string): NostrEvent => ({ id: id.repeat(64), pubkey: "a".repeat(64), created_at: 1, kind: 1180, tags: [["e", CLUB]], content: "", sig: "b".repeat(128) })

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
})
after(() => relayClient().close())

test("a change is kept, then queued for the club's relays, each event after the one before and a later change after the club's last waiting event", async () => {
  const { pubkey } = await startLocalProfile()
  await updateClub(CLUB, { relays: ["wss://hint.example"] }, pubkey)
  await keep(CLUB, pubkey, { events: [event("1"), event("2")], keys: { [event("1").id]: "k".repeat(64) } })
  await keep(CLUB, pubkey, { events: [event("3")], keys: {} })
  const stored = await loadStoredClub(CLUB)
  assert.deepEqual(stored?.events.map((e) => e.id), [event("1").id, event("2").id, event("3").id])
  assert.equal(stored?.keys[event("1").id], "k".repeat(64))
  assert.deepEqual(await unsentEvents(CLUB), { waiting: 3, refused: 0 })

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
  await updateClub(CLUB, { recorded: { m1: event("1").id } }, null)
  await updateClub(CLUB, { recorded: { m2: event("2").id } }, null)
  assert.deepEqual((await loadStoredClub(CLUB))?.recorded, { m1: event("1").id, m2: event("2").id })
  const older: Partial<StoredClub> = { ...(await loadStoredClub(CLUB)) }
  delete older.recorded
  await dbWrite([{ store: "objects", put: older as StoredClub }])
  assert.deepEqual((await loadStoredClub(CLUB))?.recorded, {})
})

test("a refresh still on its way when the profile signs out writes nothing: the next profile doesn't list the club", async () => {
  const core = await loadCore()
  const a = await startLocalProfile()
  const founding = core.finalizeEvent({ kind: 1180, tags: [["L", "blueline"], ["l", "club.found", "blueline"], ["v", "1"]], content: "{}", created_at: 1_790_000_000 }, core.generateSecretKey())
  for (const relay of relays) {
    relay.events = [founding]
    relay.options = { delayMs: 300 }
  }
  await updateClub(founding.id, {}, a.pubkey)
  // The Clubs tab refreshes against slow relays, and meanwhile the person signs out (keeping
  // the games) and someone else starts a profile.
  const refresh = refreshClub(founding.id, { pubkey: a.pubkey, signer: null, automatic: false })
  await signOut({ keepLocalData: true })
  assert.deepEqual(await storedClubs(), [], "the sign-out deleted the club's copy")
  await assert.rejects(refresh)
  const b = await startLocalProfile()
  assert.notEqual(b.pubkey, a.pubkey)
  assert.deepEqual(await storedClubs(), [])
  for (const relay of relays) relay.options = {}
})
