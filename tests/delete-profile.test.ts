import { test } from "node:test"
import assert from "node:assert/strict"
import { blankMetadataTemplate, deletionTemplates, KIND_DELETION } from "../lib/profile/delete-profile.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"

const ME = "a".repeat(64)
const OTHER = "b".repeat(64)
const event = (id: string, kind: number, pubkey = ME, tags: string[][] = []): NostrEvent => ({ id: id.padEnd(64, "0"), kind, pubkey, tags, content: "", created_at: 1, sig: "" })

test("delete profile: the empty profile has no name, picture or description", () => {
  assert.deepEqual(blankMetadataTemplate(100), { kind: 0, tags: [], content: "{}", created_at: 100 })
})

test("delete profile: asks for every own event by id, replaceable and addressable ones also by coordinate", () => {
  const events = [
    event("1", 0),
    event("2", 10002),
    event("3", 30078, ME, [["d", "games"]]),
    event("4", 1180),
    event("5", 1, OTHER),
    event("6", KIND_DELETION),
    event("1", 0),
  ]
  const [request, ...more] = deletionTemplates(ME, events, 200, "")
  assert.equal(more.length, 0)
  assert.equal(request.kind, KIND_DELETION)
  assert.equal(request.created_at, 200)
  const of = (name: string) => request.tags.filter((tag) => tag[0] === name).map((tag) => tag[1])
  assert.deepEqual(of("e"), ["1", "2", "3", "4"].map((id) => id.padEnd(64, "0")))
  assert.deepEqual(of("a"), [`0:${ME}:`, `10002:${ME}:`, `30078:${ME}:games`])
  assert.deepEqual(of("k"), ["0", "10002", "30078", "1180"])
})

test("delete profile: nothing to ask for gives no request; many events are split", () => {
  assert.deepEqual(deletionTemplates(ME, [event("1", 1, OTHER)], 1), [])
  const many = Array.from({ length: 700 }, (_, i) => ({ ...event("", 1180), id: i.toString(16).padStart(64, "0") }))
  const requests = deletionTemplates(ME, many, 1)
  assert.equal(requests.length, 3)
  assert.equal(requests.flatMap((r) => r.tags.filter((t) => t[0] === "e")).length, 700)
  assert.ok(requests.every((r) => r.tags.some((t) => t[0] === "k" && t[1] === "1180")))
})
