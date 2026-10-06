import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { localStore, resetStorage } from "./storage-helpers.ts"
import { PROFILE_KV_PREFIX } from "../lib/profile/session.ts"
import { WALLET_KEY } from "../lib/payments/in-use.ts"
import { acceptWalletReturn, forgetReturnedConnection, returnedConnection, walletAppLink } from "../lib/payments/wallet-return.ts"

// The wallet connection of this device: where it is kept, and the answer of a wallet app that
// created one ("Wallet-App öffnen"), which counts only as the answer to this device's own request.

beforeEach(async () => {
  await resetStorage()
  forgetReturnedConnection()
})

const URI = "nostr+walletconnect://" + "a".repeat(64) + "?relay=wss%3A%2F%2Frelay.example&secret=" + "b".repeat(64)
const ORIGIN = "https://blueline.example"

// What the wallet app opens: the callback it was given, with the connection added.
function answerTo(link: string, connection = URI) {
  const callback = new URL(link).searchParams.get("callback")!
  return { payload: callback.slice(callback.indexOf("#wallet-return=") + "#wallet-return=".length) + `?value=${encodeURIComponent(connection)}`, search: "" }
}

test("the wallet connection is a profile key: it goes when the profile signs out", () => {
  assert.ok(WALLET_KEY.startsWith(PROFILE_KV_PREFIX))
})

test("a wallet app's answer to this device's request is held for the connect screen", () => {
  const { payload, search } = answerTo(walletAppLink(ORIGIN))
  assert.equal(acceptWalletReturn(payload, search), "connection")
  assert.equal(returnedConnection(), URI)
})

test("the answer may come in the page's query instead of the fragment", () => {
  const link = walletAppLink(ORIGIN)
  const id = new URL(link).searchParams.get("callback")!.split("#wallet-return=")[1]
  assert.equal(acceptWalletReturn(id, `?value=${encodeURIComponent(URI)}`), "connection")
  assert.equal(returnedConnection(), URI)
})

test("a connection nobody asked for on this device is refused", () => {
  assert.equal(acceptWalletReturn(`?value=${encodeURIComponent(URI)}`, ""), "unrequested")
  // With a request open, a link without it or with another one is refused too.
  walletAppLink(ORIGIN)
  assert.equal(acceptWalletReturn(`?value=${encodeURIComponent(URI)}`, ""), "unrequested")
  assert.equal(acceptWalletReturn(`${"0".repeat(32)}?value=${encodeURIComponent(URI)}`, ""), "unrequested")
  assert.equal(returnedConnection(), null)
})

test("an answer counts once: the same link opened again is refused", () => {
  const { payload, search } = answerTo(walletAppLink(ORIGIN))
  assert.equal(acceptWalletReturn(payload, search), "connection")
  forgetReturnedConnection()
  assert.equal(acceptWalletReturn(payload, search), "unrequested")
  assert.equal(returnedConnection(), null)
})

test("a request is answered within ten minutes or not at all", () => {
  const asked = Date.now()
  const late = answerTo(walletAppLink(ORIGIN, asked))
  assert.equal(acceptWalletReturn(late.payload, late.search, asked + 10 * 60_000 + 1), "unrequested")
  const inTime = answerTo(walletAppLink(ORIGIN, asked))
  assert.equal(acceptWalletReturn(inTime.payload, inTime.search, asked + 9 * 60_000), "connection")
})

test("an answer without a connection (cancelled in the wallet app) is no answer", () => {
  const link = walletAppLink(ORIGIN)
  const id = new URL(link).searchParams.get("callback")!.split("#wallet-return=")[1]
  assert.equal(acceptWalletReturn(id, ""), null)
  // The request stays open for the real answer.
  assert.equal(acceptWalletReturn(`${id}?value=${encodeURIComponent(URI)}`, ""), "connection")
})

test("without storage no request can be noted, so no answer is taken", () => {
  localStore.failWrites = true
  const { payload, search } = answerTo(walletAppLink(ORIGIN))
  assert.equal(acceptWalletReturn(payload, search), "unrequested")
})
