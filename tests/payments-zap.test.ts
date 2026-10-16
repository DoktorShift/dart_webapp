import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { installFakeLnurl, type FakeLnurl } from "./support/fake-lnurl.ts"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { fetchPayEndpoint, LnurlError } from "../lib/nostr/ext/lnurl.ts"
import { createLocalSigner } from "../lib/nostr/signers.ts"
import type { NostrEvent, Signer } from "../lib/nostr/types.ts"
import { addressInvoice } from "../lib/payments/invoices.ts"
import { pay, recordReceipt, type PaymentEntry } from "../lib/payments/journal.ts"
import { isReceiptFor, zapInvoice } from "../lib/payments/zap.ts"

// Congratulating with a zap (NIP-57) and paying a Lightning address (LUD-06/16): every invoice is
// checked before it is paid, and only a receipt from the recipient's own Lightning service for
// exactly the paid invoice confirms a zap.

const RELAY = "ws://127.0.0.1:7777"
let core: Core
let signer: Signer
let mia: string
let service: FakeLnurl

before(async () => {
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = RELAY
  core = await loadCore()
  signer = await createLocalSigner(core.generateSecretKey())
  mia = core.getPublicKey(core.generateSecretKey())
})
beforeEach(async () => {
  await resetStorage()
  service = installFakeLnurl()
})
after(() => {
  delete process.env.NEXT_PUBLIC_BLUELINE_RELAYS
})

const CONNECTION = "wallet-a:app-1"
const fees = { connection: CONNECTION, payInvoice: async () => ({ feesMsat: 1000 }) }

async function zapped(amountMsat = 21_000): Promise<PaymentEntry> {
  const endpoint = await fetchPayEndpoint(service.address)
  const entry = await pay({ action: "zap:mia", once: false, counterpart: { name: "Mia", pubkey: mia }, invoice: () => zapInvoice({ recipient: mia, address: service.address, endpoint, amountMsat, comment: "Stark gespielt!", signer }) }, fees)
  assert.ok(entry !== "busy")
  return entry
}

const tag = (event: NostrEvent, name: string) => event.tags.find((t) => t[0] === name)

test("a zap request names the recipient, amount, receipt relays and service, signed by the profile", async () => {
  const entry = await zapped()
  service.uninstall()
  assert.equal(entry.via, "zap")
  assert.equal(entry.state, "paid")
  const request = entry.zap!.request
  assert.equal(request.kind, 9734)
  assert.equal(request.pubkey, await signer.getPublicKey())
  assert.ok(core.verifyEventSignature(request))
  assert.deepEqual(tag(request, "p"), ["p", mia])
  assert.deepEqual(tag(request, "amount"), ["amount", "21000"])
  assert.deepEqual(tag(request, "relays"), ["relays", RELAY])
  assert.equal(tag(request, "lnurl")?.[1], core.encodeLnurl("https://wallet.test/.well-known/lnurlp/mia"))
  assert.equal(request.content, "Stark gespielt!")
  assert.equal(entry.zap!.zapPubkey, service.servicePubkey)
  assert.deepEqual(entry.zap!.relays, [RELAY])
})

test("an invoice for another amount or for something else is refused, and nothing is paid", async () => {
  const paid: string[] = []
  const payer = { connection: CONNECTION, payInvoice: async (invoice: string) => (paid.push(invoice), { feesMsat: 0 }) }
  for (const misbehaving of [{ amountOffsetMsat: 1000 }, { wrongDescription: true }]) {
    service.uninstall()
    service = installFakeLnurl(misbehaving)
    const endpoint = await fetchPayEndpoint(service.address)
    const zap = () => zapInvoice({ recipient: mia, address: service.address, endpoint, amountMsat: 21_000, signer })
    await assert.rejects(pay({ action: "zap:x", once: false, counterpart: { name: "Mia", pubkey: mia }, invoice: zap }, payer), (error) => error instanceof LnurlError && error.code === "mismatch")
    const plain = () => addressInvoice(service.address, endpoint, 21_000)
    await assert.rejects(pay({ action: "pay:x", once: false, counterpart: { name: "Mia" }, invoice: plain }, payer), (error) => error instanceof LnurlError && error.code === "mismatch")
  }
  service.uninstall()
  assert.deepEqual(paid, [])
})

