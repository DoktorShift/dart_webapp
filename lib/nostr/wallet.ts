// The player's Lightning wallet through Nostr Wallet Connect (NIP-47), with nostr-core's NWC class
// (decision 0002 §8). What nostr-core leaves to the app happens here:
//
// - Every connection starts with one get_info round trip. That is what NWC.verifyEncryption does,
//   with its answer kept: afterwards the encryption is pinned, and nostr-core no longer retries a
//   request in the other scheme, which repeated a payment (NC-11, NC-12).
// - Every failure becomes a WalletError whose code says whether the wallet may still have acted.
//   "no-answer" means it may have: a payment with that outcome is unknown, never failed, and is
//   cleared up with lookupInvoice, not by paying again (OP-18).
// - The connection's own Lightning address (lud16), which nostr-core drops (OP-16), is read here.
//
// Only the relays named in the connection are used. The connection text holds the wallet's
// secret: it never appears in an error message, a log or anything returned from here.
import { hexToBytes } from "@noble/hashes/utils.js"
import { loadCore } from "./core.ts"
import { normalizeRelayUrl } from "./relays.ts"

export type WalletErrorCode =
  // Not a wallet connection.
  | "invalid"
  // Nothing was sent: none of the connection's relays could be reached.
  | "unreachable"
  // Sent, but no readable answer came back in time. The wallet may have carried it out.
  | "no-answer"
  // The wallet answered and refused (NIP-47 error codes).
  | "insufficient"
  | "quota"
  | "restricted"
  | "unsupported"
  | "not-found"
  | "rate-limited"
  | "failed"

export class WalletError extends Error {
  code: WalletErrorCode
  constructor(code: WalletErrorCode, message: string) {
    super(message)
    this.name = "WalletError"
    this.code = code
  }
}

const WALLET_CODES: Record<string, WalletErrorCode> = {
  INSUFFICIENT_BALANCE: "insufficient",
  QUOTA_EXCEEDED: "quota",
  RESTRICTED: "restricted",
  UNAUTHORIZED: "restricted",
  NOT_IMPLEMENTED: "unsupported",
  NOT_FOUND: "not-found",
  RATE_LIMITED: "rate-limited",
}

// What a connection text says, without its secret.
export interface WalletUri {
  walletPubkey: string
  relays: string[]
  // The wallet's own Lightning address, when the connection names one.
  lightningAddress: string | null
}

const SCHEMES = ["nostr+walletconnect:", "nostrwalletconnect:"]
const HEX_KEY = /^[0-9a-f]{64}$/

// A connection text read, with the secret this app signs with.
interface ReadUri extends WalletUri {
  secret: string
}

function readWalletUri(text: string): ReadUri | null {
  const trimmed = text.trim()
  const scheme = SCHEMES.find((prefix) => trimmed.toLowerCase().startsWith(prefix))
  if (!scheme) return null
  let url: URL
  try {
    url = new URL(`http://${trimmed.slice(scheme.length).replace(/^\/\//, "")}`)
  } catch {
    return null
  }
  const walletPubkey = url.hostname
  const secret = url.searchParams.get("secret") ?? ""
  const relays = [...new Set(url.searchParams.getAll("relay").map(normalizeRelayUrl))].filter((relay): relay is string => relay !== null)
  if (!HEX_KEY.test(walletPubkey) || relays.length === 0) return null
  if (!/^[0-9a-f]{64}$/i.test(secret) && !secret.startsWith("nsec1")) return null
  return { walletPubkey, relays, lightningAddress: url.searchParams.get("lud16")?.trim() || null, secret }
}

// Reads a wallet connection (nostr+walletconnect://…) the way nostr-core does, and checks what
// nostr-core doesn't: a wallet key, a secret, and at least one relay this app can reach (wss, or
// ws on this device). Null for anything else, an invoice or a link included.
export function parseWalletUri(text: string): WalletUri | null {
  const read = readWalletUri(text)
  return read && { walletPubkey: read.walletPubkey, relays: read.relays, lightningAddress: read.lightningAddress }
}

export interface WalletDetails {
  // The name the wallet gives itself, if any.
  alias: string | null
  // NIP-47 methods this connection may use (pay_invoice, make_invoice, …).
  methods: string[]
  // Notifications it sends (payment_received, payment_sent).
  notifications: string[]
  encryption: "nip44" | "nip04"
}

export interface InvoiceStatus {
  state: "settled" | "pending" | "failed" | "accepted"
  feesMsat: number | null
}

export interface Budget {
  usedMsat: number
  totalMsat: number
  // When the budget starts over (seconds), and how often ("monthly").
  renewsAt: number | null
  renewalPeriod: string | null
}

export interface WalletClient {
  details: WalletDetails
  // Which connection this is: the wallet's key and the key this app holds in it, never the
  // secret. A wallet answers lookups only about what went through the same connection (NWC-09),
  // so a payment's outcome can only be ruled out by the connection that sent it.
  connection: string
  payInvoice(invoice: string): Promise<{ feesMsat: number | null }>
  makeInvoice(request: { amountMsat: number; description: string; expirySeconds: number }): Promise<{ invoice: string; paymentHash: string }>
  // An invoice by its payment hash, paid by this wallet or to it.
  lookupInvoice(paymentHash: string): Promise<InvoiceStatus>
  getBalance(): Promise<number>
  // Alby's non-standard get_budget; null when the wallet sets no limit.
  getBudget(): Promise<Budget | null>
  // Only for wallets that list "payment_received". Returns the function that stops listening.
  onPaymentReceived(handler: (paymentHash: string) => void): () => void
  close(): void
}

