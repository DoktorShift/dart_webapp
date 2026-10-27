import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultCurrency, fiatFromMsat, formatBitcoin, formatFiat, formatFiatOf, isRateOld, parseFiat, unitsFromFiat, type Rate } from "../lib/payments/money.ts"
import { describeAction } from "../lib/payments/actions.ts"
import { refreshRate, resetRates, peekRate } from "../lib/payments/rate.ts"

const rate: Rate = { rate: 62_900, at: 1_000, currency: "EUR" }
// Intl puts non-breaking spaces between number and sign; the tests read them as plain ones.
const plain = (text: string | null) => text?.replace(/[\u00a0\u202f]/g, " ") ?? null
const bitcoin = (intl: string, msat: number) => plain(formatBitcoin(intl, msat))
const fiat = (intl: string, amount: number, currency: "EUR" | "USD") => plain(formatFiat(intl, amount, currency))

test("bitcoin amounts are whole units with the sign where the language puts it", () => {
  assert.equal(bitcoin("de-DE", 7_950_000), "7.950 ₿")
  assert.equal(bitcoin("en-GB", 7_950_000), "₿7,950")
  assert.equal(bitcoin("de-DE", 1000), "1 ₿")
  assert.equal(bitcoin("de-DE", 0), "0 ₿")
  // A fee under one unit is said as such, never as nothing.
  assert.equal(bitcoin("de-DE", 300), "< 1 ₿")
  assert.equal(bitcoin("en-GB", 300), "< ₿1")
  assert.equal(bitcoin("de-DE", -4_900_000), "−4.900 ₿")
})

test("fiat amounts follow the locale and say when they are under a cent", () => {
  assert.equal(fiat("de-DE", 5, "EUR"), "5,00 €")
  assert.equal(fiat("en-GB", 5, "EUR"), "€5.00")
  assert.equal(fiat("en-GB", 5, "USD"), "US$5.00")
  assert.equal(fiat("de-DE", 0.004, "EUR"), "< 0,01 €")
  assert.equal(fiat("de-DE", -3.1, "EUR"), "−3,10 €")
  assert.equal(plain(formatFiatOf("de-DE", 7_950_000, rate)), "5,00 €")
  assert.equal(formatFiatOf("de-DE", 7_950_000, null), null)
})

test("fiat and units convert both ways, in whole units, at least one", () => {
  assert.equal(unitsFromFiat(5, rate), 7949)
  assert.equal(unitsFromFiat(0.0001, rate), 1)
  assert.ok(Math.abs(fiatFromMsat(7_949_000, rate) - 5) < 0.001)
})

test("typed fiat amounts take a comma or a point, two decimals at most", () => {
  assert.equal(parseFiat("5"), 5)
  assert.equal(parseFiat("5,50"), 5.5)
  assert.equal(parseFiat("5.5"), 5.5)
  assert.equal(parseFiat(" 12 "), 12)
  assert.equal(parseFiat("5,555"), null)
  assert.equal(parseFiat("0"), null)
  assert.equal(parseFiat("abc"), null)
})

test("the currency follows the region, euro otherwise", () => {
  assert.equal(defaultCurrency("de-DE"), "EUR")
  assert.equal(defaultCurrency("de-CH"), "CHF")
  assert.equal(defaultCurrency("en-GB"), "GBP")
  assert.equal(defaultCurrency("en-US"), "USD")
  assert.equal(defaultCurrency("en"), "EUR")
  assert.equal(defaultCurrency(undefined), "EUR")
})

test("a rate older than an hour is said with its date", () => {
  assert.equal(isRateOld({ ...rate, at: 0 }, 59 * 60 * 1000), false)
  assert.equal(isRateOld({ ...rate, at: 0 }, 61 * 60 * 1000), true)
})

test("a payment's action names its game and kind", () => {
  assert.deepEqual(describeAction("stake:m1"), { kind: "stake", matchId: "m1" })
  assert.deepEqual(describeAction("pay:m1:p:2"), { kind: "pay", matchId: "m1", playerId: "p:2" })
  assert.deepEqual(describeAction("receive:m1"), { kind: "receive", matchId: "m1" })
  assert.deepEqual(describeAction("congratulate:m1:abc"), { kind: "congratulate", matchId: "m1", pubkey: "abc" })
  assert.deepEqual(describeAction("congratulate:abc"), { kind: "congratulate", pubkey: "abc" })
  assert.deepEqual(describeAction("single:xyz"), { kind: "single" })
})

test("the rate is fetched at most once a minute and kept when a fetch fails", async () => {
  resetRates()
  let now = 10_000
  let calls = 0
  const fetcher = async () => {
    calls++
    if (calls === 2) throw new Error("down")
    return { rate: 60_000 + calls, at: now }
  }
  const first = await refreshRate("EUR", { fetcher, now: () => now })
  assert.equal(first?.rate, 60_001)
  // Fresh enough: not asked again.
  await refreshRate("EUR", { fetcher, now: () => now })
  assert.equal(calls, 1)
  // A minute later a failed fetch leaves the known rate.
  now += 61_000
  const kept = await refreshRate("EUR", { fetcher, now: () => now })
  assert.equal(calls, 2)
  assert.equal(kept?.rate, 60_001)
  now += 61_000
  const fresh = await refreshRate("EUR", { fetcher, now: () => now })
  assert.equal(fresh?.rate, 60_003)
  assert.equal(peekRate("EUR")?.rate, 60_003)
  resetRates()
})

test("each currency is fetched on its own, also while another one is on its way", async () => {
  resetRates()
  const asked: string[] = []
  let release = () => {}
  const slow = new Promise<void>((resolve) => (release = resolve))
  const fetcher = async (currency: string) => {
    asked.push(currency)
    if (currency === "eur") await slow
    return { rate: currency === "eur" ? 60_000 : 55_000, at: LATER }
  }
  // Long after the rates an earlier test kept on the device.
  const LATER = 10_000_000_000
  const eur = refreshRate("EUR", { fetcher, now: () => LATER })
  const chf = await refreshRate("CHF", { fetcher, now: () => LATER })
  assert.equal(chf?.rate, 55_000)
  release()
  assert.equal((await eur)?.rate, 60_000)
  assert.deepEqual(asked, ["eur", "chf"])
  resetRates()
})
