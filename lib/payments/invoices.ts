// Where the invoice for a payment comes from, each one checked before anything is paid
// (PLAN.md "Bezahlen und Empfangen im Spiel"): one the other player's device shows ("Empfangen")
// and this one scans, or one fetched from the other player's Lightning address. A zap's invoice
// comes from ./zap.ts.
import { requestInvoice, type PayEndpoint } from "../nostr/ext/lnurl.ts"
import { checkInvoice, type InvoiceProblem } from "../nostr/ext/validate.ts"
import { parseWalletUri } from "../nostr/wallet.ts"
import type { InvoiceSource } from "./journal.ts"

// What a scanned or pasted text is. Each scanner takes only its own kind and names the others,
// so a wallet connection is never taken for something to pay (PLAN.md: verschiedene Prüfregeln).
export type ScanKind = "invoice" | "wallet" | "other"

const BOLT11 = /^ln(bc|tb|bcrt|tbs)[0-9a-z]{20,}$/

// The BOLT-11 invoice in a scanned text, in lower case: plain, as a lightning: link, or as the
// lightning part of a bitcoin: link (a unified payment code).
export function invoiceIn(text: string): string | null {
  let value = text.trim()
  if (/^bitcoin:/i.test(value)) {
    try {
      value = new URL(value).searchParams.get("lightning") ?? ""
    } catch {
      return null
    }
  }
  value = value.replace(/^lightning:/i, "").toLowerCase()
  return BOLT11.test(value) ? value : null
}

export function scanKind(text: string): ScanKind {
  if (invoiceIn(text)) return "invoice"
  if (parseWalletUri(text)) return "wallet"
  return "other"
}

// "no-amount": an invoice that leaves the amount to the payer, which this app doesn't pay.
export type ScanProblem = InvoiceProblem | "no-amount"

export class InvoiceError extends Error {
  problem: ScanProblem
  constructor(problem: ScanProblem) {
    super(`invoice refused: ${problem}`)
    this.name = "InvoiceError"
    this.problem = problem
  }
}

// A scanned invoice, checked: valid, with an amount (exactly `amountMsat` when given), and still
// payable for a while. Throws InvoiceError.
export async function scannedInvoice(text: string, amountMsat?: number): Promise<InvoiceSource> {
  const invoice = invoiceIn(text)
  if (!invoice) throw new InvoiceError("invalid")
  const check = await checkInvoice(invoice, amountMsat === undefined ? {} : { amountMsat })
  if (!check.ok) throw new InvoiceError(check.problem)
  if (check.amountMsat === undefined) throw new InvoiceError("no-amount")
  return { checked: { invoice, paymentHash: check.paymentHash, amountMsat: check.amountMsat, expiresAt: check.expiresAt }, via: "invoice" }
}

// A new invoice from a Lightning address's service, checked against amount and its metadata.
// Throws LnurlError.
export async function addressInvoice(address: string, endpoint: PayEndpoint, amountMsat: number): Promise<InvoiceSource> {
  return { checked: await requestInvoice(endpoint, amountMsat), via: "address", address }
}
