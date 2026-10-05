// The payment journal (PLAN.md "Freiwillige Zaps", Zustände; decision 0002 §8): one entry per
// invoice in IndexedDB "payments", written before the wallet is asked to pay, so that a double
// tap, a second tab, a restart or a late answer never pays anything twice.
//
// - An entry's id is the invoice's payment hash: this app pays an invoice at most once.
// - Every entry belongs to an action, what the person did: the stake of one game, a
//   congratulation, one scanned invoice. While a payment for an action is open, no new invoice
//   is fetched or paid for it, and a one-off action (a stake) stays done once it is paid.
// - Paying holds a lock named after the action (Web Locks, so across tabs) until the wallet has
//   answered. An entry still "sending" whose lock is free was left by a page that closed: its
//   outcome is unknown.
// - An unknown outcome is cleared up only by asking the wallet (lookup by payment hash), never by
//   paying again. An expired invoice that the wallet never saw can no longer be paid: failed.
//
// The journal is this device's record, like its games: it isn't part of the profile, a backup or
// an export, and only "Alle Daten löschen" removes it.
import type { InvoiceStatus } from "../nostr/wallet.ts"
import { WalletError, type WalletErrorCode } from "../nostr/wallet.ts"
import type { CheckedInvoice } from "../nostr/ext/lnurl.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { dbGet, dbGetAll, dbWrite, type Keyed } from "../storage/db.ts"

export type PaymentState =
  // Outgoing. "sending": handed to the wallet, no answer yet ("Zahlung läuft").
  | "sending"
  | "paid"
  // The wallet refused, or the invoice expired unpaid. Nothing left the wallet.
  | "failed"
  // No definite answer: it may have been paid ("Status unbekannt").
  | "unknown"
  // Incoming. "waiting": the invoice is out ("Warte auf Zahlung").
  | "waiting"
  | "received"
  | "expired"

// Why a payment failed or is unknown: the wallet's answer, or "expired" (the invoice ran out).
export type PaymentProblem = WalletErrorCode | "expired"

export interface Counterpart {
  name: string
  pubkey?: string
}

// What a zap needs after paying: the request it answers and who may sign its receipt.
export interface ZapRecord {
  // The signed zap request (kind 9734).
  request: NostrEvent
  // The recipient's Lightning service: the only key whose receipt counts.
  zapPubkey: string
  // Where the service publishes the receipt.
  relays: string[]
  // The checked receipt's id, once one arrived.
  receipt: string | null
}

export interface PaymentEntry extends Keyed {
  // The invoice's payment hash; "manual:<action>" for a payment settled outside the app.
  id: string
  direction: "out" | "in"
  action: string
  // A one-off action (a stake) is done once paid; others only wait while a payment is open.
  once: boolean
  state: PaymentState
  amountMsat: number
  counterpart: Counterpart
  // How it was paid: a shown invoice, a Lightning address, a zap, or "vor Ort erledigt".
  via: "invoice" | "address" | "zap" | "manual"
  invoice: string | null
  // When the invoice runs out (seconds).
  expiresAt: number | null
  // The Lightning address it was paid to.
  address?: string
  // Unknown until the wallet says; null when it didn't.
  feesMsat?: number | null
  problem?: PaymentProblem
  zap?: ZapRecord
  createdAt: number
  updatedAt: number
}

const OPEN: ReadonlySet<PaymentState> = new Set(["sending", "unknown", "waiting"])
const DONE: ReadonlySet<PaymentState> = new Set(["paid", "received"])

export const isOpen = (entry: PaymentEntry) => OPEN.has(entry.state)
export const isDone = (entry: PaymentEntry) => DONE.has(entry.state)

// The entry that stops a new payment for this action: one still open, or a one-off already done.
export function blockingEntry(entries: readonly PaymentEntry[], action: string): PaymentEntry | null {
  return entries.find((entry) => entry.action === action && (isOpen(entry) || (entry.once && isDone(entry)))) ?? null
}

// Every entry, newest first.
export async function loadJournal(): Promise<PaymentEntry[]> {
  const entries = await dbGetAll<PaymentEntry>("payments")
  return entries.sort((a, b) => b.createdAt - a.createdAt)
}

