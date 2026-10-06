// Payments against a NIP-47 wallet service (tests/support/fake-wallet.ts) on a local nak relay,
// through nostr-core's NWC class: connecting, paying, receiving, and every way a payment can
// go wrong without ever being paid twice. Run: npm run test:relay
import "../storage-helpers.ts"
import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "@noble/hashes/utils.js"
import { encodeInvoice } from "../support/bolt11.ts"
import { startFakeWallet, ALL_METHODS, type FakeWallet, type FakeWalletOptions } from "../support/fake-wallet.ts"
import { installFakeLnurl } from "../support/fake-lnurl.ts"
import { startRelay, type NakRelay } from "../support/nak.ts"
import { resetStorage } from "../storage-helpers.ts"
import { publish, relayClient } from "../../lib/nostr/client.ts"
import { fetchPayEndpoint } from "../../lib/nostr/ext/lnurl.ts"
import { createLocalSigner } from "../../lib/nostr/signers.ts"
import { connectWallet, WalletError } from "../../lib/nostr/wallet.ts"
import { dbGetAll, dbPut } from "../../lib/storage/db.ts"
import { makeIncoming, scannedInvoice } from "../../lib/payments/invoices.ts"
import { checkStatus, markReceived, pay, type PaymentEntry } from "../../lib/payments/journal.ts"
import { capabilities, connectNewWallet, loadWallet, removeWallet, withWallet } from "../../lib/payments/wallet.ts"
import { watchReceipt, zapInvoice } from "../../lib/payments/zap.ts"

let relay: NakRelay
const wallets: FakeWallet[] = []
const nodeKey = randomBytes(32)

before(async () => {
  relay = await startRelay()
  // Zap receipts go to (and are read from) BlueLine's general relays: here, only this one.
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
})
beforeEach(resetStorage)
after(async () => {
  delete process.env.NEXT_PUBLIC_BLUELINE_RELAYS
  for (const wallet of wallets) wallet.stop()
  relayClient().close()
  await relay?.stop()
})

async function fakeWallet(options: Partial<FakeWalletOptions> = {}) {
  const wallet = await startFakeWallet({ relay: relay.url, ...options })
  wallets.push(wallet)
  return wallet
}

const invoice = (amountMsat = 500_000) => encodeInvoice({ amountMsat, timestamp: Math.floor(Date.now() / 1000), expirySeconds: 600, paymentHash: randomBytes(32), nodeKey })
const stake = (text: string, action = "stake:m1") => ({ action, once: true, counterpart: { name: "Mia" }, invoice: () => scannedInvoice(text, 500_000) })
const entryOf = (result: PaymentEntry | "busy" | null) => {
  assert.ok(result && result !== "busy")
  return result
}
const pays = (wallet: FakeWallet) => wallet.requests.filter((method) => method === "pay_invoice").length

test("connecting keeps what the wallet allows, and its secret only sealed", async () => {
  const wallet = await fakeWallet({ lud16: "mia@wallet.test" })
  const info = await connectNewWallet(wallet.uri)
  assert.equal(info.alias, "Testwallet")
  assert.deepEqual(info.methods, ALL_METHODS)
  assert.equal(info.encryption, "nip44")
  assert.equal(info.lightningAddress, "mia@wallet.test")
  assert.deepEqual(info.relays, [relay.url])
  // The connection is named by the wallet's key and the app's key in it, never by its secret.
  assert.match(info.connection, new RegExp(`^${wallet.walletPubkey}:[0-9a-f]{64}$`))
  assert.deepEqual(capabilities(info), { pay: true, receive: true, lookup: true, balance: true, budget: true, notifies: false })
  assert.deepEqual(await loadWallet(), info)
  const secret = new URL(wallet.uri.replace("nostr+walletconnect://", "http://")).searchParams.get("secret")!
  const stored = JSON.stringify(await dbGetAll("kv"), (_key, value) => (value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value))
  assert.ok(!stored.includes(secret), "the connection's secret is never stored in the clear")
  await removeWallet()
  assert.equal(await loadWallet(), null)
})

