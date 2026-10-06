// A second browser tab for the payment journal tests: a worker thread with its own (fake)
// database that shares the process's Web Locks, like two tabs of one site share the browser's.
// It pays the invoice and action it is given and holds the wallet's answer until the test says
// "release".
import "fake-indexeddb/auto"
import { parentPort, workerData } from "node:worker_threads"
import { scannedInvoice } from "../../lib/payments/invoices.ts"
import { pay } from "../../lib/payments/journal.ts"

const port = parentPort!
const released = new Promise<void>((resolve) => port.once("message", () => resolve()))
const { action, invoice } = workerData as { action: string; invoice: string }

void pay(
  { action, once: true, counterpart: { name: "Mia" }, invoice: () => scannedInvoice(invoice, 500_000) },
  {
    connection: "wallet-a:app-1",
    payInvoice: async () => {
      port.postMessage({ type: "paying" })
      await released
      return { feesMsat: 0 }
    },
  },
).then((result) => port.postMessage({ type: "finished", value: result === "busy" ? result : result.state }))
