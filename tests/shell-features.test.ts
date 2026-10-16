import { test } from "node:test"
import assert from "node:assert/strict"
import { featureOn, type Feature } from "../lib/shell/features.ts"

// The feature switches of PLAN.md "Ausrollen": NEXT_PUBLIC_BLUELINE_FEATURES names the areas that
// are on; everything but live games and payments needs the profile.

const ALL: readonly Feature[] = ["profile", "payments", "live", "sync", "clubs", "badges", "devices", "tournaments"]
const on = (raw: string | undefined) => ALL.filter((feature) => featureOn(feature, raw))

test("without the variable every area is on", () => {
  assert.deepEqual(on(undefined), ALL)
})

test("set, only the named areas are on; an empty list turns every area off", () => {
  assert.deepEqual(on("profile,live"), ["profile", "live"])
  assert.deepEqual(on(" profile , badges "), ["profile", "badges"])
  assert.deepEqual(on(""), [])
  assert.deepEqual(on("nothing,of,the,kind"), [])
})

test("live games and payments work without the profile", () => {
  assert.deepEqual(on("live,payments"), ["payments", "live"])
})

test("an area whose profile is off is off, however it is named", () => {
  assert.deepEqual(on("sync,clubs,badges,devices,tournaments"), [])
  assert.deepEqual(on("profile,clubs,tournaments"), ["profile", "clubs", "tournaments"])
})

test("devices also need sync: they hand over its data key and pull the history", () => {
  assert.deepEqual(on("profile,devices"), ["profile"])
  assert.deepEqual(on("profile,sync,devices"), ["profile", "sync", "devices"])
})