test("paying an invoice: journal first, then paid with the wallet's fees", async () => {
  const wallet = await fakeWallet()
  await connectNewWallet(wallet.uri)
  const text = invoice()
  const paid = entryOf(await withWallet((w) => pay(stake(text), w)))
  assert.equal(paid.state, "paid")
  assert.equal(paid.feesMsat, 1000)
  assert.equal(wallet.balanceMsat, 1_000_000 - 500_000 - 1000)
  // The stake is done: asking again shows the payment, the wallet hears nothing.
  assert.equal(entryOf(await withWallet((w) => pay(stake(invoice()), w))).id, paid.id)
  assert.equal(pays(wallet), 1)
})

test("timeout after success: unknown, never paid again, cleared up by Status prüfen", async () => {
  const wallet = await fakeWallet()
  await connectNewWallet(wallet.uri)
  wallet.payBehaviour = "silent"
  const unknown = entryOf(await withWallet((w) => pay(stake(invoice()), w), { replyTimeoutMs: 1500 }))
  assert.deepEqual([unknown.state, unknown.problem], ["unknown", "no-answer"])
  assert.equal(entryOf(await withWallet((w) => pay(stake(invoice()), w))).state, "unknown")
  assert.equal(pays(wallet), 1, "the wallet was asked to pay exactly once")
  const checked = entryOf(await withWallet((w) => checkStatus(unknown.id, w)))
  assert.equal(checked.state, "paid")
  assert.equal(wallet.paid.get(unknown.id), 1)
})

test("after switching wallets, Status prüfen never calls a payment of the old one unpaid", async () => {
  const first = await fakeWallet()
  await connectNewWallet(first.uri)
  first.payBehaviour = "silent"
  const unknown = entryOf(await withWallet((w) => pay(stake(invoice()), w), { replyTimeoutMs: 1500 }))
  assert.equal(first.paid.get(unknown.id), 1, "the first wallet paid, its answer was lost")
  // The invoice runs out; "Verbindung entfernen", then another wallet is connected.
  await dbPut("payments", { ...unknown, expiresAt: Math.floor(Date.now() / 1000) - 1 })
  await removeWallet()
  const second = await fakeWallet()
  const info = await connectNewWallet(second.uri)
  assert.notEqual(info.connection, unknown.connection)
  // The second wallet doesn't know the payment (NOT_FOUND): that proves nothing.
  assert.equal(entryOf(await withWallet((w) => checkStatus(unknown.id, w))).state, "unknown")
  assert.equal(entryOf(await withWallet((w) => pay(stake(invoice()), w))).id, unknown.id)
  assert.equal(pays(second), 0, "the stake is not paid a second time")
})

test("wallet errors are failures, each with its reason, and nothing left the wallet", async () => {
  const poor = await fakeWallet({ balanceMsat: 100_000 })
  await connectNewWallet(poor.uri)
  const insufficient = entryOf(await withWallet((w) => pay(stake(invoice(), "stake:a"), w)))
  assert.deepEqual([insufficient.state, insufficient.problem], ["failed", "insufficient"])

  const limited = await fakeWallet({ budget: { totalMsat: 600_000, usedMsat: 300_000 } })
  await connectNewWallet(limited.uri)
  assert.deepEqual(await withWallet((w) => w.getBudget()), { usedMsat: 300_000, totalMsat: 600_000, renewsAt: null, renewalPeriod: "monthly" })
  const quota = entryOf(await withWallet((w) => pay(stake(invoice(), "stake:b"), w)))
  assert.deepEqual([quota.state, quota.problem], ["failed", "quota"])

  const broken = await fakeWallet()
  await connectNewWallet(broken.uri)
  broken.payBehaviour = { error: "INTERNAL" }
  const text = invoice()
  const failed = entryOf(await withWallet((w) => pay(stake(text, "stake:c"), w)))
  assert.deepEqual([failed.state, failed.problem], ["failed", "failed"])
  // A refused payment may be tried again, with the same invoice.
  broken.payBehaviour = "answer"
  assert.equal(entryOf(await withWallet((w) => pay(stake(text, "stake:c"), w))).state, "paid")
  assert.equal([...poor.paid.values(), ...limited.paid.values()].length, 0)
})

