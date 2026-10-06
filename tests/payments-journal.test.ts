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
  resolveByHand,
  type Lookup,
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
// The wallet connection that pays in these tests, and another one (another wallet, or the same
// wallet connected anew).
const CONNECTION = "wallet-a:app-1"
const OTHER_CONNECTION = "wallet-b:app-2"

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
    connection: CONNECTION,
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

// What a page that closed while paying left behind: an entry still "sending", whose lock is free.
async function leftSending(): Promise<PaymentEntry> {
  const { checked } = await scannedInvoice(newInvoice(), 500_000)
  const entry: PaymentEntry = {
    id: checked.paymentHash,
    direction: "out",
    action: "stake:m1",
    once: true,
    state: "sending",
    amountMsat: 500_000,
    counterpart: MIA,
    via: "invoice",
    invoice: checked.invoice,
    expiresAt: checked.expiresAt,
    connection: CONNECTION,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
  }
  await dbPut("payments", entry)
  return entry
}

// The stored entry with its invoice run out.
async function expire(entry: PaymentEntry) {
  const expired: PaymentEntry = { ...entry, expiresAt: now() - 1 }
  await dbPut("payments", expired)
}

test("the entry is written before the wallet is asked, then holds the wallet's answer", async () => {
  const invoice = newInvoice()
  const { request } = requestFor(invoice)
  let seenWhilePaying: PaymentEntry | undefined
  const entry = entryOf(
    await pay(request, {
      connection: CONNECTION,
      payInvoice: async () => {
        seenWhilePaying = (await loadJournal())[0]
        return { feesMsat: 2000 }
      },
    }),
  )
  assert.equal(seenWhilePaying?.state, "sending")
  assert.equal(seenWhilePaying?.invoice, invoice)
  assert.equal(seenWhilePaying?.connection, CONNECTION)
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
  await leftSending()
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
      connection: CONNECTION,
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

const unknownEntry: PaymentEntry = {
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
  connection: CONNECTION,
  createdAt: 0,
  updatedAt: 0,
}
const beforeExpiry = 999_000
const afterExpiry = 1_001_000

test("after a lookup: settled is paid, unseen and expired is failed, anything else stays unknown", () => {
  const base = unknownEntry
  assert.equal(afterLookup(base, { state: "settled", feesMsat: 0 }, CONNECTION, beforeExpiry).state, "paid")
  assert.equal(afterLookup(base, { state: "failed", feesMsat: null }, CONNECTION, beforeExpiry).state, "failed")
  assert.equal(afterLookup(base, { state: "pending", feesMsat: null }, CONNECTION, afterExpiry).state, "unknown")
  assert.equal(afterLookup(base, "not-found", CONNECTION, beforeExpiry).state, "unknown")
  const late = afterLookup(base, "not-found", CONNECTION, afterExpiry)
  assert.deepEqual([late.state, late.problem], ["failed", "expired"])

  const incoming = { ...base, direction: "in" as const, state: "waiting" as const }
  assert.equal(afterLookup(incoming, { state: "settled", feesMsat: 0 }, CONNECTION, afterExpiry).state, "received")
  assert.equal(afterLookup(incoming, { state: "pending", feesMsat: null }, CONNECTION, beforeExpiry).state, "waiting")
  assert.equal(afterLookup(incoming, { state: "pending", feesMsat: null }, CONNECTION, afterExpiry).state, "expired")
})

test("another wallet connection can confirm a payment, never rule one out", () => {
  // Only the connection that paid knows what it did (NIP-47 lookup_invoice): a new connection,
  // after "Verbindung entfernen", doesn't know the old one's payments.
  for (const status of ["not-found", { state: "failed", feesMsat: null }, { state: "pending", feesMsat: null }] as const) {
    assert.deepEqual(afterLookup(unknownEntry, status, OTHER_CONNECTION, afterExpiry), unknownEntry)
  }
  assert.equal(afterLookup(unknownEntry, { state: "settled", feesMsat: 0 }, OTHER_CONNECTION, afterExpiry).state, "paid")
  const incoming = { ...unknownEntry, direction: "in" as const, state: "waiting" as const }
  assert.equal(afterLookup(incoming, "not-found", OTHER_CONNECTION, afterExpiry).state, "waiting")
  assert.equal(afterLookup(incoming, { state: "settled", feesMsat: 0 }, OTHER_CONNECTION, afterExpiry).state, "received")
})

test("Status prüfen through another connection after the invoice expired: still unknown, and the stake stays blocked", async () => {
  const unknown = entryOf(await pay(requestFor(newInvoice()).request, wallet("no-answer")))
  assert.equal(unknown.connection, CONNECTION)
  // The invoice runs out; then another wallet is connected and asked.
  await expire(unknown)
  const other: Lookup = {
    connection: OTHER_CONNECTION,
    lookupInvoice: async () => {
      throw new WalletError("not-found", "NOT_FOUND")
    },
  }
  assert.equal(entryOf(await checkStatus(unknown.id, other)).state, "unknown")
  const retry = requestFor(newInvoice())
  assert.equal(entryOf(await pay(retry.request, wallet())).id, unknown.id)
  assert.equal(retry.asked.count, 0, "no new invoice while the outcome is open")
  // The connection that paid can say it never saw it.
  const ruledOut = entryOf(await checkStatus(unknown.id, { ...other, connection: CONNECTION }))
  assert.deepEqual([ruledOut.state, ruledOut.problem], ["failed", "expired"])
})

test("Status prüfen on a payment a closed page left sending: unknown, then the wallet's answer", async () => {
  const left = await leftSending()
  const pending: Lookup = { connection: CONNECTION, lookupInvoice: async () => ({ state: "pending", feesMsat: null }) }
  assert.equal(entryOf(await checkStatus(left.id, pending)).state, "unknown")
})

test("Status prüfen without a wallet that can look up: a payment left sending becomes unknown, nothing else changes", async () => {
  const orphan = await leftSending()
  assert.equal(entryOf(await checkStatus(orphan.id, null)).state, "unknown")
  assert.equal(entryOf(await checkStatus(orphan.id, null)).state, "unknown")
})

test("the same invoice from two actions at once is paid once", async () => {
  const invoice = newInvoice()
  const w = wallet()
  const results = await Promise.all([pay(requestFor(invoice, "single:a", false).request, w), pay(requestFor(invoice, "single:b", false).request, w)])
  assert.deepEqual(w.paid, [invoice])
  const [entry] = await loadJournal()
  assert.equal(entry.state, "paid")
  for (const result of results) assert.ok(result === "busy" || result.id === entry.id)
})

test("cancelled while the invoice was being fetched: nothing written, nothing paid", async () => {
  const controller = new AbortController()
  const w = wallet()
  const request: PaymentRequest = {
    action: "pay:m1:p2",
    once: false,
    counterpart: MIA,
    signal: controller.signal,
    invoice: async () => {
      controller.abort()
      return scannedInvoice(newInvoice(), 500_000)
    },
  }
  await assert.rejects(pay(request, w), { name: "AbortError" })
  assert.equal(w.paid.length, 0)
  assert.deepEqual(await loadJournal(), [])
})

test("settled by hand: paid as the wallet shows it, kept apart from the wallet's answer", async () => {
  const unknown = entryOf(await pay(requestFor(newInvoice()).request, wallet("no-answer")))
  const paid = entryOf(await resolveByHand(unknown.id, "done"))
  assert.deepEqual([paid.state, paid.resolvedByHand], ["paid", true])
  // The stake is done.
  const attempt = requestFor(newInvoice())
  assert.equal(entryOf(await pay(attempt.request, wallet())).id, unknown.id)
  assert.equal(attempt.asked.count, 0)
})

test("not paid by hand only once the invoice has expired; then it can be paid anew", async () => {
  const unknown = entryOf(await pay(requestFor(newInvoice()).request, wallet("no-answer")))
  await assert.rejects(resolveByHand(unknown.id, "not-done"))
  assert.equal((await loadJournal())[0].state, "unknown")
  const failed = entryOf(await resolveByHand(unknown.id, "not-done", (unknown.expiresAt! + 1) * 1000))
  assert.deepEqual([failed.state, failed.problem, failed.resolvedByHand], ["failed", "expired", true])
  const w = wallet()
  assert.equal(entryOf(await pay(requestFor(newInvoice()).request, w)).state, "paid")
  assert.equal(w.paid.length, 1)
})

test("an invoice shown to be paid can be settled by hand too: received, or after it expired not received", async () => {
  const shown = await recordIncoming({ id: "cd".repeat(32), action: "receive:m1", once: true, amountMsat: 500_000, counterpart: { name: "Tom" }, via: "invoice", invoice: "lnbc1", expiresAt: now() + 600, connection: CONNECTION })
  assert.equal(entryOf(await resolveByHand(shown.id, "done")).state, "received")
  const other = await recordIncoming({ id: "ef".repeat(32), action: "receive:m2", once: true, amountMsat: 500_000, counterpart: { name: "Tom" }, via: "invoice", invoice: "lnbc1", expiresAt: now() - 1, connection: CONNECTION })
  const expired = entryOf(await resolveByHand(other.id, "not-done"))
  assert.deepEqual([expired.state, expired.problem], ["expired", undefined])
})

test("an invoice shown to be paid stops the same stake from being paid on this device", async () => {
  await recordIncoming({ id: "ab".repeat(32), action: "stake:m1", once: true, amountMsat: 500_000, counterpart: { name: "Tom" }, via: "invoice", invoice: "lnbc1", expiresAt: now() + 600, connection: CONNECTION })
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

const webLocks = { skip: typeof navigator === "undefined" || !navigator.locks }

// A second "tab": a worker thread with its own database, sharing this process's Web Locks. It pays
// `invoice` for `action` and holds the wallet's answer until released; it must have paid then.
async function payingTab(action: string, invoice: string) {
  const tab = new Worker(new URL("./support/payment-tab.ts", import.meta.url), { workerData: { action, invoice } })
  const message = (type: string) => new Promise<unknown>((resolve) => tab.on("message", (m: { type: string; value?: unknown }) => m.type === type && resolve(m.value)))
  const finished = message("finished")
  await message("paying")
  return {
    async release() {
      tab.postMessage("release")
      const result = await finished
      await tab.terminate()
      assert.equal(result, "paid")
    },
  }
}

test("another tab paying the same action: this one doesn't ask its wallet", webLocks, async () => {
  const tab = await payingTab("stake:m1", newInvoice())
  const w = wallet()
  const result = await pay(requestFor(newInvoice()).request, w).finally(tab.release)
  assert.equal(result, "busy")
  assert.equal(w.paid.length, 0)
})

test("another tab paying the same invoice for another action: this one doesn't ask its wallet", webLocks, async () => {
  const invoice = newInvoice()
  const tab = await payingTab("single:a", invoice)
  const w = wallet()
  const result = await pay(requestFor(invoice, "single:b", false).request, w).finally(tab.release)
  assert.equal(result, "busy")
  assert.equal(w.paid.length, 0)
  assert.equal((await loadJournal()).length, 0, "the other tab's entry is in its own database")
})
