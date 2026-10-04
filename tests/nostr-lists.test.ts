import { before, test } from "node:test"
import assert from "node:assert/strict"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import {
  buildListTemplate,
  buildProfileBadgesTemplate,
  buildRelayListTemplate,
  ListError,
  parseListSafe,
  parseProfileBadges,
  parseRelayListSafe,
} from "../lib/nostr/ext/lists.ts"
import type { NostrEvent, Signer } from "../lib/nostr/types.ts"
// nostr-core directly: these tests show its gaps next to the safe variants.
import { createListTemplate, parseList, parseRelayList } from "nostr-core"

let core: Core
let aliceKey: Uint8Array
let alice: Signer
let bob: Signer
let alicePub: string

before(async () => {
  core = await loadCore()
  aliceKey = core.generateSecretKey()
  alice = core.createSecretKeySigner(aliceKey)
  bob = core.createSecretKeySigner(core.generateSecretKey())
  alicePub = core.getPublicKey(aliceKey)
})

const privateItems = [["p", "a".repeat(64)], ["blueline-club", "geheim"]]

async function aliceList(content?: string, tags: string[][] = [["d", "blueline:clubs"], ["t", "darts"], ["x-unknown", "keep me"]]): Promise<NostrEvent> {
  const body = content ?? (await alice.nip44!.encrypt(alicePub, JSON.stringify(privateItems)))
  return core.finalizeEvent({ kind: 30000, tags, content: body, created_at: 1_790_000_000 }, aliceKey)
}

test("NIP-51: private items have an explicit status — decrypted, none, no-key, undecryptable", async () => {
  const event = await aliceList()
  const read = await parseListSafe(event, alice)
  assert.deepEqual([read.privateStatus, read.privateTags, read.identifier], ["decrypted", privateItems, "blueline:clubs"])
  assert.deepEqual(read.publicTags, event.tags)
  assert.equal((await parseListSafe(await aliceList(""), alice)).privateStatus, "none")
  assert.equal((await parseListSafe(event)).privateStatus, "no-key")
  assert.equal((await parseListSafe(event, bob)).privateStatus, "no-key")
  assert.equal((await parseListSafe(event, { getPublicKey: alice.getPublicKey, signEvent: alice.signEvent })).privateStatus, "no-key")
  assert.equal((await parseListSafe(await aliceList("not encrypted at all"), alice)).privateStatus, "undecryptable")
  const notTags = await alice.nip44!.encrypt(alicePub, JSON.stringify({ hello: "world" }))
  assert.equal((await parseListSafe(await aliceList(notTags), alice)).privateStatus, "undecryptable")
})

test("NIP-51: nostr-core 1.0.4 shows unreadable private items as an empty list (the gap this closes)", async () => {
  const event = await aliceList()
  const parsed = parseList(event, core.generateSecretKey())
  assert.deepEqual(parsed.privateItems, [])
  const template = createListTemplate({ kind: 30000, identifier: "x", publicItems: [], privateItems: [{ tag: "p", value: "b".repeat(64) }] })
  assert.equal(template.content, "", "private items silently dropped without a key")
})

test("NIP-51: legacy NIP-04 private content is read", async () => {
  const legacy = await alice.nip04!.encrypt(alicePub, JSON.stringify(privateItems))
  assert.ok(legacy.includes("?iv="))
  const read = await parseListSafe(await aliceList(legacy), alice)
  assert.deepEqual([read.privateStatus, read.privateTags], ["decrypted", privateItems])
})

test("NIP-51: writing over unreadable private items is refused; readable ones round-trip with unknown tags", async () => {
  const event = await aliceList()
  for (const base of [await parseListSafe(event), await parseListSafe(event, bob)]) {
    await assert.rejects(buildListTemplate({ kind: 30000, publicTags: base.publicTags, base, signer: alice }), (error: ListError) => error.code === "private-unreadable")
  }
  const base = await parseListSafe(event, alice)
  const template = await buildListTemplate({ kind: 30000, publicTags: base.publicTags, privateTags: [...base.privateTags, ["p", "c".repeat(64)]], base, signer: alice })
  assert.deepEqual(template.tags, [["d", "blueline:clubs"], ["t", "darts"], ["x-unknown", "keep me"]])
  assert.ok(template.created_at > event.created_at)
  const again = await parseListSafe(core.finalizeEvent(template, aliceKey), alice)
  assert.deepEqual(again.privateTags, [...privateItems, ["p", "c".repeat(64)]])
  // Changing only public items keeps the private ones; [] removes them on purpose.
  const publicOnly = await buildListTemplate({ kind: 30000, publicTags: [...base.publicTags, ["t", "steel"]], base, signer: alice })
  assert.deepEqual((await parseListSafe(core.finalizeEvent(publicOnly, aliceKey), alice)).privateTags, privateItems)
  const cleared = await buildListTemplate({ kind: 30000, publicTags: base.publicTags, privateTags: [], base, signer: alice })
  assert.equal(cleared.content, "")
  await assert.rejects(buildListTemplate({ kind: 30000, identifier: "x", publicTags: [], privateTags: [["p", "d".repeat(64)]] }), (error: ListError) => error.code === "cannot-encrypt")
  await assert.rejects(buildListTemplate({ kind: 30000, publicTags: [], privateTags: [["t", "x"]], base, signer: bob }), (error: ListError) => error.code === "wrong-author")
})

