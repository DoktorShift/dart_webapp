// P7b after review round 1: the fixed findings in a real browser, against NIP-47 wallet
// simulators on a local relay. No real wallet, no money, no public relay: the app is built with
// every relay replaced by the local one, the wallets are tests/support/fake-wallet.ts, Mia's
// Lightning address is answered by the route handler below, and the browser may only reach the
// app and 127.0.0.1. Reaching Zahlungen from the Profile tab needs the "profile.rows" slot list
// in the guest view (the profile track renders it; a scratch build adds it).
//
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:18975 npm run build && npx next start -p 3314 &
//   node docs/implementation/evidence/P7b/scripts/payments-review1.mjs <out dir> [scenario …]
//
// Scenarios: rows (result row at four sizes), return (wallet app answers: unrequested, requested,
// replayed, replacing), switch (unknown payment, wallet replaced, Status prüfen, settled by hand),
// address (a Lightning address that hangs: lookup, then the invoice request, cancelled), tabs (two
// windows, a payment that may be repeated), guest (what a guest loads), receive (a slow wallet
// while a code is shown: one connection). Every screenshot gets a layout audit that also flags
// clipped text (content wider than an element that hides its overflow).
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { gzipSync } from "node:zlib"
import { sha256 } from "@noble/hashes/sha2.js"
import { finalizeEvent, generateSecretKey, getPublicKey, Relay } from "nostr-core"
import { encodeInvoice } from "../../../../../tests/support/bolt11.ts"
import { connectWallet } from "../../../../../lib/nostr/wallet.ts"
import { startFakeWallet } from "../../../../../tests/support/fake-wallet.ts"
import { startRelay } from "../../../../../tests/support/nak.ts"

const BASE = process.env.BASE ?? "http://localhost:3314"
const OUT = process.argv[2] ?? "review1"
const ONLY = process.argv.slice(3)
const RELAY_PORT = 18975
mkdirSync(OUT, { recursive: true })

const relay = await startRelay({ port: RELAY_PORT })
const report = []
const log = (...parts) => {
  const line = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ")
  report.push(line)
  console.log(line)
}

// Mia's public profile names a Lightning address (answered by lightningAddress below).
const mia = generateSecretKey()
const METADATA = JSON.stringify([["text/plain", "Zahlung an Mia"]])
const nodeKey = randomBytes(32)
{
  const profileRelay = new Relay(relay.url, { reconnect: false })
  await profileRelay.connect()
  await profileRelay.publish(finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: "Mia", lud16: "mia@wallet.test" }) }, mia))
  profileRelay.close()
}

// LUD-06/16 for mia@wallet.test; `hang` leaves the endpoint or the invoice request unanswered.
function lightningAddress(url, hang) {
  const cors = { "access-control-allow-origin": "*" }
  if (url.pathname === "/.well-known/lnurlp/mia") {
    if (hang === "endpoint") return null
    return { json: { tag: "payRequest", callback: "https://wallet.test/callback", minSendable: 1000, maxSendable: 1_000_000_000, metadata: METADATA }, headers: cors }
  }
  if (hang === "invoice") return null
  const amountMsat = Number(url.searchParams.get("amount"))
  const pr = encodeInvoice({ amountMsat, timestamp: Math.floor(Date.now() / 1000), expirySeconds: 600, paymentHash: randomBytes(32), descriptionHash: sha256(new TextEncoder().encode(METADATA)), nodeKey })
  return { json: { pr, routes: [] }, headers: cors }
}

async function invoiceFrom(wallet, sats, expirySeconds = 600) {
  const client = await connectWallet(wallet.uri)
  try {
    return (await client.makeInvoice({ amountMsat: sats * 1000, description: "BlueLine Darts", expirySeconds })).invoice
  } finally {
    client.close()
  }
}

