// "Gratulieren" as a public zap (NIP-57, PLAN.md "Freiwillige Zaps"): a zap request signed by the
// profile goes to the recipient's Lightning service, which issues the invoice and, once it is
// paid, publishes a receipt. "Zap bestätigt" only for a receipt that passes the full check
// (lib/nostr/ext/validate.ts: signed by that service, for this request, amount and recipient)
// and names exactly the invoice this app paid. Until then it is "Bezahlt · Beleg wird noch
// geladen"; looking for the receipt only reads, it never pays again.
import { subscribe, type Closer } from "../nostr/client.ts"
import { requestInvoice, zapRequestTemplate, type PayEndpoint } from "../nostr/ext/lnurl.ts"
import { validateZapReceipt } from "../nostr/ext/validate.ts"
import { generalRelays } from "../nostr/relays.ts"
import type { NostrEvent, Signer } from "../nostr/types.ts"
import { recordReceipt, type InvoiceSource, type PaymentEntry } from "./journal.ts"

const ZAP_RECEIPT_KIND = 9735

// The signed zap request and its checked invoice. The endpoint must take zaps (zapPubkey).
// Throws LnurlError, or the signer's error.
export async function zapInvoice(zap: { recipient: string; address: string; endpoint: PayEndpoint; amountMsat: number; comment?: string; signer: Signer }): Promise<InvoiceSource> {
  const { endpoint } = zap
  if (!endpoint.zapPubkey) throw new Error("this Lightning address takes no zaps")
  // BlueLine's general relays keep receipts; purplepag.es, a profile relay, doesn't (OP-25).
  const relays = generalRelays()
  const request = await zap.signer.signEvent(await zapRequestTemplate({ recipient: zap.recipient, amountMsat: zap.amountMsat, relays, endpoint, comment: zap.comment }))
  return {
    checked: await requestInvoice(endpoint, zap.amountMsat, request),
    via: "zap",
    address: zap.address,
    zap: { request, zapPubkey: endpoint.zapPubkey, relays, receipt: null },
  }
}

// Whether `receipt` confirms this journal entry's zap: the full check, for exactly the invoice
// that was paid (the entry's id is its payment hash).
export async function isReceiptFor(entry: PaymentEntry, receipt: NostrEvent): Promise<boolean> {
  if (!entry.zap) return false
  const check = await validateZapReceipt(receipt, {
    nostrPubkey: entry.zap.zapPubkey,
    request: entry.zap.request,
    recipient: entry.counterpart.pubkey,
    amountMsat: entry.amountMsat,
    paymentHash: entry.id,
  })
  return check.ok
}

// Listens for the receipt of a paid or unknown zap at its relays and records the first one that
// fits; `onConfirmed`, if given, gets the updated entry. Returns what stops listening.
export function watchReceipt(entry: PaymentEntry, onConfirmed?: (entry: PaymentEntry) => void): Closer {
  const zap = entry.zap
  const recipient = entry.counterpart.pubkey
  if (!zap || zap.receipt || !recipient) return { close: () => {} }
  let done = false
  // A receipt can't be older than the request it answers; a minute covers clocks that differ.
  const filter = { kinds: [ZAP_RECEIPT_KIND], "#p": [recipient], since: zap.request.created_at - 60 }
  const subscription = subscribe([filter], zap.relays, {
    onevent: async (event) => {
      if (done || !(await isReceiptFor(entry, event))) return
      const saved = await recordReceipt(entry.id, event.id)
      if (!saved?.zap?.receipt || done) return
      done = true
      subscription.close()
      onConfirmed?.(saved)
    },
  })
  return {
    close: () => {
      done = true
      subscription.close()
    },
  }
}
