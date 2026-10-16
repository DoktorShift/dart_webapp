import { outboxStatus } from "../../lib/sync/outbox.ts"

// Publishing is local-first: submitOwn keeps the signed events and the outbox sends them without
// anyone waiting (lib/sync/publish.ts). A test that reads the fake relays right after a change
// waits here until every queued event was tried on each of its relays (or gives up after a
// while and lets the assertion say what is missing).
export async function outboxTried(timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const entries = await outboxStatus()
    if (entries.every((e) => e.results.length >= e.relays.length)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
