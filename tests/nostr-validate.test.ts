import { before, test } from "node:test"
import assert from "node:assert/strict"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js"
import { loadCore, type Core } from "../lib/nostr/core.ts"
import { checkInvoice, validateBadgeAward, validateZapReceipt } from "../lib/nostr/ext/validate.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { encodeInvoice } from "./support/bolt11.ts"
// nostr-core directly: these tests show its gaps next to the strict checks.
import { validateBadgeAward as coreValidateBadgeAward, validateZapReceipt as coreValidateZapReceipt } from "nostr-core"

let core: Core
let organizer: Uint8Array
let impostor: Uint8Array
let player: string
let lnurlServer: Uint8Array
let sender: Uint8Array
let definition: NostrEvent

const now = Math.floor(Date.now() / 1000)

before(async () => {
  core = await loadCore()
  organizer = core.generateSecretKey()
  impostor = core.generateSecretKey()
  player = core.getPublicKey(core.generateSecretKey())
  lnurlServer = core.generateSecretKey()
  sender = core.generateSecretKey()
  definition = core.finalizeEvent({ kind: 30009, content: "", created_at: now, tags: [["d", "club-champion-2026"], ["name", "Clubmeister 2026"]] }, organizer)
})

const award = (key: Uint8Array, tags?: string[][]) =>
  core.finalizeEvent({ kind: 8, content: "", created_at: now, tags: tags ?? [["a", `30009:${core.getPublicKey(organizer)}:club-champion-2026`], ["p", player]] }, key)

test("NIP-58: an award by the badge's author, for this badge, naming the player, is valid", async () => {
  assert.deepEqual(await validateBadgeAward(award(organizer), definition, player), { ok: true })
  assert.deepEqual(await validateBadgeAward(award(organizer), definition), { ok: true })
})

test("NIP-58: an award signed by anyone else is refused (nostr-core 1.0.6 accepts it)", async () => {
  const forged = award(impostor)
  const result = await validateBadgeAward(forged, definition, player)
  assert.equal(result.ok, false)
  // The gap this module closes (NC-15): nostr-core only compares kinds and the a tag.
  assert.equal(coreValidateBadgeAward(forged, definition), true)
})

test("NIP-58: wrong recipient, wrong badge, broken signatures and wrong kinds are refused", async () => {
  const organizerPub = core.getPublicKey(organizer)
  assert.equal((await validateBadgeAward(award(organizer), definition, core.getPublicKey(impostor))).ok, false)
  assert.equal((await validateBadgeAward(award(organizer, [["a", `30009:${organizerPub}:other`], ["p", player]]), definition)).ok, false)
  assert.equal((await validateBadgeAward(award(organizer, [["a", `30009:${organizerPub}:club-champion-2026`]]), definition)).ok, false)
  const twoBadges = award(organizer, [["a", `30009:${organizerPub}:club-champion-2026`], ["a", `30009:${organizerPub}:other`], ["p", player]])
  assert.equal((await validateBadgeAward(twoBadges, definition)).ok, false)
  const tampered = { ...award(organizer), tags: [["a", `30009:${organizerPub}:club-champion-2026`], ["p", core.getPublicKey(impostor)]] }
  assert.equal((await validateBadgeAward(tampered, definition)).ok, false)
  const tamperedDefinition = { ...definition, tags: [["d", "club-champion-2026"], ["name", "Fake"]] }
  assert.equal((await validateBadgeAward(award(organizer), tamperedDefinition)).ok, false)
  assert.equal((await validateBadgeAward({ ...award(organizer), kind: 1 }, definition)).ok, false)
})

// --- invoices ---------------------------------------------------------------------------------

const nodeKey = randomBytes(32)
const paymentHash = randomBytes(32)

test("invoice check: amount, remaining validity and description hash", async () => {
  const descriptionHash = sha256(new TextEncoder().encode("Startgeld"))
  const invoice = encodeInvoice({ amountMsat: 21_000, timestamp: now - 10, expirySeconds: 600, paymentHash, descriptionHash, nodeKey })
  const ok = await checkInvoice(invoice, { amountMsat: 21_000, descriptionHash: bytesToHex(descriptionHash) })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.paymentHash, bytesToHex(paymentHash))
    assert.equal(ok.amountMsat, 21_000)
  }
  assert.equal((await checkInvoice(invoice, { amountMsat: 22_000 })).ok, false)
  assert.equal((await checkInvoice(invoice, { descriptionHash: "00".repeat(32) })).ok, false)
  const expired = encodeInvoice({ amountMsat: 21_000, timestamp: now - 3600, expirySeconds: 600, paymentHash, nodeKey })
  assert.equal((await checkInvoice(expired, { amountMsat: 21_000 })).ok, false)
  const nearlyExpired = encodeInvoice({ amountMsat: 21_000, timestamp: now - 590, expirySeconds: 600, paymentHash, nodeKey })
  assert.equal((await checkInvoice(nearlyExpired, { amountMsat: 21_000 })).ok, false)
  const zeroAmount = encodeInvoice({ timestamp: now, paymentHash, nodeKey })
  assert.equal((await checkInvoice(zeroAmount, { amountMsat: 21_000 })).ok, false)
  assert.equal((await checkInvoice("lnbc1garbage")).ok, false)
})

