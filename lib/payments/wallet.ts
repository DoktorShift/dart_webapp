// The wallet connection of this device ("Wallet verbinden", PLAN.md "Direkte Zahlungen").
//
// The connection text holds the wallet's secret. It is kept only sealed by the vault
// (lib/profile/vault.ts) under kv "profile.wallet": never in a backup, an export, a link or an
// event, and like everything named "profile.*" it is deleted when the profile signs out or another
// one signs in (lib/profile/session.ts). A guest can connect a wallet too: paying needs no profile.
// What the wallet allows (from get_info at connecting) is kept next to it in plain form, so the
// screens can tell without waking the wallet.
//
// Every task opens its own connection and closes it after (decision 0002 §8: a fresh connection
// with its get_info round trip before each payment).
import { connectWallet, parseWalletUri, type WalletClient, type WalletOptions } from "../nostr/wallet.ts"
import { onSessionEnd, PROFILE_KV_PREFIX } from "../profile/session.ts"
import { openSecret, sealSecret, type SealedSecret } from "../profile/vault.ts"
import { dbGet, dbWrite, type Keyed } from "../storage/db.ts"

export const WALLET_KEY = `${PROFILE_KV_PREFIX}wallet`

export interface WalletInfo {
  // The name the wallet gives itself, if any.
  alias: string | null
  methods: string[]
  notifications: string[]
  // The wallet's own Lightning address from its connection, if it names one.
  lightningAddress: string | null
  // For "Erweitert": where the wallet listens and how the connection is encrypted.
  relays: string[]
  encryption: "nip44" | "nip04"
  // When it was connected (ms).
  connectedAt: number
}

interface StoredWallet {
  info: WalletInfo
  secret: SealedSecret
}

export interface Capabilities {
  pay: boolean
  receive: boolean
  // Can say what became of a payment ("Status prüfen").
  lookup: boolean
  balance: boolean
  // Alby's get_budget: the limit the wallet itself enforces.
  budget: boolean
  // Tells when a payment arrived; otherwise the app asks while an invoice is shown.
  notifies: boolean
}

export function capabilities(info: WalletInfo): Capabilities {
  const has = (method: string) => info.methods.includes(method)
  return {
    pay: has("pay_invoice"),
    receive: has("make_invoice"),
    lookup: has("lookup_invoice"),
    balance: has("get_balance"),
    budget: has("get_budget"),
    notifies: info.notifications.includes("payment_received"),
  }
}

const readStored = async () => (await dbGet<{ id: string; value: StoredWallet }>("kv", WALLET_KEY))?.value ?? null

export async function loadWallet(): Promise<WalletInfo | null> {
  return (await readStored())?.info ?? null
}

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// Connections open right now, closed when the profile's session ends.
const openClients = new Set<WalletClient>()

function track(client: WalletClient): WalletClient {
  openClients.add(client)
  return {
    ...client,
    close() {
      openClients.delete(client)
      client.close()
    },
  }
}

function closeAll() {
  for (const client of openClients) client.close()
  openClients.clear()
}

onSessionEnd(closeAll)

// Connects a wallet from its connection text and keeps it for this device, in place of any
// earlier one. Throws WalletError ("invalid", "unreachable", "no-answer", …).
export async function connectNewWallet(uri: string): Promise<WalletInfo> {
  const parsed = parseWalletUri(uri)
  const client = await connectWallet(uri)
  try {
    const info: WalletInfo = {
      alias: client.details.alias,
      methods: client.details.methods,
      notifications: client.details.notifications,
      lightningAddress: parsed?.lightningAddress ?? null,
      relays: parsed?.relays ?? [],
      encryption: client.details.encryption,
      connectedAt: Date.now(),
    }
    const stored: StoredWallet = { info, secret: await sealSecret(encode(uri.trim()), "wallet-connection") }
    await dbWrite([{ store: "kv", put: { id: WALLET_KEY, value: stored } as Keyed }])
    return info
  } finally {
    client.close()
  }
}

// Opens the stored wallet for one task; the caller closes it. Throws when none is stored or it
// can't be opened (the vault key went with a sign-out).
export async function openWallet(options?: WalletOptions): Promise<WalletClient> {
  const stored = await readStored()
  if (!stored) throw new Error("no wallet is connected on this device")
  return track(await connectWallet(decode(await openSecret(stored.secret, "wallet-connection")), options))
}

// Runs `task` with the stored wallet open, and closes it after.
export async function withWallet<T>(task: (wallet: WalletClient) => Promise<T>, options?: WalletOptions): Promise<T> {
  const wallet = await openWallet(options)
  try {
    return await task(wallet)
  } finally {
    wallet.close()
  }
}

// "Verbindung entfernen": the app forgets the connection. The permission in the wallet stays
// until it is revoked there; the screen says so.
export async function removeWallet(): Promise<void> {
  closeAll()
  await dbWrite([{ store: "kv", delete: WALLET_KEY }])
}
