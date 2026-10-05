// A Lightning wallet service speaking NIP-47 (Nostr Wallet Connect) for the payment tests, built
// from nostr-core's own primitives (Relay, NIP-44, NIP-04, event signing) on a local relay from
// `nak serve`. No Lightning node and no money: invoices are signed with a throwaway node key
// (./bolt11.ts), "paying" one moves the fake balance and remembers its payment hash.
//
// What a test can set: the methods the connection may use, NIP-44 or NIP-04 only (an older
// wallet without an encryption tag), notifications, balance and budget, and how pay_invoice
// answers: normally, with a NIP-47 error, or not at all after paying (the reply lost).
import { randomBytes } from "node:crypto"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { decodeBolt11, finalizeEvent, generateSecretKey, getPublicKey, nip04, nip44, Relay, type NostrEvent } from "nostr-core"
import { encodeInvoice } from "./bolt11.ts"

export const ALL_METHODS = ["pay_invoice", "make_invoice", "lookup_invoice", "get_balance", "get_budget", "get_info"]

export type PayBehaviour = "answer" | "silent" | { error: string }

export interface FakeWalletOptions {
  relay: string
  methods?: string[]
  // "nip04": an older wallet that only knows NIP-04 and names no encryption.
  encryption?: "nip44" | "nip04"
  notifications?: boolean
  balanceMsat?: number
  budget?: { totalMsat: number; usedMsat: number }
  lud16?: string
  feesMsat?: number
}

interface Incoming {
  invoice: string
  amountMsat: number
  createdAt: number
  expiresAt: number
  settled: boolean
}

export interface FakeWallet {
  // The connection text a user would paste.
  uri: string
  walletPubkey: string
  // How often each payment hash was paid: more than 1 is a double payment.
  paid: Map<string, number>
  // Every method asked, in order.
  requests: string[]
  payBehaviour: PayBehaviour
  balanceMsat: number
  // Marks an invoice this wallet made as paid by someone, with a notification if enabled.
  settle(paymentHash: string): Promise<void>
  // Stops answering and disconnects: the wallet went offline (the relay stays up).
  stop(): void
}

const NWC_INFO = 13194
const NWC_REQUEST = 23194
const NWC_RESPONSE = 23195
const NOTIFICATION_NIP04 = 23196
const NOTIFICATION_NIP44 = 23197

