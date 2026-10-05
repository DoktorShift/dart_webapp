import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { Worker } from "node:worker_threads"
import { randomBytes } from "@noble/hashes/utils.js"
import { resetStorage } from "./storage-helpers.ts"
import { encodeInvoice } from "./support/bolt11.ts"
import { WalletError, type WalletErrorCode } from "../lib/nostr/wallet.ts"
import { closeDatabase, dbGet, dbPut } from "../lib/storage/db.ts"
import { scannedInvoice } from "../lib/payments/invoices.ts"
import {
  afterLookup,
  checkStatus,
  loadJournal,
  noteSettled,
  pay,
  recordIncoming,
  recoverInterrupted,
  type PaymentEntry,
  type PaymentRequest,
} from "../lib/payments/journal.ts"

// The payment journal (PLAN.md "Freiwillige Zaps", Zustände): written before paying, one payment
// per invoice and per open action, never a second payment while an outcome is unknown, and the
// same after a restart or from another tab.

beforeEach(resetStorage)

const nodeKey = randomBytes(32)
const now = () => Math.floor(Date.now() / 1000)
const newInvoice = (amountMsat = 500_000, expirySeconds = 600) => encodeInvoice({ amountMsat, timestamp: now(), expirySeconds, paymentHash: randomBytes(32), nodeKey })

const MIA = { name: "Mia" }

// A request for one invoice, counting how often the invoice was asked for.
function requestFor(invoice: string, action = "stake:m1", once = true) {
  const asked = { count: 0 }
  const request: PaymentRequest = {
    action,
    once,
    counterpart: MIA,
    invoice: async () => {
      asked.count += 1
      return scannedInvoice(invoice, 500_000)
    },
  }
  return { request, asked }
}

// A wallet that pays (or fails with `fail`), counting the invoices it was asked to pay.
function wallet(fail?: WalletErrorCode) {
  const paid: string[] = []
  return {
    paid,
    payInvoice: async (invoice: string) => {
      paid.push(invoice)
      if (fail) throw new WalletError(fail, fail)
      return { feesMsat: 1000 }
    },
  }
}

const entryOf = (result: PaymentEntry | "busy" | null) => {
  assert.ok(result && result !== "busy", "expected a journal entry")
  return result
}

test("the entry is written before the wallet is asked, then holds the wallet's answer", async () => {
  const invoice = newInvoice()
  const { request } = requestFor(invoice)
  let seenWhilePaying: PaymentEntry | undefined
  const entry = entryOf(
    await pay(request, {
      payInvoice: async () => {
        seenWhilePaying = (await loadJournal())[0]
        return { feesMsat: 2000 }
      },
    }),
  )
  assert.equal(seenWhilePaying?.state, "sending")
  assert.equal(seenWhilePaying?.invoice, invoice)
  assert.equal(entry.state, "paid")
  assert.equal(entry.feesMsat, 2000)
  assert.equal(entry.amountMsat, 500_000)
  assert.deepEqual(await dbGet("payments", entry.id), entry)
})

test("a double tap pays once", async () => {
  const { request } = requestFor(newInvoice())
  const w = wallet()
  const results = await Promise.all([pay(request, w), pay(request, w)])
  assert.equal(w.paid.length, 1)
  assert.deepEqual(results.map((r) => (r === "busy" ? r : r.state)).sort(), ["busy", "paid"])
})

test("the same invoice is never paid twice, even for another action", async () => {
  const invoice = newInvoice()
  const w = wallet()
  const first = entryOf(await pay(requestFor(invoice, "invoice:a").request, w))
  const second = entryOf(await pay(requestFor(invoice, "invoice:b").request, w))
  assert.equal(w.paid.length, 1)
  assert.equal(second.id, first.id)
  assert.equal(second.action, "invoice:a")
})

test("a stake is done once paid; a congratulation can be paid again", async () => {
  const w = wallet()
  entryOf(await pay(requestFor(newInvoice(), "stake:m1", true).request, w))
  const stakeAgain = requestFor(newInvoice(), "stake:m1", true)
  assert.equal(entryOf(await pay(stakeAgain.request, w)).state, "paid")
  assert.equal(stakeAgain.asked.count, 0, "no new invoice is fetched for a paid stake")

  entryOf(await pay(requestFor(newInvoice(), "zap:mia", false).request, w))
  const zapAgain = requestFor(newInvoice(), "zap:mia", false)
  assert.equal(entryOf(await pay(zapAgain.request, w)).state, "paid")
  assert.equal(zapAgain.asked.count, 1)
  assert.equal(w.paid.length, 3)
})

test("no new invoice and no new payment while an outcome is unknown", async () => {
  const silent = wallet("no-answer")
  const unknown = entryOf(await pay(requestFor(newInvoice()).request, silent))
  assert.equal(unknown.state, "unknown")
  assert.equal(unknown.problem, "no-answer")

  const retry = requestFor(newInvoice())
  const w = wallet()
  const shown = entryOf(await pay(retry.request, w))
  assert.equal(shown.id, unknown.id)
  assert.equal(shown.state, "unknown")
  assert.equal(retry.asked.count, 0)
  assert.equal(w.paid.length, 0)
})

test("a refused payment can be tried again, with the same invoice", async () => {
  const invoice = newInvoice()
  const failed = entryOf(await pay(requestFor(invoice).request, wallet("insufficient")))
  assert.equal(failed.state, "failed")
  assert.equal(failed.problem, "insufficient")
  const w = wallet()
  const paid = entryOf(await pay(requestFor(invoice).request, w))
  assert.equal(paid.state, "paid")
  assert.equal(paid.id, failed.id)
  assert.equal(paid.problem, undefined)
  assert.deepEqual(w.paid, [invoice])
})

