import { test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "@noble/hashes/utils.js"
import { encodeInvoice } from "./support/bolt11.ts"
import { invoiceIn, scanKind, scannedInvoice } from "../lib/payments/invoices.ts"
import { deviceSide, MAX_SATS, readStake, STAKE_EXTRA, stakeParties } from "../lib/payments/stake.ts"

// The stake noted in setup ("Verlierer zahlt"), who pays whom after the game, and what the
// payment scanners take: an invoice only, never a wallet connection.

const TOM = { id: "pl_tom", name: "Tom" }
const MIA = { id: "pl_mia", name: "Mia" }
const withStake = (sats: unknown, winner = 1, players = [TOM, MIA]) => ({ players, winner, extras: { [STAKE_EXTRA]: { sats } } })

test("a stake is a whole number of sats up to the maximum; anything else is no stake", () => {
  assert.deepEqual(readStake({ sats: 500 }), { sats: 500 })
  assert.deepEqual(readStake({ sats: MAX_SATS }), { sats: MAX_SATS })
  for (const value of [undefined, null, {}, { sats: 0 }, { sats: -5 }, { sats: 1.5 }, { sats: "500" }, { sats: MAX_SATS + 1 }]) assert.equal(readStake(value), null)
})

test("the loser pays the winner, only between two players", () => {
  assert.deepEqual(stakeParties(withStake(500)), { payer: TOM, payee: MIA, sats: 500 })
  assert.deepEqual(stakeParties(withStake(500, 0)), { payer: MIA, payee: TOM, sats: 500 })
  assert.equal(stakeParties(withStake(500, 0, [TOM, MIA, { id: "pl_ben", name: "Ben" }])), null)
  assert.equal(stakeParties(withStake(500, 0, [TOM])), null)
  assert.equal(stakeParties({ players: [TOM, MIA], winner: 1 }), null)
})

test("this device's side, when a player is linked to the signed-in profile", () => {
  const parties = stakeParties(withStake(500))!
  const linked = (id: string) => ({ pl_tom: "aa", pl_mia: "bb" })[id]
  assert.equal(deviceSide(parties, linked, "aa"), "payer")
  assert.equal(deviceSide(parties, linked, "bb"), "payee")
  assert.equal(deviceSide(parties, linked, "cc"), null)
  assert.equal(deviceSide(parties, linked, null), null)
})

test("scanners tell an invoice from a wallet connection", async () => {
  const invoice = encodeInvoice({ amountMsat: 500_000, timestamp: Math.floor(Date.now() / 1000), expirySeconds: 600, paymentHash: randomBytes(32), nodeKey: randomBytes(32) })
  assert.equal(invoiceIn(invoice.toUpperCase()), invoice)
  assert.equal(invoiceIn(`lightning:${invoice}`), invoice)
  assert.equal(invoiceIn(`LIGHTNING:${invoice.toUpperCase()}`), invoice)
  assert.equal(invoiceIn(`bitcoin:bc1qexample?amount=0.000005&lightning=${invoice}`), invoice)
  assert.equal(scanKind(invoice), "invoice")
  const wallet = `nostr+walletconnect://${"b".repeat(64)}?relay=wss%3A%2F%2Frelay.example.com&secret=${"c".repeat(64)}`
  assert.equal(scanKind(wallet), "wallet")
  assert.equal(scanKind("https://blueline21.netlify.app/#club=abc"), "other")
  assert.equal(scanKind(wallet.replace("wss%3A%2F%2F", "ws%3A%2F%2F")), "other", "a wallet only reachable without encryption")
  assert.equal((await scannedInvoice(invoice, 500_000)).checked.amountMsat, 500_000)
  const open = encodeInvoice({ timestamp: Math.floor(Date.now() / 1000), paymentHash: randomBytes(32), nodeKey: randomBytes(32) })
  await assert.rejects(scannedInvoice(open), { problem: "no-amount" })
})