const audit = () => {
  const vw = innerWidth
  const shown = (el) => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false
    const s = getComputedStyle(el)
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight
  }
  const all = Array.from(document.querySelectorAll("body *")).filter(shown)
  const describe = (el) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}`
  const hidesOverflow = (el) => ["hidden", "clip"].includes(getComputedStyle(el).overflowX)
  return {
    pageScroll: document.scrollingElement.scrollWidth > vw + 1,
    offscreen: all.filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 }).map(describe).slice(0, 5),
    ellipsis: all.filter((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1).map(describe),
    // Text wider than an element that hides what doesn't fit: cut off without an ellipsis.
    // (Visually hidden text for VoiceOver, 1 px wide, doesn't count.)
    clipped: all.filter((el) => hidesOverflow(el) && el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim() !== "").map((el) => `${describe(el)} ${el.scrollWidth}>${el.clientWidth}`),
    small: all
      .filter((el) => el.matches("button, a[href], input, [role=radio], summary") && !el.closest("[data-vaul-handle]"))
      .map((el) => (el.matches("[role=switch]") && el.closest("label") ? el.closest("label") : el))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 })
      .map((el) => { const r = el.getBoundingClientRect(); return `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}` }),
  }
}

async function newContext(browser, { size = { width: 390, height: 844 }, scheme = "light", locale = "de" } = {}) {
  const touch = size.width < 1100
  const context = await browser.newContext({ viewport: size, colorScheme: scheme, locale: locale === "de" ? "de-DE" : "en-US", deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, serviceWorkers: "block" })
  await context.addInitScript((theme) => {
    localStorage.setItem("theme", theme)
    navigator.permissions.query = () => Promise.resolve({ state: "prompt" })
  }, scheme)
  context.foreign = []
  context.sockets = []
  context.lnurlHang = null
  // Relay messages to the page can be held back, as a slow wallet would (ms).
  context.delay = 0
  await context.route(/^https?:\/\//, (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) return route.continue()
    if (url.includes("api.coingecko.com")) return route.fulfill({ json: { bitcoin: { eur: 61_500 } }, headers: { "access-control-allow-origin": "*" } })
    if (url.startsWith("https://wallet.test/")) {
      const answer = lightningAddress(new URL(url), context.lnurlHang)
      return answer ? route.fulfill(answer) : undefined
    }
    context.foreign.push(url)
    return route.abort()
  })
  await context.routeWebSocket(/.*/, (ws) => {
    context.sockets.push(ws.url())
    if (!ws.url().startsWith(`ws://127.0.0.1:${RELAY_PORT}`)) return ws.close()
    const server = ws.connectToServer()
    ws.onMessage((message) => server.send(message))
    server.onMessage((message) => (context.delay ? setTimeout(() => ws.send(message), context.delay) : ws.send(message)))
  })
  return context
}

