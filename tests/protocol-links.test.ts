import { test } from "node:test"
import assert from "node:assert/strict"
import { decodeBoardLink, encodeBoardLink } from "../lib/protocol/board.ts"
import type { LinkPayload } from "../lib/protocol/links.ts"
import { decodeLinkPayload, encodeLinkPayload, linkFragment, parseLinkFragment } from "../lib/protocol/links.ts"
import { decodePairingLink, encodePairingLink } from "../lib/protocol/pairing.ts"

const K = "1".repeat(64)
const S = "2".repeat(32)

const samples: LinkPayload[] = [
  { type: "pair", pubkey: K, sid: S, expires: 1760000300, relays: ["wss://nos.lol", "wss://relay.primal.net"] },
  { type: "board", pubkey: K, sid: S, expires: 1760003600, relays: ["ws://localhost:10547"] },
  { type: "watch", match: K, relays: ["wss://nos.lol"] },
  { type: "watch", match: K, key: "3".repeat(64), relays: [] },
  { type: "club", club: K, relays: ["wss://nos.lol"] },
  { type: "club", club: K, invite: S, token: "4".repeat(32), secret: "5".repeat(64), relays: ["wss://nostr.oxtr.dev/path"] },
  { type: "tournament", tournament: K, relays: ["wss://nos.lol"] },
  { type: "profile", pubkey: K, relays: [] },
]

test("every link type round-trips through its fragment", () => {
  for (const p of samples) {
    const fragment = linkFragment(p)
    assert.deepEqual(parseLinkFragment(fragment), p, fragment)
    assert.deepEqual(parseLinkFragment(encodeURI(fragment)), p)
  }
})

test("links stay short enough for a comfortable QR code", () => {
  const pair = linkFragment(samples[0])
  assert.ok(pair.length < 140, `${pair.length} characters`)
  assert.match(pair, /^#pair=P1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}\.[0-9a-z]+\.nos\.lol,relay\.primal\.net$/)
})

test("a payload is only read as its own type", () => {
  const encoded = samples.map((p) => encodeLinkPayload(p))
  for (const [i, text] of encoded.entries()) {
    for (const type of ["pair", "board", "watch", "club", "tournament", "profile"] as const) {
      if (type === samples[i].type) continue
      assert.throws(() => decodeLinkPayload(type, text), /wrong_flow/, `${samples[i].type} read as ${type}`)
    }
  }
  assert.throws(() => decodePairingLink(encodeBoardLink({ pubkey: K, sid: S, expires: 1, relays: [] })), /wrong_flow/)
  assert.throws(() => decodeBoardLink(encodePairingLink({ pubkey: K, sid: S, expires: 1, relays: [] })), /wrong_flow/)
  assert.throws(() => parseLinkFragment("#pair=hello"), /wrong_flow/)
  assert.throws(() => parseLinkFragment("#unknown=P1.x"), /wrong_flow/)
  assert.throws(() => parseLinkFragment("https://example.com"), /wrong_flow/)
})

test("damaged or oversized payloads are refused", () => {
  const pair = encodeLinkPayload(samples[0])
  assert.throws(() => decodeLinkPayload("pair", pair.replace(/\.[^.]+\./, ".short.")), /invalid_content/)
  assert.throws(() => decodeLinkPayload("pair", "P1.only"), /invalid_content/)
  assert.throws(() => decodeLinkPayload("pair", pair.replace(/nos\.lol/, "bad relay")), /invalid_content/)
  assert.throws(() => encodeLinkPayload({ ...samples[0], relays: ["wss://a", "wss://b", "wss://c", "wss://d", "wss://e"] } as LinkPayload), /invalid_content/)
  assert.throws(() => encodeLinkPayload({ type: "club", club: K, invite: S, relays: [] }), /invalid_content/)
  assert.throws(() => encodeLinkPayload({ type: "watch", match: "xyz", relays: [] }), /invalid_content/)
  assert.throws(() => parseLinkFragment("#pair=%E0%A4%A"), /invalid_content/)
})