test("a Lightning address without zaps is still payable directly, never as a zap", async () => {
  service.uninstall()
  service = installFakeLnurl({ zaps: false })
  const endpoint = await fetchPayEndpoint(service.address)
  assert.equal(endpoint.zapPubkey, null)
  await assert.rejects(zapInvoice({ recipient: mia, address: service.address, endpoint, amountMsat: 21_000, signer }))
  const entry = await pay({ action: "pay:mia", once: false, counterpart: { name: "Mia", pubkey: mia }, invoice: () => addressInvoice(service.address, endpoint, 21_000) }, fees)
  service.uninstall()
  assert.ok(entry !== "busy")
  assert.deepEqual([entry.state, entry.via, entry.address, entry.zap], ["paid", "address", "mia@wallet.test", undefined])
})

test("zap receipts: only the service's receipt for exactly the paid invoice confirms the zap", async () => {
  const entry = await zapped()
  const other = await zapped(42_000)
  service.uninstall()
  const genuine = service.receipt(entry.invoice!)
  assert.equal(await isReceiptFor(entry, genuine), true)

  const impostor = core.generateSecretKey()
  assert.equal(await isReceiptFor(entry, service.receipt(entry.invoice!, { signer: impostor })), false, "signed by someone else")
  assert.equal(await isReceiptFor(entry, service.receipt(other.invoice!)), false, "a receipt for another zap")
  assert.equal(await isReceiptFor(entry, { ...genuine, content: "changed" }), false, "changed after signing")
  const elsewhere = core.finalizeEvent({ ...genuine, tags: genuine.tags.map((t) => (t[0] === "p" ? ["p", core.getPublicKey(impostor)] : t)) }, service.serviceKey)
  assert.equal(await isReceiptFor(entry, elsewhere), false, "names another recipient")
  const lessPaid = { ...entry, amountMsat: 1000 }
  assert.equal(await isReceiptFor(lessPaid, genuine), false, "for another amount")
})

test("a checked receipt confirms an unknown zap as paid, once", async () => {
  const endpoint = await fetchPayEndpoint(service.address)
  const silent = { connection: CONNECTION, payInvoice: async () => Promise.reject(new Error("no answer")) }
  const unknown = await pay({ action: "zap:mia", once: false, counterpart: { name: "Mia", pubkey: mia }, invoice: () => zapInvoice({ recipient: mia, address: service.address, endpoint, amountMsat: 21_000, signer }) }, silent)
  service.uninstall()
  assert.ok(unknown !== "busy")
  assert.equal(unknown.state, "unknown")
  const receipt = service.receipt(unknown.invoice!)
  const confirmed = await recordReceipt(unknown.id, receipt.id)
  assert.deepEqual([confirmed?.state, confirmed?.zap?.receipt], ["paid", receipt.id])
  // A second delivery of a receipt changes nothing.
  assert.deepEqual(await recordReceipt(unknown.id, "another"), confirmed)
})

test("a service that sends its invoice in capitals: checked, paid once, and its receipt confirms the zap", async () => {
  service.uninstall()
  service = installFakeLnurl({ upperCase: true })
  const entry = await zapped()
  service.uninstall()
  assert.equal(entry.invoice, service.issued[0].invoice.toLowerCase())
  const receipt = service.receipt(entry.invoice!)
  assert.equal(tag(receipt, "bolt11")?.[1], service.issued[0].invoice, "the receipt names the invoice in capitals")
  assert.equal(await isReceiptFor(entry, receipt), true)
})

test("a Lightning address service that doesn't answer is given up after ten seconds", async (t) => {
  service.uninstall()
  service = installFakeLnurl({ hang: true })
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const asking = fetchPayEndpoint(service.address)
  let settled = false
  asking.catch(() => {}).finally(() => (settled = true))
  const turn = () => new Promise((resolve) => setImmediate(resolve))
  while (service.requests.length === 0) await turn()
  t.mock.timers.tick(9_999)
  await turn()
  assert.equal(settled, false, "still waiting before ten seconds")
  t.mock.timers.tick(1)
  await assert.rejects(asking, (error) => error instanceof LnurlError && error.code === "unreachable")
  service.uninstall()
})
