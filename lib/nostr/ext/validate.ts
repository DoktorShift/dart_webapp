// Strict checks for badge awards (NIP-58), zap receipts (NIP-57) and Lightning invoices.
// To be upstreamed to nostr-core (gaps NC-14, NC-15, OP-23): its validateBadgeAward accepts an
// award signed by anyone, and validateZapReceipt accepts a receipt signed by any key with any
// invoice. Both were reproduced with nostr-core 1.0.6 (see the tests).
//
// Every check returns { ok: true } or { ok: false, reason } instead of throwing, so a list of
// received events can be filtered without try/catch. Who may award what is the app's rule,
// not part of these checks.
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { loadCore } from "../core.ts"
import type { NostrEvent } from "../types.ts"

export type Check = { ok: true } | { ok: false; reason: string }

const pass: Check = { ok: true }
const fail = (reason: string): Check => ({ ok: false, reason })
const tagValues = (event: NostrEvent, name: string) => event.tags.filter((tag) => tag[0] === name).map((tag) => tag[1] ?? "")
const firstTag = (event: NostrEvent, name: string) => event.tags.find((tag) => tag[0] === name)?.[1]

// --- NIP-58 ----------------------------------------------------------------------------------

// A kind 8 award is valid for a kind 30009 definition when both are correctly signed, the award
// comes from the definition's author and points at exactly that definition, and (if given)
// names the recipient.
export async function validateBadgeAward(award: NostrEvent, definition: NostrEvent, recipient?: string): Promise<Check> {
  const core = await loadCore()
  if (award.kind !== 8) return fail("the award is not kind 8")
  if (definition.kind !== 30009) return fail("the definition is not kind 30009")
  if (!core.verifyEventSignature(definition)) return fail("the definition's signature is not valid")
  if (!core.verifyEventSignature(award)) return fail("the award's signature is not valid")
  if (award.pubkey !== definition.pubkey) return fail("the award was not issued by the badge's author")
  const d = firstTag(definition, "d")
  if (!d) return fail("the definition has no d tag")
  const address = `30009:${definition.pubkey}:${d}`
  const addresses = tagValues(award, "a")
  if (addresses.length !== 1 || addresses[0] !== address) return fail("the award doesn't reference exactly this badge")
  const recipients = tagValues(award, "p")
  if (recipients.length === 0) return fail("the award names no recipient")
  if (recipient !== undefined && !recipients.includes(recipient)) return fail("the award doesn't name this recipient")
  return pass
}

// --- Lightning invoices ----------------------------------------------------------------------

export interface InvoiceExpectation {
  amountMsat?: number
  // Seconds of validity the invoice must still have (default 30), so it can't expire mid-payment.
  minRemainingSeconds?: number
  // SHA-256 of the description the invoice must commit to, hex.
  descriptionHash?: string
  now?: number
}

export type InvoiceCheck = (Check & { ok: false }) | { ok: true; amountMsat: number | undefined; paymentHash: string; expiresAt: number }

// Decodes a BOLT-11 invoice with nostr-core and checks it against what is about to be paid.
// A zero-amount invoice never passes an amount check.
export async function checkInvoice(bolt11: string, expected: InvoiceExpectation = {}): Promise<InvoiceCheck> {
  const core = await loadCore()
  let invoice: ReturnType<typeof core.decodeBolt11>
  try {
    invoice = core.decodeBolt11(bolt11)
  } catch {
    return { ok: false, reason: "not a valid invoice" }
  }
  if (expected.amountMsat !== undefined && invoice.amountMsat !== expected.amountMsat) return { ok: false, reason: "the invoice amount differs" }
  const now = expected.now ?? Math.floor(Date.now() / 1000)
  if (invoice.expiresAt - now < (expected.minRemainingSeconds ?? 30)) return { ok: false, reason: "the invoice has expired or is about to" }
  if (expected.descriptionHash !== undefined && invoice.descriptionHash !== expected.descriptionHash) return { ok: false, reason: "the invoice is for something else" }
  return { ok: true, amountMsat: invoice.amountMsat, paymentHash: invoice.paymentHash, expiresAt: invoice.expiresAt }
}

// --- NIP-57 ----------------------------------------------------------------------------------

export interface ZapExpectation {
  // nostrPubkey from the recipient's LNURL pay endpoint: the only key allowed to sign receipts.
  nostrPubkey: string
  // The zap request this receipt must answer (the one we sent), if known.
  request?: NostrEvent
  recipient?: string
  amountMsat?: number
  // The recipient's LNURL (bech32 lnurl1...); a request naming another one is refused.
  lnurl?: string
}

// Validates a kind 9735 zap receipt (NIP-57 appendix F and E): signed by the LNURL server's
// nostrPubkey, carrying a correctly signed zap request whose amount equals the invoice amount
// and whose JSON is what the invoice's description hash commits to.
export async function validateZapReceipt(receipt: NostrEvent, expected: ZapExpectation): Promise<Check> {
  const core = await loadCore()
  if (receipt.kind !== 9735) return fail("not a zap receipt")
  if (!core.verifyEventSignature(receipt)) return fail("the receipt's signature is not valid")
  if (receipt.pubkey !== expected.nostrPubkey) return fail("the receipt was not signed by the recipient's Lightning service")
  const description = firstTag(receipt, "description")
  const bolt11 = firstTag(receipt, "bolt11")
  if (!description || !bolt11) return fail("the receipt lacks its invoice or zap request")
  let request: NostrEvent
  try {
    request = JSON.parse(description) as NostrEvent
  } catch {
    return fail("the zap request is not readable")
  }
  if (request?.kind !== 9734 || typeof request.sig !== "string" || !Array.isArray(request.tags)) return fail("no zap request inside")
  if (!core.verifyEventSignature(request)) return fail("the zap request's signature is not valid")
  if (expected.request && expected.request.id !== request.id) return fail("the receipt answers another zap request")
  let invoice: ReturnType<typeof core.decodeBolt11>
  try {
    invoice = core.decodeBolt11(bolt11)
  } catch {
    return fail("the receipt's invoice is not valid")
  }
  if (invoice.descriptionHash !== bytesToHex(sha256(new TextEncoder().encode(description)))) return fail("the invoice doesn't commit to this zap request")
  const requested = firstTag(request, "amount")
  if (requested !== undefined && String(invoice.amountMsat ?? "") !== requested) return fail("the invoice amount differs from the zap request")
  if (expected.amountMsat !== undefined && invoice.amountMsat !== expected.amountMsat) return fail("the amount differs from the expected amount")
  const requestRecipients = tagValues(request, "p")
  if (requestRecipients.length !== 1) return fail("the zap request must name one recipient")
  if (firstTag(receipt, "p") !== requestRecipients[0]) return fail("the receipt names another recipient than the request")
  if (expected.recipient !== undefined && requestRecipients[0] !== expected.recipient) return fail("the zap went to someone else")
  const sender = firstTag(receipt, "P")
  if (sender !== undefined && sender !== request.pubkey) return fail("the receipt names another sender than the request")
  const requestLnurl = firstTag(request, "lnurl")
  if (expected.lnurl !== undefined && requestLnurl !== undefined && requestLnurl.toLowerCase() !== expected.lnurl.toLowerCase()) return fail("the zap request names another Lightning service")
  const requestEvent = firstTag(request, "e")
  if (requestEvent !== undefined && firstTag(receipt, "e") !== requestEvent) return fail("the receipt refers to another event than the request")
  return pass
}