// --- zap receipts -----------------------------------------------------------------------------

function zap(options: { amountMsat?: number; invoiceAmountMsat?: number; signer?: Uint8Array; descriptionOverride?: string; receiptRecipient?: string; lnurl?: string } = {}) {
  const amount = options.amountMsat ?? 21_000
  const request = core.finalizeEvent(
    {
      kind: 9734,
      content: "Gut gespielt!",
      created_at: now - 5,
      tags: [["relays", "wss://nos.lol"], ["amount", String(amount)], ["p", player], ...(options.lnurl ? [["lnurl", options.lnurl]] : [])],
    },
    sender,
  )
  const description = JSON.stringify(request)
  const hashed = options.descriptionOverride ?? description
  const bolt11 = encodeInvoice({
    amountMsat: options.invoiceAmountMsat ?? amount,
    timestamp: now - 5,
    paymentHash: randomBytes(32),
    descriptionHash: sha256(new TextEncoder().encode(hashed)),
    nodeKey,
  })
  const receipt = core.finalizeEvent(
    {
      kind: 9735,
      content: "",
      created_at: now,
      tags: [["p", options.receiptRecipient ?? player], ["P", core.getPublicKey(sender)], ["bolt11", bolt11], ["description", description]],
    },
    options.signer ?? lnurlServer,
  )
  return { request, receipt }
}

test("NIP-57: a receipt from the recipient's Lightning service for the requested amount is valid", async () => {
  const { request, receipt } = zap()
  const expected = { nostrPubkey: core.getPublicKey(lnurlServer), request, recipient: player, amountMsat: 21_000 }
  assert.deepEqual(await validateZapReceipt(receipt, expected), { ok: true })
  assert.deepEqual(await validateZapReceipt(receipt, { nostrPubkey: core.getPublicKey(lnurlServer) }), { ok: true })
})

test("NIP-57: a receipt signed by any other key is refused (nostr-core 1.0.6 accepts it)", async () => {
  const { receipt } = zap({ signer: impostor })
  assert.equal((await validateZapReceipt(receipt, { nostrPubkey: core.getPublicKey(lnurlServer) })).ok, false)
  // The gap this module closes (NC-14): nostr-core checks only the receipt's own signature.
  assert.equal(coreValidateZapReceipt(receipt), true)
})

test("NIP-57: amount, description hash, recipient and request mismatches are refused", async () => {
  const nostrPubkey = core.getPublicKey(lnurlServer)
  assert.equal((await validateZapReceipt(zap({ invoiceAmountMsat: 1000 }).receipt, { nostrPubkey })).ok, false)
  assert.equal((await validateZapReceipt(zap({ descriptionOverride: "something else" }).receipt, { nostrPubkey })).ok, false)
  assert.equal((await validateZapReceipt(zap({ receiptRecipient: core.getPublicKey(impostor) }).receipt, { nostrPubkey })).ok, false)
  assert.equal((await validateZapReceipt(zap().receipt, { nostrPubkey, recipient: core.getPublicKey(impostor) })).ok, false)
  assert.equal((await validateZapReceipt(zap().receipt, { nostrPubkey, amountMsat: 5000 })).ok, false)
  // A receipt for a different zap request than the one we sent.
  assert.equal((await validateZapReceipt(zap().receipt, { nostrPubkey, request: zap({ amountMsat: 42_000 }).request })).ok, false)
  const { receipt } = zap()
  assert.equal((await validateZapReceipt({ ...receipt, content: "changed" }, { nostrPubkey })).ok, false)
  // The request names the recipient's LNURL; another one is refused, the same one in capitals passes.
  const named = zap({ lnurl: "lnurl1dp68gurn8ghj7player" }).receipt
  assert.equal((await validateZapReceipt(named, { nostrPubkey, lnurl: "lnurl1dp68gurn8ghj7other" })).ok, false)
  assert.equal((await validateZapReceipt(named, { nostrPubkey, lnurl: "LNURL1DP68GURN8GHJ7PLAYER" })).ok, true)
})
