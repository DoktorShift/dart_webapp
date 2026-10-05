import { test } from "node:test"
import assert from "node:assert/strict"
import { AVATAR_PALETTE, AVATAR_SECTORS, avatarDrawing, initialOf, safeImageUrl, seedHash } from "../lib/shell/avatar.ts"

// Expected behaviour follows decision 0001 F5 and 0002 §10: generated pictures without uploads,
// foreign photos only as https raster images.

const PUBKEY = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

test("the same seed always gives the same drawing", () => {
  assert.deepEqual(avatarDrawing(PUBKEY), avatarDrawing(PUBKEY))
  assert.deepEqual(avatarDrawing("Lena", "Lena"), avatarDrawing("Lena", "Lena"))
  // FNV-1a 32-bit reference values (offset basis 0x811c9dc5, prime 0x01000193).
  assert.equal(seedHash(""), 0x811c9dc5)
  assert.equal(seedHash("a"), 0xe40c292c)
})

test("different seeds spread over colours and patterns", () => {
  const seeds = Array.from({ length: 64 }, (_, i) => `player-${i}`)
  const colours = new Set(seeds.map((s) => avatarDrawing(s).from))
  const patterns = new Set(seeds.map((s) => avatarDrawing(s).outer.join("")))
  assert.ok(colours.size >= AVATAR_PALETTE.length - 1, `${colours.size} colours`)
  assert.ok(patterns.size >= 20, `${patterns.size} patterns`)
})

test("patterns are mirrored left and right", () => {
  for (const seed of [PUBKEY, "Tom", "x"]) {
    const { outer, inner } = avatarDrawing(seed)
    assert.equal(outer.length, AVATAR_SECTORS)
    for (let i = 1; i < AVATAR_SECTORS / 2; i++) {
      assert.equal(outer[i], outer[AVATAR_SECTORS - i])
      assert.equal(inner[i], inner[AVATAR_SECTORS - i])
    }
  }
})

test("the initial is the first letter or digit, in capitals", () => {
  assert.equal(initialOf("lena"), "L")
  assert.equal(initialOf("  özlem"), "Ö")
  assert.equal(initialOf("🎯 Max"), "M")
  assert.equal(initialOf("7er"), "7")
  assert.equal(initialOf("🎯"), null)
  assert.equal(initialOf(""), null)
  assert.equal(initialOf(undefined), null)
  assert.equal(avatarDrawing("seed").initial, null)
})

test("only https raster images are used as photos", () => {
  assert.equal(safeImageUrl("https://example.com/me.jpg"), "https://example.com/me.jpg")
  assert.equal(safeImageUrl(" https://example.com/a b.png "), "https://example.com/a%20b.png")
  for (const bad of [
    "http://example.com/me.jpg",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "https://example.com/me.svg",
    "https://example.com/me.SVGZ",
    "https://user:pass@example.com/me.png",
    "//example.com/me.png",
    "me.png",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeImageUrl(bad), null, String(bad))
  }
})
