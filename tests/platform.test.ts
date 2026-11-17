import { test } from "node:test"
import assert from "node:assert/strict"
import { isNativeApp, platform } from "../lib/platform.ts"
import { tabOn } from "../lib/shell/features.ts"
import { linkOrigin } from "../lib/shell/links.ts"
import { SITE } from "../lib/site.ts"

test("platform: only 'ios' makes the native app; unset or anything else is the website", () => {
  assert.equal(platform("ios"), "ios")
  assert.equal(platform(undefined), "web")
  assert.equal(platform("android"), "web")
  assert.equal(isNativeApp("ios"), true)
  assert.equal(isNativeApp("web"), false)
})

test("links: the iOS app builds them on the published site, never on capacitor://localhost", () => {
  assert.equal(linkOrigin("capacitor://localhost", true), SITE.url)
  assert.equal(linkOrigin("https://preview.example", false), "https://preview.example")
})

test("tabs: Clubs and Tournaments follow their areas, the others are always there", () => {
  const ios = "profile,sync,devices"
  assert.deepEqual(["play", "leaderboard", "clubs", "tournaments", "profile"].filter((tab) => tabOn(tab, ios)), ["play", "leaderboard", "profile"])
  assert.ok(["play", "leaderboard", "clubs", "tournaments", "profile"].every((tab) => tabOn(tab, undefined)))
})
