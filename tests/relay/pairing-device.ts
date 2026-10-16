// The new device for tests/relay/devices.test.ts: its own memory and database, in a worker
// thread. It shows its codes, confirms or declines when told, takes the profile, and can
// "reload" (close its screen and resume from what it stored). On "sync" it starts what the app
// runs in the background with a profile: the sync, and listing itself after its syncs. With
// workerData.stall it takes the package but never gets done with it (closed meanwhile).
import { parentPort, workerData } from "node:worker_threads"
import "../storage-helpers.ts"
import type { NewDeviceControl, NewDevicePairing } from "../../lib/devices/pairing.ts"
import { getSession } from "../../lib/profile/session.ts"
import { dbKeys } from "../../lib/storage/db.ts"

// Read whenever the pairing picks its relays.
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = workerData.relay

type Command = { type: "start" } | { type: "confirm" } | { type: "decline" } | { type: "reload" } | { type: "close" } | { type: "sync" } | { type: "session" } | { type: "pending" }

let control: NewDeviceControl | null = null

async function startBackground() {
  const [{ startSyncService }, { listSelfAfterSyncs }] = await Promise.all([import("../../lib/sync/service.ts"), import("../../lib/devices/list-self.ts")])
  listSelfAfterSyncs()
  startSyncService()
}

async function start() {
  const { pairNewDevice } = await import("../../lib/devices/pairing.ts")
  const options = workerData.stall ? { apply: () => new Promise<never>(() => {}) } : {}
  control = await pairNewDevice((state, offline) => parentPort!.postMessage({ type: "state", state: plain(state), offline }), options)
}

// What crosses the thread boundary must be plain data.
const plain = (state: NewDevicePairing) => JSON.parse(JSON.stringify(state))

parentPort!.on("message", (command: Command) => {
  if (command.type === "start") void start()
  else if (command.type === "confirm") control?.confirm()
  else if (command.type === "decline") control?.decline()
  else if (command.type === "close") {
    control?.close()
    control = null
  } else if (command.type === "reload") {
    control?.close()
    control = null
    void start()
  } else if (command.type === "sync") void startBackground()
  else if (command.type === "session") parentPort!.postMessage({ type: "session", session: getSession() })
  else if (command.type === "pending") void dbKeys("pending").then((ids) => parentPort!.postMessage({ type: "pending", ids }))
})

parentPort!.postMessage({ type: "ready" })
