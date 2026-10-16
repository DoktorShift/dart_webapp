"use client"

// Relative .ts paths: this also runs in the Node tests (tests/shell-outbox-start.test.ts).
import { registerStartTask } from "../../lib/shell/registry.ts"
import { dbKeys } from "../../lib/storage/db.ts"

// The one outbox (lib/sync/outbox.ts) holds what live games, clubs, tournaments and the sync
// queued, whichever areas a build switches on, so the shell starts it, not an area: what waits
// from before goes out again once the app is up. Loaded only when something waits; a guest with
// nothing queued never loads it. Afterwards, queueing something starts the sending by itself.
registerStartTask(() => {
  void dbKeys("outbox")
    .then(async (keys) => {
      if (keys.length > 0) await (await import("../../lib/sync/outbox.ts")).resumeOutbox()
    })
    .catch(() => {
      // The database can't be read now: the next thing queued starts the sending.
    })
})