test("an older wallet that only knows NIP-04 still connects and pays", async () => {
  const wallet = await fakeWallet({ encryption: "nip04" })
  const info = await connectNewWallet(wallet.uri)
  assert.equal(info.encryption, "nip04")
  assert.equal(entryOf(await withWallet((w) => pay(stake(invoice()), w))).state, "paid")
  assert.equal(pays(wallet), 1)
})

test("receiving: make an invoice, see it paid by notification and by lookup", async () => {
  const wallet = await fakeWallet({ notifications: true })
  const info = await connectNewWallet(wallet.uri)
  assert.equal(capabilities(info).notifies, true)
  await withWallet(async (w) => {
    const entry = await makeIncoming(w, { action: "receive:1", once: true, counterpart: { name: "Tom" }, amountMsat: 500_000 })
    assert.deepEqual([entry.state, entry.direction, entry.amountMsat], ["waiting", "in", 500_000])
    assert.equal(entryOf(await checkStatus(entry.id, w)).state, "waiting")
    const heard = new Promise<string>((resolve) => w.onPaymentReceived(resolve))
    // The listener's subscription reaches the relay a moment later; until then a notification is
    // dropped, which is why the app also asks the wallet while a code is shown.
    for (let tries = 0; !(await wallet.settle(entry.id)) && tries < 50; tries++) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await heard, entry.id)
    await markReceived(entry.id)
    assert.equal(entryOf(await checkStatus(entry.id, w)).state, "received")
  })
})

test("a connection without make_invoice can't receive, and says so", async () => {
  const wallet = await fakeWallet({ methods: ["pay_invoice", "get_info"] })
  const info = await connectNewWallet(wallet.uri)
  assert.deepEqual(capabilities(info), { pay: true, receive: false, lookup: false, balance: false, budget: false, notifies: false })
  await assert.rejects(
    withWallet((w) => w.makeInvoice({ amountMsat: 1000, description: "x", expirySeconds: 60 })),
    (error) => error instanceof WalletError && error.code === "restricted",
  )
})

test("a wallet that is offline doesn't answer; one whose relay is gone can't be reached", async () => {
  const wallet = await fakeWallet()
  wallet.stop()
  await assert.rejects(connectWallet(wallet.uri), (error) => error instanceof WalletError && error.code === "no-answer")
  const gone = await startRelay()
  await gone.stop()
  const elsewhere = wallet.uri.replace(encodeURIComponent(relay.url), encodeURIComponent(gone.url))
  await assert.rejects(connectWallet(elsewhere), (error) => error instanceof WalletError && error.code === "unreachable")
})

test("text that is not a wallet connection is refused before anything is sent", async () => {
  await assert.rejects(connectWallet(invoice()), (error) => error instanceof WalletError && error.code === "invalid")
  await assert.rejects(connectWallet("nostr+walletconnect://abc?relay=wss://relay.example&secret=00"), (error) => error instanceof WalletError && error.code === "invalid")
})

test("a zap paid through the wallet is confirmed by its receipt at the relays, never by a forged one", async () => {
  const wallet = await fakeWallet()
  await connectNewWallet(wallet.uri)
  const service = installFakeLnurl()
  const signer = await createLocalSigner(randomBytes(32))
  const mia = await (await createLocalSigner(randomBytes(32))).getPublicKey()
  try {
    const endpoint = await fetchPayEndpoint(service.address)
    const zap = () => zapInvoice({ recipient: mia, address: service.address, endpoint, amountMsat: 21_000, signer })
    const paid = entryOf(await withWallet((w) => pay({ action: "zap:mia", once: false, counterpart: { name: "Mia", pubkey: mia }, invoice: zap }, w)))
    assert.deepEqual([paid.state, paid.zap?.receipt], ["paid", null])
    const confirmed = new Promise<PaymentEntry>((resolve) => watchReceipt(paid, resolve))
    // Someone else's receipt for the same invoice first: ignored.
    await publish(service.receipt(paid.invoice!, { signer: randomBytes(32) }), [relay.url])
    const genuine = service.receipt(paid.invoice!)
    await publish(genuine, [relay.url])
    const entry = await confirmed
    assert.equal(entry.zap?.receipt, genuine.id)
    assert.equal(pays(wallet), 1)
  } finally {
    service.uninstall()
  }
})
