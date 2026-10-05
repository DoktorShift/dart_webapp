// A second browser tab for the payment journal tests: a worker thread with its own (fake)
// database that shares the process's Web Locks, like two tabs of one site share the browser's.
// It pays the action it is given and holds the wallet's answer until the test says "release".
import "fake-indexeddb/auto"
import { parentPort, workerData } from "node:worker_threads"
import { randomBytes } from "@noble/hashes/utils.js"
import { encodeInvoice } from "./bolt11.ts"
import { scannedInvoice } from "../../lib/payments/invoices.ts"
import { pay } from "../../lib/payments/journal.ts"

const port = parentPort!
const released = new Promise<void>((resolve) => port.once("message", () => resolve()))
const invoice = encodeInvoice({ amountMsat: 500_000, timestamp: Math.floor(Date.now() / 1000), expirySeconds: 600, paymentHash: randomBytes(32), nodeKey: randomBytes(32) })

void pay(
  { action: workerData.action, once: true, counterpart: { name: "Mia" }, invoice: () => scannedInvoice(invoice, 500_000) },
  {
    payInvoice: async () => {
      port.postMessage({ type: "paying" })
      await released
      return { feesMsat: 0 }
    },
  },
).then((result) => port.postMessage({ type: "finished", value: result === "busy" ? result : result.state }))
