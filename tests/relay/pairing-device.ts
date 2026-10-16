// The new device for tests/relay/devices.test.ts: its own memory and database, in a worker
// thread. It shows its codes, confirms or declines when told, takes the profile, and can
// "reload" (close its screen and resume from what it stored).
import { parentPort, workerData } from "node:worker_threads"
import "../storage-helpers.ts"
import type { NewDeviceControl, NewDevicePairing } from "../../lib/devices/pairing.ts"
import { getSession } from "../../lib/profile/session.ts"
import { dbKeys } from "../../lib/storage/db.ts"

// Read whenever the pairing picks its relays.
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = workerData.relay

type Command = { type: "start" } | { type: "confirm" } | { type: "decline" } | { type: "reload" } | { type: "close" } | { type: "session" } | { type: "pending" }

let control: NewDeviceControl | null = null

async function start() {
  const { pairNewDevice } = await import("../../lib/devices/pairing.ts")
  control = await pairNewDevice((state, offline) => parentPort!.postMessage({ type: "state", state: plain(state), offline }))
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
  } else if (command.type === "session") parentPort!.postMessage({ type: "session", session: getSession() })
  else if (command.type === "pending") void dbKeys("pending").then((ids) => parentPort!.postMessage({ type: "pending", ids }))
})

parentPort!.postMessage({ type: "ready" })
