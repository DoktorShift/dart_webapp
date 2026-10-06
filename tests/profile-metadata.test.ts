import { test } from "node:test"
import assert from "node:assert/strict"
import { metadataTemplate, readMetadata } from "../lib/profile/metadata.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"

// Kind 0 is shared with every other Nostr app: BlueLine reads what it needs and, on a change,
// touches only its own fields (PLAN.md "Bestehende Profilfelder … bleiben erhalten").

const event = (content: unknown, over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: "e".repeat(64),
  pubkey: "a".repeat(64),
  created_at: 1_790_000_000,
  kind: 0,
  tags: [],
  content: typeof content === "string" ? content : JSON.stringify(content),
  sig: "f".repeat(128),
  ...over,
})

test("reads the shown name, the picture and the Lightning address", () => {
  assert.deepEqual(readMetadata(event({ name: "lena_s", display_name: " Lena Schmidt ", picture: "https://img.example/l.jpg", lud16: "lena@wallet.example", nip05: "lena@example.com" })), {
    name: "Lena Schmidt",
    picture: "https://img.example/l.jpg",
    lightningAddress: "lena@wallet.example",
    nip05: "lena@example.com",
  })
  assert.equal(readMetadata(event({ name: "lena" })).name, "lena")
  assert.equal(readMetadata(event({ display_name: "  ", name: "lena" })).name, "lena")
})

test("damaged or missing metadata reads as unknown, not as an error", () => {
  const empty = { name: null, picture: null, lightningAddress: null, nip05: null }
  assert.deepEqual(readMetadata(event("{not json")), empty)
  assert.deepEqual(readMetadata(event("[1,2]")), empty)
  assert.deepEqual(readMetadata(event({ name: 42, picture: false })), empty)
  assert.deepEqual(readMetadata(null), empty)
})

test("a new profile writes its name in both name fields and nothing else", () => {
  const template = metadataTemplate({ name: " Lena ", picture: "https://img.example/l.jpg" })
  assert.equal(template.kind, 0)
  assert.deepEqual(JSON.parse(template.content), { name: "Lena", display_name: "Lena", picture: "https://img.example/l.jpg" })
  assert.deepEqual(template.tags, [])
})

test("a change keeps every field and tag another app wrote", () => {
  const base = event(
    { name: "lena_s", display_name: "Lena", about: "Darts!", nip05: "lena@example.com", lud16: "lena@wallet.example", banner: "https://img.example/b.jpg", custom_app_field: { x: 1 } },
    { tags: [["i", "github:lena", "proof"]] },
  )
  const template = metadataTemplate({ name: "Lena Schmidt", picture: "https://img.example/new.jpg" }, base)
  assert.deepEqual(JSON.parse(template.content), {
    name: "lena_s",
    display_name: "Lena Schmidt",
    about: "Darts!",
    nip05: "lena@example.com",
    lud16: "lena@wallet.example",
    banner: "https://img.example/b.jpg",
    custom_app_field: { x: 1 },
    picture: "https://img.example/new.jpg",
  })
  assert.deepEqual(template.tags, [["i", "github:lena", "proof"]])
  // It replaces the version it was made from.
  assert.ok(template.created_at > base.created_at)
})

test("a profile without display_name gets its name changed; removing the picture removes only that", () => {
  const base = event({ name: "lena", picture: "https://img.example/l.jpg", website: "https://lena.example" })
  assert.deepEqual(JSON.parse(metadataTemplate({ name: "Lena S." }, base).content), { name: "Lena S.", picture: "https://img.example/l.jpg", website: "https://lena.example" })
  assert.deepEqual(JSON.parse(metadataTemplate({ picture: null }, base).content), { name: "lena", website: "https://lena.example" })
})