test("an invoice that fails its checks is never paid and leaves no entry", async () => {
  const w = wallet()
  const wrongAmount = requestFor(newInvoice(400_000))
  await assert.rejects(pay(wrongAmount.request, w), { name: "InvoiceError", problem: "amount" })
  const expired = encodeInvoice({ amountMsat: 500_000, timestamp: now() - 3600, expirySeconds: 600, paymentHash: randomBytes(32), nodeKey })
  await assert.rejects(pay(requestFor(expired).request, w), { name: "InvoiceError", problem: "expired" })
  assert.equal(w.paid.length, 0)
  assert.deepEqual(await loadJournal(), [])
})

test("journal across a restart: a page that closed while paying leaves the outcome unknown", async () => {
  const invoice = newInvoice()
  const left = await scannedInvoice(invoice, 500_000)
  // What a page that closed mid-payment left behind.
  const orphan: PaymentEntry = {
    id: left.checked.paymentHash,
    direction: "out",
    action: "stake:m1",
    once: true,
    state: "sending",
    amountMsat: 500_000,
    counterpart: MIA,
    via: "invoice",
    invoice,
    expiresAt: left.checked.expiresAt,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
  }
  await dbPut("payments", orphan)
  await closeDatabase()

  await recoverInterrupted()
  const [entry] = await loadJournal()
  assert.equal(entry.state, "unknown")
  const w = wallet()
  assert.equal(entryOf(await pay(requestFor(newInvoice()).request, w)).state, "unknown")
  assert.equal(w.paid.length, 0)
})

test("Status prüfen: the wallet's answer settles an unknown payment", async () => {
  const unknown = entryOf(await pay(requestFor(newInvoice()).request, wallet("no-answer")))
  const lookups: string[] = []
  const checked = entryOf(
    await checkStatus(unknown.id, {
      lookupInvoice: async (hash) => {
        lookups.push(hash)
        return { state: "settled", feesMsat: 1000 }
      },
    }),
  )
  assert.deepEqual(lookups, [unknown.id])
  assert.equal(checked.state, "paid")
  assert.equal(checked.feesMsat, 1000)
})

test("after a lookup: settled is paid, unseen and expired is failed, anything else stays unknown", () => {
  const base: PaymentEntry = {
    id: "h",
    direction: "out",
    action: "a",
    once: true,
    state: "unknown",
    amountMsat: 1000,
    counterpart: MIA,
    via: "invoice",
    invoice: "lnbc1",
    expiresAt: 1000,
    createdAt: 0,
    updatedAt: 0,
  }
  const before = 999_000
  const after = 1_001_000
  assert.equal(afterLookup(base, { state: "settled", feesMsat: 0 }, before).state, "paid")
  assert.equal(afterLookup(base, { state: "failed", feesMsat: null }, before).state, "failed")
  assert.equal(afterLookup(base, { state: "pending", feesMsat: null }, after).state, "unknown")
  assert.equal(afterLookup(base, "not-found", before).state, "unknown")
  const late = afterLookup(base, "not-found", after)
  assert.deepEqual([late.state, late.problem], ["failed", "expired"])

  const incoming = { ...base, direction: "in" as const, state: "waiting" as const }
  assert.equal(afterLookup(incoming, { state: "settled", feesMsat: 0 }, after).state, "received")
  assert.equal(afterLookup(incoming, { state: "pending", feesMsat: null }, before).state, "waiting")
  assert.equal(afterLookup(incoming, { state: "pending", feesMsat: null }, after).state, "expired")
})

test("an invoice shown to be paid stops the same stake from being paid on this device", async () => {
  await recordIncoming({ id: "ab".repeat(32), action: "stake:m1", once: true, amountMsat: 500_000, counterpart: { name: "Tom" }, via: "invoice", invoice: "lnbc1", expiresAt: now() + 600 })
  const attempt = requestFor(newInvoice())
  assert.equal(entryOf(await pay(attempt.request, wallet())).state, "waiting")
  assert.equal(attempt.asked.count, 0)
})

test("vor Ort erledigt: noted apart from a paid stake, and it ends the stake", async () => {
  assert.equal(await noteSettled({ action: "stake:m1", direction: "out", amountMsat: 500_000, counterpart: MIA }), true)
  const [note] = await loadJournal()
  assert.deepEqual([note.state, note.via, note.invoice], ["paid", "manual", null])
  const attempt = requestFor(newInvoice())
  assert.equal(entryOf(await pay(attempt.request, wallet())).via, "manual")
  assert.equal(attempt.asked.count, 0)
  // Not while a payment for it is open.
  await pay(requestFor(newInvoice(), "stake:m2").request, wallet("no-answer"))
  assert.equal(await noteSettled({ action: "stake:m2", direction: "out", amountMsat: 500_000, counterpart: MIA }), false)
})

test("another tab paying the same action: this one doesn't ask its wallet", { skip: typeof navigator === "undefined" || !navigator.locks }, async () => {
  // A second "tab": a worker thread with its own database, sharing this process's Web Locks.
  const tab = new Worker(new URL("./support/payment-tab.ts", import.meta.url), { workerData: { action: "stake:m1" } })
  const message = (type: string) => new Promise<unknown>((resolve) => tab.on("message", (m: { type: string; value?: unknown }) => m.type === type && resolve(m.value)))
  const paying = message("paying")
  const finished = message("finished")
  await paying
  const w = wallet()
  assert.equal(await pay(requestFor(newInvoice()).request, w), "busy")
  assert.equal(w.paid.length, 0)
  tab.postMessage("release")
  assert.equal(await finished, "paid")
  await tab.terminate()
})