function helpers(page, name, de) {
  const dialog = () => page.getByRole("dialog")
  const shot = async (step) => {
    await page.waitForTimeout(500)
    const file = `${name}-${step}.png`
    await page.screenshot({ path: `${OUT}/${file}` })
    const a = await page.evaluate(audit)
    log(file, a.pageScroll || a.offscreen.length || a.ellipsis.length || a.clipped.length || a.small.length ? a : "layout ok")
  }
  const startGame = async (stake, linkMia = false) => {
    await page.goto(BASE)
    await page.waitForTimeout(1200)
    const done = page.getByRole("button", { name: de ? "Fertig" : "Done" }).first()
    if (await done.isVisible().catch(() => false)) {
      await done.click()
      await page.waitForTimeout(800)
    }
    await page.getByRole("button", { name: /^X01/ }).click()
    await page.waitForTimeout(500)
    const inputs = page.locator("main input")
    await inputs.nth(0).fill("Tom")
    await inputs.nth(1).fill("Mia")
    await page.getByRole("radio", { name: "301" }).click()
    if (stake) {
      await page.getByRole("button", { name: de ? /Einsatz/ : /Stake/ }).click()
      await page.getByRole("radio", { name: String(stake) }).click()
      await dialog().getByRole("button", { name: de ? "Übernehmen" : "Set Stake" }).click()
      await dialog().waitFor({ state: "detached" })
    }
    await page.getByRole("button", { name: de ? "Spiel starten" : "Start Game" }).click()
    await page.waitForTimeout(800)
    // Mia checks out 121 on her second visit.
    await page.evaluate(
      ({ linkMia, pubkey }) => {
        const key = "dart-scorer.current-match.v1"
        const saved = JSON.parse(localStorage.getItem(key))
        const d = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
        saved.throws = [d(1), d(1), d(1), d(20, 3), d(20, 3), d(20, 3), d(1), d(1), d(1), d(20, 3), d(17, 3), d(5, 2)]
        localStorage.setItem(key, JSON.stringify(saved))
        if (!linkMia) return
        const miaId = saved.config.players[1].id
        return new Promise((resolve) => {
          const open = indexedDB.open("blueline", 1)
          open.onsuccess = () => {
            const store = open.result.transaction("players", "readwrite").objectStore("players")
            const get = store.get(miaId)
            get.onsuccess = () => (store.put({ ...get.result, pubkey }).onsuccess = resolve)
          }
        })
      },
      { linkMia, pubkey: getPublicKey(mia) },
    )
    await page.reload()
    await page.waitForTimeout(1500)
  }
  const read = (store) =>
    page.evaluate(
      (name) =>
        new Promise((resolve) => {
          const open = indexedDB.open("blueline")
          open.onsuccess = () => {
            const request = open.result.transaction(name).objectStore(name).getAll()
            request.onsuccess = () => resolve(request.result)
          }
        }),
      store,
    )
  const journal = async () => (await read("payments")).map((e) => ({ id: e.id.slice(0, 8), action: e.action, state: e.state, problem: e.problem, byHand: e.resolvedByHand, connection: e.connection?.slice(0, 8) }))
  const walletAddress = async () => (await read("kv")).find((e) => e.id === "profile.wallet")?.value?.info?.lightningAddress ?? null
  const paste = async (label, text) => {
    const field = page.getByLabel(label).last()
    await field.fill(text)
    await field.press("Enter")
  }
  const toPayments = async () => {
    await page.goto(BASE)
    await page.waitForTimeout(1200)
    const done = page.getByRole("button", { name: de ? "Fertig" : "Done" }).first()
    if (await done.isVisible().catch(() => false)) {
      await done.click()
      await page.waitForTimeout(800)
    }
    await page.getByRole("navigation").getByRole("button", { name: de ? "Profil" : "Profile" }).filter({ visible: true }).click()
    await page.waitForTimeout(800)
    await page.getByRole("button", { name: de ? /^Zahlungen/ : /^Payments/ }).click()
    await page.waitForTimeout(1200)
  }
  return { dialog, shot, startGame, journal, walletAddress, paste, toPayments }
}

const pays = (wallet) => wallet.requests.filter((m) => m === "pay_invoice").length

// Finding 3: the result row says how the stake stands in full, at every size.
async function rows(browser) {
  for (const [name, size, scheme, locale] of [
    ["rows-de-light-se", { width: 320, height: 548 }, "light", "de"],
    ["rows-en-dark-se", { width: 320, height: 548 }, "dark", "en"],
    ["rows-de-dark-landscape", { width: 844, height: 390 }, "dark", "de"],
    ["rows-de-light-tablet", { width: 1024, height: 768 }, "light", "de"],
  ]) {
    const de = locale === "de"
    const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
    const payee = await startFakeWallet({ relay: relay.url })
    const context = await newContext(browser, { size, scheme, locale })
    const page = await context.newPage()
    const h = helpers(page, name, de)
    await h.startGame(500)
    await page.getByRole("button", { name: de ? "500 sats an Mia zahlen" : "Pay 500 sats to Mia" }).click()
    await h.dialog().getByRole("button", { name: de ? "500 sats an Mia zahlen" : "Pay 500 sats to Mia" }).click()
    await h.paste(de ? "Verbindung einfügen" : "Paste connection", payer.uri)
    await h.dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").waitFor({ timeout: 20_000 })
    await h.paste(de ? "Zahlungscode einfügen" : "Paste payment code", await invoiceFrom(payee, 500))
    await h.dialog().getByRole("button", { name: de ? "500 sats an Mia zahlen" : "Pay 500 sats to Mia" }).click()
    await h.dialog().getByText(de ? "sind bei Mia angekommen" : "reached Mia").waitFor({ timeout: 40_000 })
    await h.dialog().getByRole("button", { name: de ? "Fertig" : "Done" }).click()
    await page.waitForTimeout(800)
    await h.shot("result-paid")
    const row = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) => /bezahlt|paid to/.test(b.textContent))
      const fit = button.querySelector("span.block")
      return { text: button.textContent, font: getComputedStyle(fit).fontSize, client: fit.clientWidth, scroll: fit.scrollWidth, height: Math.round(button.getBoundingClientRect().height) }
    })
    log(name, "row", row, "pay_invoice", pays(payer), "foreign", context.foreign)
    payer.stop()
    payee.stop()
    await context.close()
  }
}

