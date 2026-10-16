import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { REASONS } from "../lib/protocol/reasons.ts"
import { RECORD_TYPES } from "../lib/protocol/records.ts"

// docs/protocol is the contract other implementations read: it must name every record type and
// every rejection reason the code knows, and its links must lead somewhere.

const DOCS = fileURLToPath(new URL("../docs/protocol/", import.meta.url))
const read = (path: string) => readFileSync(resolve(DOCS, path), "utf8")

const FAMILIES = ["club", "tournament", "match-live", "match-result", "session-authorization", "board-join", "pairing", "private-records", "badges", "payment-request", "profile"]

test("every family has its contract", () => {
  for (const family of FAMILIES) assert.ok(existsSync(resolve(DOCS, `families/${family}.md`)), family)
  assert.deepEqual(readdirSync(resolve(DOCS, "families")).sort(), FAMILIES.map((f) => `${f}.md`).sort())
})

test("kinds.md lists every record type, and every type has its family contract", () => {
  const kinds = read("kinds.md")
  for (const type of Object.keys(RECORD_TYPES)) {
    assert.ok(kinds.includes(`\`${type}\``), `${type} in kinds.md`)
    const family = type.startsWith("club.") ? "club" : type.startsWith("tournament.") ? "tournament" : type === "match.live" ? "match-live" : type === "match.session" ? "session-authorization" : type === "payment.request" ? "payment-request" : type.startsWith("profile.") ? "profile" : type.startsWith("badge.") ? "badges" : "match-result"
    assert.ok(read(`families/${family}.md`).includes(`\`${type}`), `${type} in families/${family}.md`)
  }
  assert.match(kinds, /\*\*1180\*\*/)
  assert.match(kinds, /\*\*31180\*\*/)
  assert.match(kinds, /\*\*21180\*\*/)
  // The first draft 1501/31501/21501 is only mentioned as history.
  assert.doesNotMatch(kinds, /\*\*2?1?501\*\*|\*\*31501\*\*/)
})

test("conflicts.md explains every rejection reason", () => {
  const conflicts = read("conflicts.md")
  for (const reason of REASONS) assert.ok(conflicts.includes(`\`${reason}\``), reason)
})

test("relative links in docs/protocol resolve", () => {
  const files = ["README.md", "kinds.md", "permissions.md", "conflicts.md", "privacy.md", ...FAMILIES.map((f) => `families/${f}.md`)]
  for (const file of files) {
    for (const [, target] of read(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(target)) continue
      assert.ok(existsSync(resolve(dirname(resolve(DOCS, file)), target)), `${file} → ${target}`)
    }
  }
})