async function save(entry: PaymentEntry, now = Date.now()): Promise<PaymentEntry> {
  const saved = { ...entry, updatedAt: now }
  await dbWrite([{ store: "payments", put: saved }])
  return saved
}

// ---- Locks ------------------------------------------------------------------------------------

const LOCK_PREFIX = "blueline.payment:"
const heldHere = new Set<string>()

// Runs `task` holding the lock of `action` in every tab of this app; null right away when it is
// held already, here or elsewhere. Without Web Locks (Safari before 15.4) only this page is
// covered; the journal entry written before paying still stops the other tabs.
async function exclusive<T>(action: string, task: () => Promise<T>): Promise<T | null> {
  if (heldHere.has(action)) return null
  heldHere.add(action)
  try {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks
    if (!locks) return await task()
    return await locks.request(LOCK_PREFIX + action, { ifAvailable: true }, (lock) => (lock ? task() : null))
  } finally {
    heldHere.delete(action)
  }
}

// ---- Paying -------------------------------------------------------------------------------------

export interface Payer {
  payInvoice(invoice: string): Promise<{ feesMsat: number | null }>
}

export interface InvoiceSource {
  checked: CheckedInvoice
  via: "invoice" | "address" | "zap"
  address?: string
  zap?: ZapRecord
}

export interface PaymentRequest {
  action: string
  once: boolean
  counterpart: Counterpart
  // The checked invoice to pay. Called only when nothing for this action is open, so no new
  // invoice is ever fetched while an earlier payment's outcome is unknown. May throw.
  invoice: () => Promise<InvoiceSource>
}

// Pays once for an action and returns the journal entry: the new payment's, or the earlier one
// that stops it ("Zahlung läuft", paid, unknown). "busy": this action is being paid in another
// tab right now.
export async function pay(request: PaymentRequest, payer: Payer): Promise<PaymentEntry | "busy"> {
  const result = await exclusive(request.action, async () => {
    const entries = await loadJournal()
    const earlier = blockingEntry(entries, request.action)
    // Holding the lock, an entry still "sending" can only be from a page that closed meanwhile.
    if (earlier) return earlier.state === "sending" ? save({ ...earlier, state: "unknown" }) : earlier
    const { checked, via, address, zap } = await request.invoice()
    const known = entries.find((entry) => entry.id === checked.paymentHash)
    if (known && known.state !== "failed") return known
    const now = Date.now()
    const entry = await save(
      {
        id: checked.paymentHash,
        direction: "out",
        action: request.action,
        once: request.once,
        state: "sending",
        amountMsat: checked.amountMsat,
        counterpart: request.counterpart,
        via,
        invoice: checked.invoice,
        expiresAt: checked.expiresAt,
        ...(address ? { address } : {}),
        ...(zap ? { zap } : {}),
        createdAt: known?.createdAt ?? now,
        updatedAt: now,
      },
      now,
    )
    try {
      const { feesMsat } = await payer.payInvoice(checked.invoice)
      return save({ ...entry, state: "paid", feesMsat, problem: undefined })
    } catch (error) {
      // Anything but a definite answer from the wallet may have paid.
      const problem: WalletErrorCode = error instanceof WalletError ? error.code : "no-answer"
      return save({ ...entry, state: problem === "no-answer" ? "unknown" : "failed", problem })
    }
  })
  return result ?? "busy"
}

// ---- Clearing up ---------------------------------------------------------------------------------

// The entry after the wallet's answer to a lookup ("not-found": it doesn't know the invoice).
export function afterLookup(entry: PaymentEntry, status: InvoiceStatus | "not-found", nowMs = Date.now()): PaymentEntry {
  const expired = entry.expiresAt !== null && nowMs / 1000 >= entry.expiresAt
  const state = status === "not-found" ? null : status.state
  if (entry.direction === "out") {
    if (state === "settled") return { ...entry, state: "paid", feesMsat: status === "not-found" ? null : status.feesMsat, problem: undefined }
    if (state === "failed") return { ...entry, state: "failed", problem: "failed" }
    // Never seen by the wallet and too late to be paid now.
    if (status === "not-found" && expired) return { ...entry, state: "failed", problem: "expired" }
    return { ...entry, state: "unknown" }
  }
  if (state === "settled") return { ...entry, state: "received" }
  return { ...entry, state: expired ? "expired" : "waiting" }
}