// Finding 1: a wallet app's answer counts only for this device's request, once, and only after
// the person confirmed it.
async function walletReturn(browser, variant) {
  const { name, size, scheme, locale } = variant
  const de = locale === "de"
  const mine = await startFakeWallet({ relay: relay.url, lud16: "me@mine.test" })
  const second = await startFakeWallet({ relay: relay.url, lud16: "second@mine.test" })
  const foreign = await startFakeWallet({ relay: relay.url, lud16: "attacker@evil.test" })
  const context = await newContext(browser, { size, scheme, locale })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  const h = helpers(page, name, de)
  const answer = (id, uri) => `#wallet-return=${id}?value=${encodeURIComponent(uri)}`

  await page.goto(BASE)
  await page.waitForTimeout(1500)
  await page.evaluate((hash) => (location.hash = hash), answer("", foreign.uri))
  await page.waitForTimeout(2500)
  await h.shot("01-unrequested")
  log(name, "unrequested link: wallet", await h.walletAddress())

  // "Wallet-App öffnen" notes a request; the wallet app answers it.
  await page.getByRole("button", { name: de ? "Wallet-App öffnen" : "Open Wallet App" }).click().catch(() => {})
  await page.waitForTimeout(500)
  if (!page.url().startsWith(BASE)) await page.goto(BASE)
  const request = await page.evaluate(() => JSON.parse(localStorage.getItem("blueline.wallet-request") ?? "null"))
  await page.evaluate((hash) => (location.hash = hash), answer(request.id, mine.uri))
  await page.getByText(de ? "Diese Wallet verbinden?" : "Connect this wallet?").waitFor({ timeout: 20_000 })
  await h.shot("02-confirm")
  log(name, "before confirming: wallet", await h.walletAddress())
  await page.getByRole("button", { name: de ? "Verbinden" : "Connect", exact: true }).click()
  await page.getByText(de ? "Verbunden" : "Connected", { exact: true }).waitFor({ timeout: 20_000 })
  await h.shot("03-connected")
  log(name, "after confirming: wallet", await h.walletAddress())

  // The same answer again: refused, nothing changes.
  await page.evaluate((hash) => (location.hash = hash), answer(request.id, foreign.uri))
  await page.waitForTimeout(2500)
  await h.shot("04-replayed")
  log(name, "replayed link: wallet", await h.walletAddress())

  // A requested answer while a wallet is connected says it replaces it; cancelled, nothing changes.
  await page.evaluate(() => localStorage.setItem("blueline.wallet-request", JSON.stringify({ id: "ab".repeat(16), at: Date.now() })))
  await page.evaluate((hash) => (location.hash = hash), answer("ab".repeat(16), second.uri))
  await page.getByText(de ? "Diese Wallet verbinden?" : "Connect this wallet?").waitFor({ timeout: 20_000 })
  await h.shot("05-confirm-replaces")
  await page.getByRole("button", { name: de ? "Abbrechen" : "Cancel" }).click()
  await page.waitForTimeout(800)
  log(name, "replacement cancelled: wallet", await h.walletAddress(), "errors", errors, "foreign", context.foreign)
  for (const wallet of [mine, second, foreign]) wallet.stop()
  await context.close()
}

