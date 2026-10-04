import type { RecordSpec } from "./common.ts"
import { shortText } from "./common.ts"
import { FORMAT_VERSION, KIND_RECORD, MAX_FUTURE_SKEW_SECONDS } from "./kinds.ts"
import type { Agreement } from "./match.ts"
import type { Reason } from "./reasons.ts"
import type { Infer } from "./schema.ts"
import { hex, int, obj, opt, refine, SchemaError, str, time } from "./schema.ts"
import { eventHash, readLabels, recordTags, tagValues } from "./tags.ts"

// Private payment request between players (docs/protocol/families/payment-request.md). An
// unsigned rumor of kind 1180, sealed by the requesting player's profile key (NIP-59 kind 13)
// and gift-wrapped (kind 1059) to the player who should pay. It is a request only: the payer
// sees recipient, amount and expiry and decides; nothing here or anywhere in BlueLine pays on
// its own. The in-person route (invoice shown as QR) needs no event at all.

const paymentRequest = obj({
  amount: refine(int(1000, 100_000_000_000, "Amount in msat, whole sats"), (v) => (v % 1000 === 0 ? null : "not whole sats")),
  invoice: str({ min: 10, max: 2000, pattern: /^ln(bc|tb|bcrt|tbs)[0-9a-z]+$/, description: "BOLT11 invoice, lowercase" }),
  hash: hex(32, "Payment hash of the invoice; the request's idempotency key"),
  expires: time("Request expiry, not after the invoice's"),
  seat: int(0, 5, "Seat of the requesting player"),
  memo: opt(shortText(140)),
})
export type PaymentRequest = Infer<typeof paymentRequest>

export const PAYMENT_TYPES = {
  "payment.request": {
    kind: KIND_RECORD,
    root: "required",
    encryption: "none",
    schema: paymentRequest,
    description: "Payment request to a fellow player; only ever inside a NIP-59 gift wrap",
  },
} satisfies Record<string, RecordSpec>

// The rumor to seal and wrap (lib/payments does both with nostr-core).
export function paymentRequestRumor(content: PaymentRequest, opts: { match: string; payer: string; created_at: number }) {
  const checked = paymentRequest.check(content, "")
  return {
    kind: KIND_RECORD,
    created_at: opts.created_at,
    tags: [...recordTags("payment.request", { root: opts.match }), ["p", opts.payer]],
    content: JSON.stringify(checked),
  }
}

// What lib/payments decoded from the invoice with nostr-core's decodeBolt11.
export interface DecodedInvoice {
  amountMsat: number | null
  paymentHash: string
  expiresAt: number
}

export type PaymentCheck = { ok: true; request: PaymentRequest; requester: string } | { ok: false; reason: Reason; detail: string }

// Checks an unwrapped request before the payer is even shown it. `sealPubkey` is the verified
// author of the seal; the rumor must claim the same author, which must be a seated player with
// a profile (a board, a session key or a stranger never qualifies).
export function checkPaymentRequest(
  rumor: { id?: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string },
  ctx: { sealPubkey: string; match: string; agreement: Agreement; payer: string; invoice: DecodedInvoice; now: number },
): PaymentCheck {
  const no = (reason: Reason, detail: string): PaymentCheck => ({ ok: false, reason, detail })
  if (rumor.id !== undefined && rumor.id !== eventHash(rumor)) return no("invalid_event", "rumor id does not match its content")
  if (rumor.pubkey !== ctx.sealPubkey) return no("not_authorized", "seal and request have different authors")
  if (rumor.kind !== KIND_RECORD) return no("wrong_kind", `kind ${rumor.kind}`)
  const labels = readLabels(rumor.tags)
  if (!labels || labels.type !== "payment.request") return no("not_blueline", "not a payment request")
  if (labels.version !== FORMAT_VERSION) return no("unknown_version", `version ${labels.version} is not executed`)
  const roots = tagValues(rumor.tags, "e")
  if (roots.length !== 1 || roots[0] !== ctx.match) return no("wrong_root", "request is for another match")
  const payers = tagValues(rumor.tags, "p")
  if (payers.length !== 1 || payers[0] !== ctx.payer) return no("invalid_tags", "request is addressed to someone else")
  if (rumor.created_at > ctx.now + MAX_FUTURE_SKEW_SECONDS) return no("future_timestamp", "dated in the future")

  let request: PaymentRequest
  try {
    request = paymentRequest.check(JSON.parse(rumor.content), "")
  } catch (e) {
    return no("invalid_content", e instanceof SchemaError ? e.message : "content is not JSON")
  }

  const requesterSeat = ctx.agreement.seats.findIndex((s) => s.pubkey === rumor.pubkey)
  if (requesterSeat < 0) return no("not_a_player", "the requester is not a player of this match")
  if (requesterSeat !== request.seat) return no("not_a_player", "the requester claims another seat")
  const payerSeat = ctx.agreement.seats.findIndex((s) => s.pubkey === ctx.payer)
  if (payerSeat < 0 || payerSeat === requesterSeat) return no("not_a_player", "the payer is not the requester's opponent")

  if (ctx.agreement.stake && ctx.agreement.stake.msat !== request.amount) return no("amount_mismatch", "amount differs from the agreed stake")
  if (ctx.invoice.amountMsat === null) return no("invoice_mismatch", "invoice without an amount")
  if (ctx.invoice.amountMsat !== request.amount) return no("amount_mismatch", "invoice amount differs from the request")
  if (ctx.invoice.paymentHash !== request.hash) return no("invoice_mismatch", "payment hash differs from the invoice")
  if (request.expires > ctx.invoice.expiresAt) return no("invoice_mismatch", "request outlives its invoice")
  if (ctx.invoice.expiresAt <= ctx.now || request.expires <= ctx.now) return no("invoice_expired", "invoice or request expired")
  return { ok: true, request, requester: rumor.pubkey }
}
