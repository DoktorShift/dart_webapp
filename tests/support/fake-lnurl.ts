// A Lightning address service (LUD-06, LUD-16) that also takes zaps (NIP-57), for the payment
// tests: it answers the app's fetch() for https://<domain>/.well-known/lnurlp/<name> and its
// callback, issues invoices signed with a throwaway node key, and signs zap receipts with its own
// key. Nothing goes over the network. A test can make it misbehave: another amount, a description
// hash for something else, no zaps.
import { randomBytes } from "node:crypto"
import { sha256 } from "@noble/hashes/sha2.js"
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-core"
import { encodeInvoice } from "./bolt11.ts"

export interface FakeLnurlOptions {
  domain?: string
  name?: string
  zaps?: boolean
  // Added to the amount of every invoice it issues.
  amountOffsetMsat?: number
  // Commit the invoice to something else than LUD-06 and NIP-57 ask for.
  wrongDescription?: boolean
}

export interface FakeLnurl {
  address: string
  serviceKey: Uint8Array
  servicePubkey: string
  // Every invoice issued, with the zap request it was for (if any).
  issued: { invoice: string; zapRequest: NostrEvent | null }[]
  // The receipt the service publishes once `invoice` was paid.
  receipt(invoice: string, options?: { signer?: Uint8Array }): NostrEvent
  uninstall(): void
}

export function installFakeLnurl(options: FakeLnurlOptions = {}): FakeLnurl {
  const domain = options.domain ?? "wallet.test"
  const name = options.name ?? "mia"
  const serviceKey = generateSecretKey()
  const nodeKey = randomBytes(32)
  const metadata = JSON.stringify([["text/plain", `Zahlung an ${name}`]])
  const issued: FakeLnurl["issued"] = []
  const realFetch = globalThis.fetch

  const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.host !== domain) return realFetch(input, init)
    if (url.pathname === `/.well-known/lnurlp/${name}`) {
      return respond({
        tag: "payRequest",
        callback: `https://${domain}/callback/${name}`,
        minSendable: 1000,
        maxSendable: 100_000_000,
        metadata,
        ...(options.zaps === false ? {} : { allowsNostr: true, nostrPubkey: getPublicKey(serviceKey) }),
      })
    }
    if (url.pathname === `/callback/${name}`) {
      const amountMsat = Number(url.searchParams.get("amount"))
      const nostr = url.searchParams.get("nostr")
      const description = options.wrongDescription ? "something else" : (nostr ?? metadata)
      const invoice = encodeInvoice({
        amountMsat: amountMsat + (options.amountOffsetMsat ?? 0),
        timestamp: Math.floor(Date.now() / 1000),
        expirySeconds: 600,
        paymentHash: randomBytes(32),
        descriptionHash: sha256(new TextEncoder().encode(description)),
        nodeKey,
      })
      issued.push({ invoice, zapRequest: nostr ? (JSON.parse(nostr) as NostrEvent) : null })
      return respond({ pr: invoice, routes: [] })
    }
    return new Response("not found", { status: 404 })
  }

  return {
    address: `${name}@${domain}`,
    serviceKey,
    servicePubkey: getPublicKey(serviceKey),
    issued,
    receipt(invoice, receiptOptions = {}) {
      const zapRequest = issued.find((entry) => entry.invoice === invoice)?.zapRequest
      if (!zapRequest) throw new Error("no zap for this invoice")
      const recipient = zapRequest.tags.find((tag) => tag[0] === "p")![1]
      return finalizeEvent(
        {
          kind: 9735,
          content: "",
          created_at: Math.floor(Date.now() / 1000),
          tags: [["p", recipient], ["P", zapRequest.pubkey], ["bolt11", invoice], ["description", JSON.stringify(zapRequest)]],
        },
        receiptOptions.signer ?? serviceKey,
      )
    },
    uninstall() {
      globalThis.fetch = realFetch
    },
  }
}