// Finding 2 and 4: an unknown payment, the wallet replaced, Status prüfen through the new one, and
// settling it from what the old wallet shows.
async function walletSwitch(browser, variant) {
  const { name, size, scheme, locale } = variant
  const de = locale === "de"
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const payee = await startFakeWallet({ relay: relay.url })
  const other = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const context = await newContext(browser, { size, scheme, locale })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  const h = helpers(page, name, de)
  const payLabel = de ? "500 sats an Mia zahlen" : "Pay 500 sats to Mia"

  await h.startGame(500)
  await page.getByRole("button", { name: payLabel }).click()
  await h.dialog().getByRole("button", { name: payLabel }).click()
  await h.paste(de ? "Verbindung einfügen" : "Paste connection", payer.uri)
  await h.dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").waitFor({ timeout: 20_000 })
  await h.paste(de ? "Zahlungscode einfügen" : "Paste payment code", await invoiceFrom(payee, 500, 50))
  payer.payBehaviour = "silent"
  await h.dialog().getByRole("button", { name: payLabel }).click()
  await h.dialog().getByText(de ? "Zahlung noch nicht bestätigt" : "Payment not confirmed yet").waitFor({ timeout: 45_000 })
  await h.shot("01-unknown")
  log(name, "paid by the first wallet", payer.paid.size, await h.journal())
  // Let the code run out, then replace the wallet.
  await page.waitForTimeout(22_000)
  await page.keyboard.press("Escape")
  await h.toPayments()
  await page.getByRole("button", { name: de ? "Verbindung entfernen" : "Remove Connection" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: de ? "Entfernen" : "Remove" }).click()
  await page.waitForTimeout(800)
  await page.getByRole("button", { name: de ? "Wallet verbinden" : "Connect Wallet" }).first().click()
  await page.waitForTimeout(800)
  await h.paste(de ? "Verbindung einfügen" : "Paste connection", other.uri)
  await page.getByText(de ? "Verbunden" : "Connected", { exact: true }).waitFor({ timeout: 20_000 })
  await page.getByRole("button", { name: de ? "Fertig" : "Done" }).first().click()
  await page.waitForTimeout(1200)
  await page.getByRole("button", { name: de ? /Noch nicht bestätigt/ : /Not confirmed yet/ }).first().click()
  await page.waitForTimeout(600)
  await h.dialog().getByRole("button", { name: de ? "Status prüfen" : "Check Status" }).click()
  await page.waitForTimeout(4000)
  await h.shot("02-checked-other-wallet")
  log(name, "after Status prüfen through the new wallet", await h.journal())
  await h.dialog().getByRole("button", { name: de ? "Zahlung ist durchgegangen" : "The payment went through" }).click()
  await page.waitForTimeout(400)
  await h.shot("03-confirm-by-hand")
  await page.getByRole("alertdialog").getByRole("button", { name: de ? "Vermerken" : "Note It" }).click()
  await page.waitForTimeout(1200)
  await h.shot("04-noted")
  log(name, "noted by hand", await h.journal())
  await page.keyboard.press("Escape")
  // The stake is settled: the result offers no second payment.
  await page.getByRole("navigation").getByRole("button", { name: de ? "Spielen" : "Play" }).filter({ visible: true }).click().catch(() => {})
  await page.reload()
  await page.waitForTimeout(2000)
  await h.shot("05-result")
  log(name, "pay_invoice first", pays(payer), "second", pays(other), "errors", errors, "foreign", context.foreign)
  for (const wallet of [payer, payee, other]) wallet.stop()
  await context.close()
}