export interface Lookup {
  lookupInvoice(paymentHash: string): Promise<InvoiceStatus>
}

// "Status prüfen": asks the wallet about an open entry and records the answer. "busy": the
// payment is still being sent in another tab. Throws WalletError when the wallet can't be asked.
export async function checkStatus(id: string, wallet: Lookup): Promise<PaymentEntry | "busy" | null> {
  const current = await dbGet<PaymentEntry>("payments", id)
  if (!current?.invoice || !isOpen(current)) return current ?? null
  const result = await exclusive(current.action, async () => {
    const entry = await dbGet<PaymentEntry>("payments", id)
    if (!entry?.invoice || !isOpen(entry)) return entry ?? null
    let status: InvoiceStatus | "not-found"
    try {
      status = await wallet.lookupInvoice(entry.id)
    } catch (error) {
      if (!(error instanceof WalletError && error.code === "not-found")) throw error
      status = "not-found"
    }
    const next = afterLookup(entry, status)
    return next.state === entry.state ? entry : save(next)
  })
  return result ?? "busy"
}

// Entries a closed page left "sending" become unknown. One this page or another open tab is
// still sending holds its lock and is left alone.
export async function recoverInterrupted(): Promise<void> {
  const sending = (await loadJournal()).filter((entry) => entry.state === "sending")
  await Promise.all(
    sending.map((entry) =>
      exclusive(entry.action, async () => {
        const fresh = await dbGet<PaymentEntry>("payments", entry.id)
        if (fresh?.state === "sending") await save({ ...fresh, state: "unknown" })
      }),
    ),
  )
}

// ---- Receiving and notes ---------------------------------------------------------------------------

// An invoice this device shows to be paid ("Empfangen"). Kept while it can be paid, so it is
// shown again instead of being replaced.
export async function recordIncoming(entry: Omit<PaymentEntry, "direction" | "state" | "createdAt" | "updatedAt">): Promise<PaymentEntry> {
  const now = Date.now()
  return save({ ...entry, direction: "in", state: "waiting", createdAt: now, updatedAt: now }, now)
}

// An incoming invoice that turned out paid (a notification from the wallet).
export async function markReceived(id: string): Promise<void> {
  const entry = await dbGet<PaymentEntry>("payments", id)
  if (entry?.direction === "in" && entry.state === "waiting") await save({ ...entry, state: "received" })
}

// "Vor Ort erledigt": the players settled a one-off action outside the app. Kept apart from a
// payment the wallet confirmed (via "manual"). False when a payment for it is open or done.
export async function noteSettled(note: { action: string; direction: "out" | "in"; amountMsat: number; counterpart: Counterpart }): Promise<boolean> {
  const done = await exclusive(note.action, async () => {
    if (blockingEntry(await loadJournal(), note.action)) return false
    const now = Date.now()
    await save(
      {
        id: `manual:${note.action}`,
        direction: note.direction,
        action: note.action,
        once: true,
        state: note.direction === "out" ? "paid" : "received",
        amountMsat: note.amountMsat,
        counterpart: note.counterpart,
        via: "manual",
        invoice: null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
      now,
    )
    return true
  })
  return done ?? false
}

// Records the checked receipt of a zap. Only the recipient's Lightning service signs one, after
// the invoice was paid: an unknown outcome becomes paid. Left for later while the payment is
// still being sent (the caller tries again with the next receipt or check).
export async function recordReceipt(id: string, receipt: string): Promise<PaymentEntry | null> {
  const entry = await dbGet<PaymentEntry>("payments", id)
  if (!entry?.zap || entry.zap.receipt) return entry ?? null
  const result = await exclusive(entry.action, async () => {
    const fresh = await dbGet<PaymentEntry>("payments", id)
    if (!fresh?.zap || fresh.zap.receipt) return fresh ?? null
    return save({ ...fresh, state: "paid", problem: undefined, zap: { ...fresh.zap, receipt } })
  })
  return result ?? entry
}
