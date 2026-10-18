import { test } from "node:test"
import assert from "node:assert/strict"
import { addDiagnostics, diagnosticsReport } from "../lib/profile/diagnostics.ts"
import { relayHost } from "../lib/profile/relay-status.ts"

// "Diagnose kopieren": the profile's part first, then what other areas add; a part that fails
// is left out instead of breaking the report.

test("the report joins the profile's part and the areas' parts as plain text", async () => {
  const removeSync = addDiagnostics(async () => ({ title: "Sync", lines: ["outbox: 0"] }))
  const removeBroken = addDiagnostics(() => {
    throw new Error("not available")
  })
  const report = await diagnosticsReport([{ title: "App", lines: ["BlueLine Darts 1.0.0"] }])
  assert.equal(report, "## App\nBlueLine Darts 1.0.0\n\n## Sync\noutbox: 0\n")
  removeSync()
  removeBroken()
  assert.equal(await diagnosticsReport([]), "\n")
})

test("relays read as their host", () => {
  assert.equal(relayHost("wss://nos.lol"), "nos.lol")
  assert.equal(relayHost("ws://127.0.0.1:18951"), "127.0.0.1:18951")
  assert.equal(relayHost("wss://relay.example.org/inbox"), "relay.example.org/inbox")
})