// Finding 5: a Lightning address that doesn't answer, while looking it up and while asking it for
// the invoice; both can be cancelled, and nothing is paid.
async function address(browser) {
  const de = true
  const name = "address-de-dark-se"
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const context = await newContext(browser, { size: { width: 320, height: 548 }, scheme: "dark", locale: "de" })
  const page = await context.newPage()
  const h = helpers(page, name, de)
  await h.startGame(500, true)
  context.lnurlHang = "endpoint"
  await page.getByRole("button", { name: "500 sats an Mia zahlen" }).click()
  await h.dialog().getByRole("button", { name: "500 sats an Mia zahlen" }).click()
  await h.paste("Verbindung einfügen", payer.uri)
  await h.dialog().getByText("Empfangsadresse wird gesucht").waitFor({ timeout: 20_000 })
  await h.shot("01-looking-up")
  const started = Date.now()
  await h.dialog().getByText("mia@wallet.test ist gerade nicht erreichbar").waitFor({ timeout: 30_000 })
  log(name, "lookup given up after", Math.round((Date.now() - started) / 1000), "s (lab value)")
  await h.shot("02-unreachable")
  await h.dialog().getByRole("button", { name: "Abbrechen" }).last().click()
  await page.waitForTimeout(800)
  // The address answers now; its invoice doesn't come.
  context.lnurlHang = "invoice"
  await page.getByRole("button", { name: "500 sats an Mia zahlen" }).click()
  await h.dialog().getByRole("button", { name: "500 sats an Mia zahlen" }).click()
  await h.dialog().getByText("über mia@wallet.test").waitFor({ timeout: 20_000 })
  await h.shot("03-review")
  await h.dialog().getByRole("button", { name: "500 sats an Mia zahlen" }).click()
  await h.dialog().getByText("Zahlungscode wird angefragt").waitFor({ timeout: 10_000 })
  await h.shot("04-requesting")
  await h.dialog().getByRole("button", { name: "Abbrechen" }).click()
  await page.waitForTimeout(12_000)
  log(name, "cancelled while requesting: journal", await h.journal(), "pay_invoice", pays(payer), "foreign", context.foreign)
  payer.stop()
  await context.close()
}

// Finding 8: a payment that may be repeated, paid in one window while the other shows its review.
async function tabs(browser) {
  const de = true
  const name = "tabs-de-light"
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const payee = await startFakeWallet({ relay: relay.url })
  const context = await newContext(browser)
  const page = await context.newPage()
  const h = helpers(page, name, de)
  // A wallet first (Zahlungen needs one for "Bezahlen oder empfangen" without a stake).
  await page.goto(BASE)
  await page.waitForTimeout(1200)
  await page.evaluate(() => localStorage.setItem("blueline.wallet-request", JSON.stringify({ id: "cd".repeat(16), at: Date.now() })))
  await page.evaluate((uri) => (location.hash = `#wallet-return=${"cd".repeat(16)}?value=${encodeURIComponent(uri)}`), payer.uri)
  await page.getByRole("button", { name: "Verbinden", exact: true }).click({ timeout: 20_000 })
  await page.getByText("Verbunden", { exact: true }).waitFor({ timeout: 20_000 })
  await h.startGame(null)
  const page2 = await context.newPage()
  await page2.goto(BASE)
  await page2.waitForTimeout(2000)
  const h2 = helpers(page2, `${name}-tab2`, de)
  const toReview = async (p, hp) => {
    await p.getByRole("button", { name: "Bezahlen oder empfangen" }).click()
    await hp.dialog().getByRole("button", { name: "An Mia zahlen" }).click()
    await hp.dialog().getByRole("radio", { name: "100" }).click()
    await hp.dialog().getByRole("button", { name: "Weiter" }).click()
    await hp.paste("Zahlungscode einfügen", await invoiceFrom(payee, 100))
    await hp.dialog().getByRole("button", { name: "100 sats an Mia zahlen" }).waitFor({ timeout: 20_000 })
  }
  await toReview(page2, h2)
  await toReview(page, h)
  await h.dialog().getByRole("button", { name: "100 sats an Mia zahlen" }).click()
  await h.dialog().getByText("sind bei Mia angekommen").waitFor({ timeout: 40_000 })
  await page2.waitForTimeout(1500)
  await h2.shot("01-paid-meanwhile")
  log(name, "tab 2 offers paying again:", await h2.dialog().getByRole("button", { name: "Noch einmal zahlen" }).isVisible(), "pay_invoice", pays(payer))
  for (const wallet of [payer, payee]) wallet.stop()
  await context.close()
}

