import type { Messages } from "@/lib/i18n"
import { LnurlError } from "@/lib/nostr/ext/lnurl"
import { WalletError } from "@/lib/nostr/wallet"
import { InvoiceError } from "@/lib/payments/invoices"

// One sentence for what went wrong before or while paying: the wallet's answer, a scanned
// invoice that doesn't fit, a Lightning address that doesn't answer, or a profile that didn't
// sign the congratulation. `amount` and `address` name what was asked for.
export function problemText(t: Messages, error: unknown, context: { amount?: string; address?: string } = {}): string {
  const p = t.payments
  if (error instanceof WalletError) return p.problem[error.code]
  if (error instanceof InvoiceError) return error.problem === "amount" ? p.invoice.amount(context.amount ?? "") : p.invoice[error.problem]
  if (error instanceof LnurlError) {
    const address = context.address ?? ""
    if (error.code === "amount") return p.invoice.addressAmount(address)
    if (error.code === "mismatch") return p.invoice.description
    return p.invoice.addressUnreachable(address)
  }
  // lib/nostr/signers.ts's SignerError, by name: its module isn't needed here otherwise.
  if (error instanceof Error && error.name === "SignerError") return p.congratulate.notSigned
  return p.problem.failed
}
