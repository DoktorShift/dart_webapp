import { before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { createLocalSigner } from "../lib/nostr/signers.ts"
import type { EventTemplate, NostrEvent, Signer } from "../lib/nostr/types.ts"
import { deletedRoundTemplate, readRound, roundTemplate, savedRounds } from "../lib/profile/rounds.ts"

// "Meine Spielerrunden" as NIP-51 follow sets (kind 30000): guests' names never public, entries of
// other apps kept, and no write over a private part this device can't read (PLAN.md "Verwendung
// von NIP 51").

let core: Core
let me: Signer
let someoneElse: Signer
const LENA = "1".repeat(64)
const TOM = "2".repeat(64)
const FOREIGN = "3".repeat(64)

before(async () => {
  core = await loadCore()
  me = await createLocalSigner(core.generateSecretKey())
  someoneElse = await createLocalSigner(core.generateSecretKey())
})
beforeEach(resetStorage)

const sign = (signer: Signer, template: EventTemplate) => signer.signEvent(template) as Promise<NostrEvent>
const tuesday = { id: "a".repeat(32), title: "Dienstagsrunde", players: [{ name: "Lena", pubkey: LENA }, { name: "Gast Mia" }, { name: "Tom", pubkey: TOM }] }

test("players with a profile are public p tags; every seat, guests included, is private and in order", async () => {
  const event = await sign(me, await roundTemplate(tuesday, null, me))
  assert.equal(event.kind, 30000)
  assert.deepEqual(event.tags, [["d", `blueline-round-${tuesday.id}`], ["title", "Dienstagsrunde"], ["p", LENA], ["p", TOM]])
  assert.ok(!event.content.includes("Mia") && event.content.length > 0, "the private part is encrypted")
  const round = await readRound(event, me)
  assert.deepEqual(round?.players, tuesday.players)
  assert.equal(round?.title, "Dienstagsrunde")
  assert.equal(round?.privateStatus, "decrypted")
})

test("without the key only the public part is read: profiles, without names", async () => {
  const event = await sign(me, await roundTemplate(tuesday, null, me))
  const round = await readRound(event, someoneElse)
  assert.equal(round?.privateStatus, "no-key")
  assert.deepEqual(round?.players, [{ name: "", pubkey: LENA }, { name: "", pubkey: TOM }])
})

test("a change keeps what another app added, publicly and privately", async () => {
  const pubkey = await me.getPublicKey()
  // Another app's version: its own p entry, an unknown tag, and a private tag of its own.
  const content = await me.nip44!.encrypt(pubkey, JSON.stringify([["player", "Lena", LENA], ["note", "bring darts"]]))
  const base = await sign(me, {
    kind: 30000,
    tags: [["d", `blueline-round-${tuesday.id}`], ["title", "Alt"], ["p", LENA], ["p", FOREIGN, "wss://relay.example"], ["client", "other-app"]],
    content,
    created_at: 1_790_000_000,
  })
  const next = await roundTemplate({ ...tuesday, title: "Neu", players: [{ name: "Tom", pubkey: TOM }] }, base, me)
  assert.deepEqual(next.tags, [["d", `blueline-round-${tuesday.id}`], ["title", "Neu"], ["p", TOM], ["p", FOREIGN, "wss://relay.example"], ["client", "other-app"]])
  assert.ok(next.created_at > base.created_at)
  const stored = JSON.parse(await me.nip44!.decrypt(pubkey, next.content))
  assert.deepEqual(stored, [["player", "Tom", TOM], ["note", "bring darts"]])
})

test("a round whose private part can't be read here is never written over or deleted", async () => {
  const base = await sign(me, await roundTemplate(tuesday, null, me))
  const keyless: Signer = { getPublicKey: () => me.getPublicKey(), signEvent: (t) => me.signEvent(t) }
  await assert.rejects(roundTemplate({ ...tuesday, title: "Neu" }, base, keyless), { name: "ListError", code: "private-unreadable" })
  await assert.rejects(deletedRoundTemplate(base, keyless), { name: "ListError", code: "private-unreadable" })
  // Damaged content counts as unreadable too.
  const damaged = await sign(me, { kind: 30000, tags: base.tags, content: "not encrypted at all", created_at: base.created_at + 1 })
  await assert.rejects(roundTemplate(tuesday, damaged, me), { name: "ListError", code: "private-unreadable" })
})

test("a signer without encryption saves only the players with a profile", async () => {
  const keyless: Signer = { getPublicKey: () => me.getPublicKey(), signEvent: (t) => me.signEvent(t) }
  const template = await roundTemplate(tuesday, null, keyless)
  assert.equal(template.content, "")
  assert.deepEqual(template.tags.filter((t) => t[0] === "p"), [["p", LENA], ["p", TOM]])
})

test("a deleted round is an empty version and reads as gone; other lists aren't rounds", async () => {
  const base = await sign(me, await roundTemplate(tuesday, null, me))
  const deleted = await sign(me, await deletedRoundTemplate(base, me))
  assert.deepEqual(deleted.tags, [["d", `blueline-round-${tuesday.id}`]])
  assert.equal(await readRound(deleted, me), null)
  const followSet = await sign(me, { kind: 30000, tags: [["d", "friends"], ["p", LENA]], content: "", created_at: 1_790_000_000 })
  assert.equal(await readRound(followSet, me), null)
})

test("on the device, each version is decrypted once, and profiles get the names known here", async () => {
  const withNames = await sign(me, await roundTemplate(tuesday, null, me))
  const publicOnly = await sign(me, await roundTemplate({ id: "b".repeat(32), title: "", players: [{ name: "Tom", pubkey: TOM }] }, null, { getPublicKey: () => me.getPublicKey(), signEvent: (t) => me.signEvent(t) }))
  const directory = [{ name: "Tommy", pubkey: TOM }]
  const first = await savedRounds([withNames, publicOnly], me, directory)
  assert.deepEqual(first.find((r) => r.id === tuesday.id)?.players, tuesday.players)
  // A round known only by its profiles is named from this device's players.
  assert.deepEqual(first.find((r) => r.id === "b".repeat(32))?.players, [{ name: "Tommy", pubkey: TOM }])
  // Without the signer, the remembered reading still has every name.
  const again = await savedRounds([withNames], null, [])
  assert.deepEqual(again[0].players, tuesday.players)
})

test("the signer is asked for only when a round still has to be read, and once", async () => {
  const one = await sign(me, await roundTemplate(tuesday, null, me))
  const two = await sign(me, await roundTemplate({ id: "c".repeat(32), title: "Freitag", players: [{ name: "Gast Ole" }] }, null, me))
  let asked = 0
  const signer = () => {
    asked++
    return Promise.resolve(me)
  }
  assert.equal((await savedRounds([one, two], signer, [])).length, 2)
  assert.equal(asked, 1)
  // Both remembered now: opening setup again wakes no signer.
  assert.equal((await savedRounds([one, two], signer, [])).length, 2)
  assert.equal(asked, 1)
})