// Finding 9: a guest who never used payments loads nothing of them on the start page or the
// result; setup loads only the stake row. Each phase lists the scripts it added (gzip bytes) and
// which carry payment code: its texts, the journal, the wallet, the stake row.
const MARKERS = { texts: "Verlierer zahlt", journal: "blueline.payment:", wallet: "pay_invoice", stakeRow: "payments.stake" }
async function guest(browser) {
  const context = await newContext(browser)
  const page = await context.newPage()
  const scripts = []
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return
    const body = await response.text().catch(() => "")
    const found = Object.entries(MARKERS).filter(([, marker]) => body.includes(marker)).map(([what]) => what)
    scripts.push({ file: response.url().split("/").pop(), gzip: gzipSync(body).length, payments: found })
  })
  const phase = (label, from) => log(`guest ${label}:`, scripts.slice(from).map(({ file, gzip, payments }) => `${file} ${gzip}${payments.length ? ` [${payments}]` : ""}`))
  const de = true
  const h = helpers(page, "guest", de)
  await page.goto(BASE)
  await page.waitForTimeout(2000)
  phase("start page", 0)
  const atStart = scripts.length
  await page.getByRole("button", { name: /^X01/ }).click()
  await page.waitForTimeout(1500)
  await page.locator("main input").nth(1).fill("Mia")
  await page.waitForTimeout(1500)
  phase("setup with two players", atStart)
  await page.goto(BASE)
  await page.waitForTimeout(1500)
  const beforeResult = scripts.length
  await h.startGame(null)
  await page.waitForTimeout(2000)
  phase("game and result (setup cached)", beforeResult)
  await h.shot("result-no-stake")
  log("guest sockets", context.sockets, "foreign", context.foreign)
  await context.close()
}

// Finding 6: while a code is shown and the wallet answers slowly (every relay message held back
// 6 s), the screen keeps one connection to it.
async function receive(browser) {
  const de = false
  const name = "receive-en-dark-se"
  const wallet = await startFakeWallet({ relay: relay.url })
  const context = await newContext(browser, { size: { width: 320, height: 548 }, scheme: "dark", locale: "en" })
  const page = await context.newPage()
  const h = helpers(page, name, de)
  await page.goto(BASE)
  await page.waitForTimeout(1200)
  await page.evaluate(() => localStorage.setItem("blueline.wallet-request", JSON.stringify({ id: "ef".repeat(16), at: Date.now() })))
  await page.evaluate((uri) => (location.hash = `#wallet-return=${"ef".repeat(16)}?value=${encodeURIComponent(uri)}`), wallet.uri)
  await page.getByRole("button", { name: "Connect", exact: true }).click({ timeout: 20_000 })
  await page.getByText("Connected", { exact: true }).waitFor({ timeout: 20_000 })
  await h.toPayments()
  await page.getByRole("button", { name: "Receive Money" }).click()
  await h.dialog().getByRole("radio", { name: "1,000" }).click()
  await h.dialog().getByRole("button", { name: "Create Payment Code" }).click()
  await h.dialog().getByText("Waiting for payment").first().waitFor({ timeout: 20_000 })
  const before = context.sockets.length
  context.delay = 6000
  await page.waitForTimeout(26_000)
  await h.shot("01-waiting-slow-wallet")
  log(name, "relay connections opened while waiting 26 s with a slow wallet:", context.sockets.length - before)
  context.delay = 0
  wallet.stop()
  await context.close()
}

const browser = await chromium.launch()
const run = (scenario) => ONLY.length === 0 || ONLY.includes(scenario)
try {
  if (run("rows")) await rows(browser)
  if (run("return")) {
    await walletReturn(browser, { name: "return-de-light-iphone", size: { width: 390, height: 844 }, scheme: "light", locale: "de" })
    await walletReturn(browser, { name: "return-en-dark-se", size: { width: 320, height: 548 }, scheme: "dark", locale: "en" })
  }
  if (run("switch")) {
    await walletSwitch(browser, { name: "switch-de-light-iphone", size: { width: 390, height: 844 }, scheme: "light", locale: "de" })
    await walletSwitch(browser, { name: "switch-en-dark-se", size: { width: 320, height: 548 }, scheme: "dark", locale: "en" })
  }
  if (run("address")) await address(browser)
  if (run("tabs")) await tabs(browser)
  if (run("guest")) await guest(browser)
  if (run("receive")) await receive(browser)
} catch (error) {
  log("FAILED", String(error.stack ?? error))
} finally {
  await browser.close()
  await relay.stop()
  writeFileSync(`${OUT}/report-${ONLY.join("-") || "all"}.txt`, report.join("\n"))
}
