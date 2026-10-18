import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { FakeNetwork } from "./support/fake-relay.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { loadCore } from "../lib/nostr/core.ts"
import { runStartTasks } from "../lib/shell/registry.ts"
import { deliveryStatus, enqueue } from "../lib/sync/outbox.ts"

// The shell's own start task (components/shell/outbox-start.ts): what waits in the outbox from
// before is sent once the app is up, whichever areas the build switched on; with the sync off
// nothing else would start it before something new is queued.

const network = new FakeNetwork()
Object.assign(globalThis, { WebSocket: network.WebSocket })
const URLS = ["wss://one.example", "wss://two.example"]
const relays = URLS.map((url) => network.add(url))

before(resetStorage)
after(() => relayClient().close())

test("an event queued before the reload goes out at start, without the sync area", async () => {
  const core = await loadCore()
  const event = core.finalizeEvent({ kind: 1180, tags: [], content: "", created_at: 1_790_000_000 }, core.generateSecretKey())
  // Queued in the page before (Node has no document: nothing is sent by the queueing itself).
  await enqueue([{ event, relays: URLS }])
  assert.ok(relays.every((relay) => relay.events.length === 0))

  await import("../components/shell/outbox-start.ts")
  runStartTasks()
  const until = Date.now() + 5000
  while (!relays.every((relay) => relay.events.some((e) => e.id === event.id))) {
    if (Date.now() > until) assert.fail("still not sent")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(await deliveryStatus(event.id), null, "every relay has it")
})