test("NIP-65: bad entries are skipped and reported, duplicates merge, other tags stay (nostr-core throws)", async () => {
  const event = core.finalizeEvent(
    {
      kind: 10002,
      content: "",
      created_at: 1_790_000_000,
      tags: [
        ["r", "wss://nos.lol"],
        ["r", "wss://relay.primal.net", "read"],
        ["r", "wss://relay.primal.net/", "write"],
        ["r", "not a url"],
        ["r", "wss://odd.example", "sometimes"],
        ["r", "wss://nostr.oxtr.dev", "write"],
        ["r", "wss://nostr-01.yakihonne.com", ""],
        ["alt", "relay list"],
      ],
    },
    aliceKey,
  )
  assert.throws(() => parseRelayList(event))
  const list = parseRelayListSafe(event)
  assert.deepEqual(list.relays, [
    { url: "wss://nos.lol", read: true, write: true },
    { url: "wss://relay.primal.net", read: true, write: true },
    { url: "wss://nostr.oxtr.dev", read: false, write: true },
    // An empty marker, as some clients write it, means both.
    { url: "wss://nostr-01.yakihonne.com", read: true, write: true },
  ])
  assert.deepEqual(list.invalid, [["r", "not a url"], ["r", "wss://odd.example", "sometimes"]])
  assert.deepEqual(list.otherTags, [["alt", "relay list"]])
  const template = buildRelayListTemplate(list.relays, { list, event })
  assert.deepEqual(template.tags, [["r", "wss://nos.lol"], ["r", "wss://relay.primal.net"], ["r", "wss://nostr.oxtr.dev", "write"], ["r", "wss://nostr-01.yakihonne.com"], ["alt", "relay list"]])
})

test("NIP-58 profile badges: pairs in order from 10008 and legacy 30008; badge sets and unknown tags survive", () => {
  const issuer = "e".repeat(64)
  const awardA = "1".repeat(64)
  const awardB = "2".repeat(64)
  const current = core.finalizeEvent(
    {
      kind: 10008,
      content: "",
      created_at: 1_790_000_000,
      tags: [
        ["a", `30009:${issuer}:champion`],
        ["e", awardA, "wss://nos.lol"],
        ["a", `30008:${alicePub}:darts`],
        ["a", `30009:${issuer}:orphan`],
        ["x-client", "keep"],
        ["a", `30009:${issuer}:180`],
        ["e", awardB],
      ],
    },
    aliceKey,
  )
  const badges = parseProfileBadges(current)!
  assert.deepEqual(badges.pairs, [
    { definition: `30009:${issuer}:champion`, award: awardA, relay: "wss://nos.lol" },
    { definition: `30009:${issuer}:180`, award: awardB },
  ])
  assert.deepEqual(badges.otherTags, [["a", `30008:${alicePub}:darts`], ["a", `30009:${issuer}:orphan`], ["x-client", "keep"]])
  const reordered = buildProfileBadgesTemplate([badges.pairs[1], badges.pairs[0]], { badges, event: current })
  assert.equal(reordered.kind, 10008)
  assert.deepEqual(reordered.tags.slice(0, 4), [["a", `30009:${issuer}:180`], ["e", awardB], ["a", `30009:${issuer}:champion`], ["e", awardA, "wss://nos.lol"]])
  assert.deepEqual(reordered.tags.slice(4), badges.otherTags)

  const legacy = core.finalizeEvent({ kind: 30008, content: "", created_at: 1_700_000_000, tags: [["d", "profile_badges"], ["a", `30009:${issuer}:champion`], ["e", awardA]] }, aliceKey)
  const old = parseProfileBadges(legacy)!
  assert.deepEqual([old.legacy, old.pairs.length, old.otherTags], [true, 1, []])
  const migrated = buildProfileBadgesTemplate(old.pairs, { badges: old, event: legacy })
  assert.deepEqual([migrated.kind, migrated.tags], [10008, [["a", `30009:${issuer}:champion`], ["e", awardA]]])
  assert.equal(parseProfileBadges(core.finalizeEvent({ kind: 30008, content: "", created_at: 1, tags: [["d", "darts"]] }, aliceKey)), null)
})