export async function startFakeWallet(options: FakeWalletOptions): Promise<FakeWallet> {
  const walletKey = generateSecretKey()
  const clientKey = generateSecretKey()
  const walletPubkey = getPublicKey(walletKey)
  const clientPubkey = getPublicKey(clientKey)
  const methods = options.methods ?? ALL_METHODS
  const nip44Capable = (options.encryption ?? "nip44") === "nip44"
  const conversation = nip44.getConversationKey(walletKey, clientPubkey)
  const nodeKey = randomBytes(32)
  const incoming = new Map<string, Incoming>()
  const outgoingFees = new Map<string, number>()

  const relay = new Relay(options.relay, { reconnect: false })
  await relay.connect()

  const sign = (kind: number, content: string, tags: string[][]) => finalizeEvent({ kind, content, tags, created_at: Math.floor(Date.now() / 1000) }, walletKey)
  const seal = (scheme: "nip44" | "nip04", text: string) => (scheme === "nip44" ? nip44.encrypt(text, conversation) : nip04.encrypt(walletKey, clientPubkey, text))

  const infoTags: string[][] = []
  if (nip44Capable) infoTags.push(["encryption", "nip44_v2 nip04"])
  if (options.notifications) infoTags.push(["notifications", "payment_received payment_sent"])
  await relay.publish(sign(NWC_INFO, methods.join(" "), infoTags))

  const transaction = (hash: string, entry: Incoming) => ({
    type: "incoming",
    state: entry.settled ? "settled" : Date.now() / 1000 > entry.expiresAt ? "failed" : "pending",
    invoice: entry.invoice,
    description: "",
    description_hash: "",
    preimage: "",
    payment_hash: hash,
    amount: entry.amountMsat,
    fees_paid: 0,
    created_at: entry.createdAt,
    expires_at: entry.expiresAt,
    settled_at: entry.settled ? Math.floor(Date.now() / 1000) : 0,
  })

  const wallet: FakeWallet = {
    uri: `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(options.relay)}&secret=${bytesToHex(clientKey)}${options.lud16 ? `&lud16=${encodeURIComponent(options.lud16)}` : ""}`,
    walletPubkey,
    paid: new Map(),
    requests: [],
    payBehaviour: "answer",
    balanceMsat: options.balanceMsat ?? 1_000_000,
    async settle(paymentHash) {
      const entry = incoming.get(paymentHash)
      if (!entry) throw new Error("no such invoice")
      entry.settled = true
      if (!options.notifications) return
      const body = JSON.stringify({ notification_type: "payment_received", notification: transaction(paymentHash, entry) })
      const scheme = nip44Capable ? "nip44" : "nip04"
      await relay.publish(sign(scheme === "nip44" ? NOTIFICATION_NIP44 : NOTIFICATION_NIP04, seal(scheme, body), [["p", clientPubkey]]))
    },
    stop: () => {
      subscription.close()
      relay.close()
    },
  }

  type Answer = { result: unknown } | { error: { code: string; message: string } } | null
  const refuse = (code: string): Answer => ({ error: { code, message: code.toLowerCase() } })

  function handle(method: string, params: Record<string, unknown>): Answer {
    if (!methods.includes(method)) return refuse("RESTRICTED")
    switch (method) {
      case "get_info":
        return { result: { alias: "Testwallet", color: "#000000", pubkey: walletPubkey, network: "regtest", block_height: 1, block_hash: "", methods, notifications: options.notifications ? ["payment_received", "payment_sent"] : [] } }
      case "get_balance":
        return { result: { balance: wallet.balanceMsat } }
      case "get_budget":
        return { result: options.budget ? { total_budget: options.budget.totalMsat, used_budget: options.budget.usedMsat, renewal_period: "monthly" } : {} }
      case "pay_invoice": {
        const invoice = decodeBolt11(String(params.invoice))
        const amount = invoice.amountMsat ?? 0
        if (wallet.paid.has(invoice.paymentHash)) return refuse("PAYMENT_FAILED")
        if (typeof wallet.payBehaviour === "object") return refuse(wallet.payBehaviour.error)
        if (amount > wallet.balanceMsat) return refuse("INSUFFICIENT_BALANCE")
        if (options.budget && options.budget.usedMsat + amount > options.budget.totalMsat) return refuse("QUOTA_EXCEEDED")
        const fees = options.feesMsat ?? 1000
        wallet.balanceMsat -= amount + fees
        wallet.paid.set(invoice.paymentHash, (wallet.paid.get(invoice.paymentHash) ?? 0) + 1)
        outgoingFees.set(invoice.paymentHash, fees)
        if (wallet.payBehaviour === "silent") return null
        return { result: { preimage: "00".repeat(32), fees_paid: fees } }
      }
      case "make_invoice": {
        const amountMsat = Number(params.amount)
        const createdAt = Math.floor(Date.now() / 1000)
        const expiry = Number(params.expiry ?? 3600)
        const paymentHash = sha256(randomBytes(32))
        const invoice = encodeInvoice({ amountMsat, timestamp: createdAt, expirySeconds: expiry, paymentHash, description: String(params.description ?? ""), nodeKey })
        const hash = bytesToHex(paymentHash)
        const entry = { invoice, amountMsat, createdAt, expiresAt: createdAt + expiry, settled: false }
        incoming.set(hash, entry)
        return { result: transaction(hash, entry) }
      }
      case "lookup_invoice": {
        const hash = String(params.payment_hash)
        const entry = incoming.get(hash)
        if (entry) return { result: transaction(hash, entry) }
        if (wallet.paid.has(hash)) return { result: { type: "outgoing", state: "settled", payment_hash: hash, amount: 0, fees_paid: outgoingFees.get(hash) ?? 0, settled_at: Math.floor(Date.now() / 1000) } }
        return refuse("NOT_FOUND")
      }
      default:
        return refuse("NOT_IMPLEMENTED")
    }
  }

  const subscription = relay.subscribe([{ kinds: [NWC_REQUEST], "#p": [walletPubkey] }], {
    onevent: async (request: NostrEvent) => {
      if (request.pubkey !== clientPubkey) return
      const scheme = request.content.includes("?iv=") ? "nip04" : "nip44"
      let answer: Answer
      let method = "unreadable"
      if (scheme === "nip44" && !nip44Capable) {
        answer = refuse("UNSUPPORTED_ENCRYPTION")
      } else {
        const command = JSON.parse(scheme === "nip44" ? nip44.decrypt(request.content, conversation) : nip04.decrypt(walletKey, clientPubkey, request.content))
        method = command.method
        answer = handle(method, command.params ?? {})
      }
      wallet.requests.push(method)
      if (!answer) return
      // A wallet that can't read NIP-44 answers in NIP-04, as NIP-47 asks.
      const replyScheme = scheme === "nip44" && !nip44Capable ? "nip04" : scheme
      await relay.publish(sign(NWC_RESPONSE, seal(replyScheme, JSON.stringify({ result_type: method, ...answer })), [["p", clientPubkey], ["e", request.id]]))
    },
  })

  return wallet
}
