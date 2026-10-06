// LNURL-pay (LUD-06, LUD-16) and NIP-57 zap requests, with the checks nostr-core leaves out
// (NC-14): the invoice a pay endpoint returns is decoded and must be for exactly the amount asked,
// still valid, and commit (its description hash) to what was asked for: the endpoint's metadata,
// or for a zap the zap request itself. nostr-core's payLightningAddress pays whatever comes back.
// To be upstreamed to nostr-core.
//
// Endpoints are fetched straight from the browser. A service that sends no CORS headers can't be
// reached from a web app at all (OP-22); that shows as "unreachable", like any network failure,
// and so does one that takes longer than SERVICE_TIMEOUT_MS to answer.
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { loadCore } from "../core.ts"
import { createdAt } from "../time.ts"
import type { EventTemplate, NostrEvent } from "../types.ts"
import { checkInvoice } from "./validate.ts"

export type LnurlErrorCode =
  // Not a Lightning address (name@domain).
  | "address"
  // The service didn't answer, answered with an error, or can't be reached from a web page.
  | "unreachable"
  // The service doesn't take this amount.
  | "amount"
  // The invoice it sent is not for what was asked.
  | "mismatch"

export class LnurlError extends Error {
  code: LnurlErrorCode
  constructor(code: LnurlErrorCode, message: string) {
    super(message)
    this.name = "LnurlError"
    this.code = code
  }
}

export interface PayEndpoint {
  // The pay endpoint's address (https://<domain>/.well-known/lnurlp/<name>).
  url: string
  callback: string
  minMsat: number
  maxMsat: number
  metadata: string
  // The key that signs this service's zap receipts; null when it takes no zaps.
  zapPubkey: string | null
}

export interface CheckedInvoice {
  invoice: string
  paymentHash: string
  amountMsat: number
  // Seconds.
  expiresAt: number
}

const isAmount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0

// nostr-core's LNURL requests have no timeout and take no AbortSignal: a service that hangs is
// given up after this long (its late answer is ignored).
const SERVICE_TIMEOUT_MS = 10_000

// `request`, or LnurlError "unreachable" when it fails or takes too long.
async function askService<T>(request: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the service took too long to answer")), SERVICE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([request(), timeout])
  } catch (error) {
    throw new LnurlError("unreachable", error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
  }
}

// The pay endpoint behind a Lightning address. Throws LnurlError.
export async function fetchPayEndpoint(address: string): Promise<PayEndpoint> {
  const core = await loadCore()
  let parts: { name: string; domain: string }
  try {
    parts = core.parseLightningAddress(address.trim())
  } catch {
    throw new LnurlError("address", "not a Lightning address")
  }
  const url = `https://${parts.domain.toLowerCase()}/.well-known/lnurlp/${encodeURIComponent(parts.name)}`
  const response = await askService(() => core.fetchPayRequest(url))
  let callback: URL | null = null
  try {
    callback = new URL(response.callback)
  } catch {
    // Checked below.
  }
  if (callback?.protocol !== "https:" || !isAmount(response.minSendable) || !isAmount(response.maxSendable) || typeof response.metadata !== "string") {
    throw new LnurlError("unreachable", "the service sent an unusable pay endpoint")
  }
  const zapPubkey = response.allowsNostr === true && typeof response.nostrPubkey === "string" && /^[0-9a-f]{64}$/.test(response.nostrPubkey) ? response.nostrPubkey : null
  return { url, callback: callback.href, minMsat: response.minSendable, maxMsat: response.maxSendable, metadata: response.metadata, zapPubkey }
}

const hashOf = (text: string) => bytesToHex(sha256(new TextEncoder().encode(text)))

// Asks the endpoint for an invoice of exactly `amountMsat`, for a zap when `zapRequest` is given
// (signed kind 9734), and checks it before anyone pays it. The invoice comes back in lower case,
// as invoices are stored and compared everywhere in this app. Throws LnurlError.
export async function requestInvoice(endpoint: PayEndpoint, amountMsat: number, zapRequest?: NostrEvent): Promise<CheckedInvoice> {
  if (amountMsat < endpoint.minMsat || amountMsat > endpoint.maxMsat) throw new LnurlError("amount", "the service doesn't take this amount")
  const core = await loadCore()
  const description = zapRequest ? JSON.stringify(zapRequest) : endpoint.metadata
  const payRequest = { tag: "payRequest" as const, callback: endpoint.callback, minSendable: endpoint.minMsat, maxSendable: endpoint.maxMsat, metadata: endpoint.metadata }
  const { pr } = await askService(() => core.requestLnurlInvoice(payRequest, amountMsat, zapRequest ? { nostr: description } : undefined))
  if (typeof pr !== "string") throw new LnurlError("unreachable", "the service sent no invoice")
  const invoice = pr.toLowerCase()
  const checked = await checkInvoice(invoice, { amountMsat, descriptionHash: hashOf(description) })
  if (!checked.ok) throw new LnurlError("mismatch", checked.reason)
  return { invoice, paymentHash: checked.paymentHash, amountMsat, expiresAt: checked.expiresAt }
}

// The zap request (kind 9734, unsigned) for paying `endpoint` on behalf of `recipient`. Receipts
// go to `relays`; they must be relays that keep kind 9735 (not purplepag.es, OP-25).
export async function zapRequestTemplate(request: { recipient: string; amountMsat: number; relays: string[]; endpoint: PayEndpoint; comment?: string }): Promise<EventTemplate> {
  const core = await loadCore()
  const template = core.createZapRequestEventTemplate({
    recipientPubkey: request.recipient,
    amount: request.amountMsat,
    relays: request.relays,
    lnurl: core.encodeLnurl(request.endpoint.url),
    content: request.comment ?? "",
  })
  return { ...template, created_at: createdAt() }
}