export interface WalletOptions {
  // How long pay, make and lookup wait for the wallet's answer.
  replyTimeoutMs?: number
}

// Long enough for a payment that needs a few routing attempts; a wallet that is asleep doesn't
// answer within any wait the person would accept.
const REPLY_TIMEOUT_MS = 30_000

type Core = Awaited<ReturnType<typeof loadCore>>

function toWalletError(core: Core, error: unknown): WalletError {
  if (error instanceof WalletError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof core.NWCWalletError) return new WalletError(WALLET_CODES[error.code] ?? "failed", message)
  if (error instanceof core.NWCConnectionError) return new WalletError("unreachable", message)
  // nostr-core's sign that the wallet answered in the other encryption: it could not read us.
  if ((error as { code?: unknown })?.code === "ENCRYPTION_MISMATCH") return new WalletError("failed", message)
  // Timeouts, a request no relay confirmed, an answer that can't be read: it may have been done.
  return new WalletError("no-answer", message)
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
const msat = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null)

// The key this app holds in a connection, from its secret (hex, or nsec as some wallets write it).
function appKeyOf(core: Core, secret: string): string {
  if (!secret.startsWith("nsec1")) return core.getPublicKey(hexToBytes(secret))
  const decoded = core.nip19.decode(secret)
  if (decoded.type !== "nsec") throw new WalletError("invalid", "not a wallet connection")
  return core.getPublicKey(decoded.data)
}

// Connects to the wallet and asks for its details (get_info). Throws WalletError.
export async function connectWallet(uri: string, options: WalletOptions = {}): Promise<WalletClient> {
  const read = readWalletUri(uri)
  if (!read) throw new WalletError("invalid", "not a wallet connection")
  const core = await loadCore()
  let connection: string
  try {
    connection = `${read.walletPubkey}:${appKeyOf(core, read.secret)}`
  } catch {
    throw new WalletError("invalid", "not a wallet connection")
  }
  const call = async <T>(request: () => Promise<T>): Promise<T> => {
    try {
      return await request()
    } catch (error) {
      throw toWalletError(core, error)
    }
  }

  let nwc: InstanceType<Core["NWC"]>
  try {
    nwc = new core.NWC(uri)
  } catch {
    throw new WalletError("invalid", "not a wallet connection")
  }
  nwc.replyTimeout = options.replyTimeoutMs ?? REPLY_TIMEOUT_MS
  let details: WalletDetails
  try {
    await call(() => nwc.connect())
    const info = await call(() => nwc.getInfo())
    details = {
      alias: typeof info.alias === "string" && info.alias.trim() ? info.alias.trim() : null,
      methods: strings(info.methods),
      notifications: strings(info.notifications),
      encryption: nwc.encryption ?? "nip04",
    }
  } catch (error) {
    nwc.close()
    throw error
  }

  return {
    details,
    connection,
    async payInvoice(invoice) {
      const result = await call(() => nwc.payInvoice(invoice))
      return { feesMsat: msat(result.fees_paid) }
    },
    async makeInvoice({ amountMsat, description, expirySeconds }) {
      const result = await call(() => nwc.makeInvoice({ amount: amountMsat, description, expiry: expirySeconds }))
      if (typeof result.invoice !== "string" || typeof result.payment_hash !== "string") throw new WalletError("failed", "the wallet sent no invoice")
      return { invoice: result.invoice, paymentHash: result.payment_hash }
    },
    async lookupInvoice(paymentHash) {
      const result = await call(() => nwc.lookupInvoice({ payment_hash: paymentHash }))
      // Wallets from before NIP-47 had "state" only say whether it was settled.
      const state = ["settled", "pending", "failed", "accepted"].includes(result.state) ? result.state : result.settled_at ? "settled" : "pending"
      return { state, feesMsat: msat(result.fees_paid) }
    },
    async getBalance() {
      const result = await call(() => nwc.getBalance())
      const balance = msat(result.balance)
      if (balance === null) throw new WalletError("failed", "the wallet sent no balance")
      return balance
    },
    async getBudget() {
      const result = await call(() => nwc.getBudget())
      const total = msat(result.total_budget)
      if (total === null) return null
      return { usedMsat: msat(result.used_budget) ?? 0, totalMsat: total, renewsAt: msat(result.renews_at), renewalPeriod: result.renewal_period ?? null }
    },
    onPaymentReceived(handler) {
      const listener = ({ notification }: { notification: { payment_hash?: unknown } }) => {
        if (typeof notification?.payment_hash === "string") handler(notification.payment_hash)
      }
      nwc.on("payment_received", listener)
      return () => nwc.off("payment_received", listener)
    },
    close: () => nwc.close(),
  }
}

// nostr-core's exchange rate (a public price service), for the optional euro approximation next
// to an amount in sats (decision 0001 F4). `at` is when the rate was fetched (ms).
export async function exchangeRate(currency: string): Promise<{ rate: number; at: number }> {
  const { rate, timestamp } = await (await loadCore()).getExchangeRate(currency)
  return { rate, at: timestamp }
}
