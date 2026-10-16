// P7b after review rounds 1 and 2: the fixed findings in a real browser, against NIP-47 wallet
// simulators on a local relay. No real wallet, no money, no public relay: the app is built with
// every relay replaced by the local one, the wallets are tests/support/fake-wallet.ts, Mia's
// Lightning address is answered by the route handler below, and the browser may only reach the
// app and 127.0.0.1. Reaching Zahlungen from the Profile tab needs the "profile.rows" slot list
// in the guest view (the profile track renders it; a scratch build adds it).
//
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20120 npm run build && npx next start -p 3314 &
//   node docs/implementation/evidence/P7b/scripts/payments-review.mjs <out dir> [scenario …]
//
// Scenarios: rows (the result row in every state at 320, 390 and 568 px wide, with a long name),
// return (wallet app answers on the connect screen: unrequested, requested, replayed, replacing),
// returnSheet (the answer to "Wallet-App öffnen" from the stake sheet: same tab, fresh load,
// Profile path, second tab), switch (unknown payment, wallet replaced, settled by hand), address
// (a Lightning address that hangs), tabs (two windows), guest (what a guest loads, and the
// Profile row), receive (a slow wallet: one connection), notes (iPhone SE: the message after a
// failed attempt and the offline note stay in view), landscape (568x320 and 844x390: the sheets
// without scrolling), details (Abbrechen until a code exists, Fertig after; the entry's title;
// NIP-47 on one line). Every screenshot gets a layout audit that also flags clipped text and
// sheet buttons below the fold.
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
const OUT = process.argv[2] ?? "review2"
const ONLY = process.argv.slice(3)
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 20120)
mkdirSync(OUT, { recursive: true })

const relay = await startRelay({ port: RELAY_PORT })
const report = []
const log = (...parts) => {
  const line = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ")
  report.push(line)
  console.log(line)
}
// A check that must hold; the report says which failed.
const expect = (name, ok, detail) => log(ok ? "OK" : "FAIL", name, detail ?? "")

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

// The words the script taps and reads, per language.
const TEXT = {
  de: {
    done: "Fertig", cancel: "Abbrechen", next: "Weiter", start: "Spiel starten", stakeRow: /^Einsatz/, apply: "Übernehmen",
    payStake: "500 sats an Mia zahlen", receiveHere: "Ich bin Mia: hier empfangen", settledHere: "Vor Ort erledigt",
    settledTitle: "Einsatz als vor Ort erledigt vermerken?", noteIt: "Vermerken", settledRow: /Vor Ort erledigt/,
    pasteConn: "Verbindung einfügen", pasteCode: "Zahlungscode einfügen", reachedMia: "sind bei Mia angekommen",
    sending: "Zahlung läuft", unknownRow: /nicht bestätigt/i, waitingRow: /Warte auf Zahlung/, waiting: "Warte auf Zahlung",
    receivedRow: /von Tom erhalten|500 sats von Tom/, paidRow: /an Mia bezahlt|500 sats an Mia$/, arrivedWallet: "sind in deiner Wallet angekommen",
    profile: "Profil", play: "Spielen", payments: /^Zahlungen/, paymentsTitle: "Zahlungen", notConnected: "Keine Wallet verbunden",
    connectWallet: "Wallet verbinden", openApp: "Wallet-App öffnen", confirmWallet: "Diese Wallet verbinden?", connect: "Verbinden", connected: "Verbunden",
    receiveMoney: "Geld empfangen", createCode: "Zahlungscode erstellen", scanCode: "Zahlungscode scannen", thousand: "1.000", pay2100: "2.100 sats zahlen",
    check: "Status prüfen", wentThrough: "Zahlung ist durchgegangen", unknown: "Zahlung noch nicht bestätigt",
    remove: "Verbindung entfernen", removeConfirm: "Entfernen", advanced: "Erweitert", fromWallet: "Aus", stakeText: "Der Verlierer zahlt dem Sieger",
    unrequested: "nicht übernommen",
  },
  en: {
    done: "Done", cancel: "Cancel", next: "Next", start: "Start Game", stakeRow: /^Stake/, apply: "Set Stake",
    payStake: "Pay 500 sats to Mia", receiveHere: "I'm Mia: receive here", settledHere: "Settled in Person",
    settledTitle: "Mark the stake as settled in person?", noteIt: "Note It", settledRow: /Settled in person/i,
    pasteConn: "Paste connection", pasteCode: "Paste payment code", reachedMia: "reached Mia",
    sending: "Payment in progress", unknownRow: /not confirmed/i, waitingRow: /waiting for payment|Awaiting payment/, waiting: "Waiting for payment",
    receivedRow: /received from Tom|500 sats from Tom/, paidRow: /paid to Mia|500 sats to Mia$/, arrivedWallet: "arrived in your wallet",
    profile: "Profile", play: "Play", payments: /^Payments/, paymentsTitle: "Payments", notConnected: "No wallet connected",
    connectWallet: "Connect Wallet", openApp: "Open Wallet App", confirmWallet: "Connect this wallet?", connect: "Connect", connected: "Connected",
    receiveMoney: "Receive Money", createCode: "Create Payment Code", scanCode: "Scan Payment Code", thousand: "1,000", pay2100: "Pay 2,100 sats",
    check: "Check Status", wentThrough: "The payment went through", unknown: "Payment not confirmed yet",
    remove: "Remove Connection", removeConfirm: "Remove", advanced: "Advanced", fromWallet: "From", stakeText: "the loser pays the winner",
    unrequested: "didn't take it",
  },
}

const audit = () => {
  const vw = innerWidth
  const vh = innerHeight
  const shown = (el) => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false
    const s = getComputedStyle(el)
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh
  }
  const all = Array.from(document.querySelectorAll("body *")).filter(shown)
  const describe = (el) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}`
  const hidesOverflow = (el) => ["hidden", "clip"].includes(getComputedStyle(el).overflowX)
  const dialogOpen = !!document.querySelector('[role="dialog"], [role="alertdialog"]')
  return {
    pageScroll: document.scrollingElement.scrollWidth > vw + 1,
    offscreen: all.filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 }).map(describe).slice(0, 5),
    ellipsis: all.filter((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1).map(describe),
    // Text wider than an element that hides what doesn't fit: cut off without an ellipsis.
    // Neither text hidden for VoiceOver only (1 px wide) nor the viewport-wide layers that keep
    // the hidden screens of the navigation stack off to the side count.
    clipped: all
      .filter((el) => hidesOverflow(el) && el.clientWidth > 1 && el.clientWidth < vw - 1 && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim() !== "")
      .map((el) => `${describe(el)} ${el.scrollWidth}>${el.clientWidth}`),
    small: all
      .filter((el) => el.matches("button, a[href], input, [role=radio], summary") && !el.closest("[data-vaul-handle]"))
      .map((el) => (el.matches("[role=switch]") && el.closest("label") ? el.closest("label") : el))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 })
      .map((el) => { const r = el.getBoundingClientRect(); return `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}` }),
    // Buttons of an open sheet or alert that are not fully on screen without scrolling.
    belowFold: dialogOpen
      ? all.filter((el) => el.matches("button") && el.closest('[role="dialog"], [role="alertdialog"]')).filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > vh + 1 || r.top < -1 }).map(describe).slice(0, 6)
      : [],
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
  const L = TEXT[de ? "de" : "en"]
  const dialog = () => page.getByRole("dialog")
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  const shot = async (step) => {
    await page.waitForTimeout(500)
    const file = `${name}-${step}.jpg`
    await page.screenshot({ path: `${OUT}/${file}`, quality: 70 })
    const a = await page.evaluate(audit)
    log(file, a.pageScroll || a.offscreen.length || a.ellipsis.length || a.clipped.length || a.small.length || a.belowFold.length ? a : "layout ok")
  }
  // Whether the first element the locator finds is fully inside the viewport, once it has come
  // to rest (a sheet slides in first).
  const inView = async (locator) => {
    const measure = () => locator.first().evaluate((el) => { const r = el.getBoundingClientRect(); return { at: [r.top, r.bottom, r.left, r.right].map(Math.round).join(), ok: r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1 } })
    let last = await measure()
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(150)
      const next = await measure()
      if (next.at === last.at) return next.ok
      last = next
    }
    return last.ok
  }
  const dismissResult = async () => {
    const done = page.getByRole("button", { name: L.done }).first()
    if (await done.isVisible().catch(() => false)) {
      await done.click()
      await page.waitForTimeout(800)
    }
  }
  const home = async () => {
    await page.goto(BASE)
    await page.waitForTimeout(1200)
    await dismissResult()
  }
  // A finished X01 game, Tom vs `opponent` (Mia): the opponent checks out 121 on the second visit.
  const startGame = async (stake, { opponent = "Mia", linkMia = false } = {}) => {
    await home()
    await page.getByRole("button", { name: /^X01/ }).click()
    await page.waitForTimeout(500)
    const inputs = page.locator("main input")
    await inputs.nth(0).fill("Tom")
    await inputs.nth(1).fill(opponent)
    await page.getByRole("radio", { name: "301" }).click()
    if (stake) {
      await page.getByRole("button", { name: L.stakeRow }).click()
      await page.getByRole("radio", { name: String(stake) }).click()
      await dialog().getByRole("button", { name: L.apply }).click()
      await dialog().waitFor({ state: "detached" })
    }
    await page.getByRole("button", { name: L.start }).click()
    await page.waitForTimeout(800)
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
  const waitingHash = async () => (await read("payments")).find((e) => e.state === "waiting")?.id ?? null
  const paste = async (label, text) => {
    const field = page.getByLabel(label).last()
    await field.fill(text)
    await field.press("Enter")
  }
  // The stake's row on the result, whatever it says (its words are fewer on small phones).
  const stakeRow = () => page.getByRole("button", { name: /500 sats/ }).first()
  const toPayments = async () => {
    await home()
    await page.getByRole("navigation").getByRole("button", { name: L.profile }).filter({ visible: true }).click()
    await page.waitForTimeout(800)
    await page.getByRole("button", { name: L.payments }).click()
    await page.waitForTimeout(1200)
  }
  // Connects a wallet as a wallet app's answer to a request made on the connect screen; confirmed
  // there, then "Fertig".
  const connectQuietly = async (wallet) => {
    await home()
    await page.evaluate(() => localStorage.setItem("blueline.wallet-request", JSON.stringify({ id: "cd".repeat(16), at: Date.now() })))
    await page.evaluate((uri) => (location.hash = `#wallet-return=${"cd".repeat(16)}?value=${encodeURIComponent(uri)}`), wallet.uri)
    await page.getByRole("button", { name: L.connect, exact: true }).click({ timeout: 20_000 })
    await page.getByText(L.connected, { exact: true }).waitFor({ timeout: 20_000 })
    await page.getByRole("button", { name: L.done }).first().click()
    await page.waitForTimeout(600)
  }
  // The result row's text as laid out: it must fit its box in full. Only the result's own buttons
  // count (the game screen with its player panels lies underneath).
  const rowMetrics = async (pattern) => {
    const metrics = await page.evaluate(([source, flags]) => {
      const re = new RegExp(source, flags)
      const result = document.querySelector('[aria-labelledby="result-title"]') ?? document
      const button = [...result.querySelectorAll("button")].find((b) => re.test(b.textContent) && b.querySelector("span.block"))
      if (!button) return null
      const fit = button.querySelector("span.block")
      const range = document.createRange()
      range.selectNodeContents(fit)
      const r = button.getBoundingClientRect()
      return { text: fit.textContent, font: getComputedStyle(fit).fontSize, client: fit.clientWidth, scroll: fit.scrollWidth, lines: range.getClientRects().length, height: Math.round(r.height), fits: fit.scrollWidth <= fit.clientWidth + 1 && r.right <= innerWidth + 1 }
    }, [pattern.source, pattern.flags])
    expect(`${name} row fits`, !!metrics?.fits, metrics)
    return metrics
  }
  return { L, errors, dialog, shot, inView, home, dismissResult, startGame, read, journal, walletAddress, waitingHash, paste, stakeRow, toPayments, connectQuietly, rowMetrics }
}

const pays = (wallet) => wallet.requests.filter((m) => m === "pay_invoice").length
// How many screens with this large title are on screen (hidden ones of the stack sit off to the side).
const screensTitled = (page, title) => page.evaluate((title) => [...document.querySelectorAll("h1")].filter((el) => el.textContent.trim() === title && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth).length, title)
const answerLink = (id, uri) => `#wallet-return=${id}?value=${encodeURIComponent(uri)}`

// Pays the stake through the sheet for the first time: connection and code pasted. Leaves the
// sheet on the outcome.
async function payStakeFirstTime(page, h, payer, payee, { silent = false } = {}) {
  const { L } = h
  await page.getByRole("button", { name: /sats/ }).first().click()
  await h.dialog().getByRole("button", { name: L.payStake }).click()
  await h.paste(L.pasteConn, payer.uri)
  await h.dialog().getByLabel(L.pasteCode).waitFor({ timeout: 20_000 })
  await h.paste(L.pasteCode, await invoiceFrom(payee, 500, silent ? 50 : 600))
  await h.dialog().getByRole("button", { name: L.payStake }).waitFor({ timeout: 20_000 })
  if (silent) payer.payBehaviour = "silent"
  await h.dialog().getByRole("button", { name: L.payStake }).click()
}

// Finding 1 (both reviewers): the result row says how the stake stands in full, in every state,
// at every size: 568x320 DE (brief words), 320x548 EN (received), 390x844 DE with a 20-character
// name (unpaid, then unknown after a reload), 320x548 DE (unknown after a reload, waiting).
async function rows(browser) {
  // 568x320: unpaid, paid and settled in person, each in the landscape words.
  {
    const name = "rows-de-dark-landscape"
    const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
    const payee = await startFakeWallet({ relay: relay.url })
    const context = await newContext(browser, { size: { width: 568, height: 320 }, scheme: "dark", locale: "de" })
    const page = await context.newPage()
    const h = helpers(page, name, true)
    await h.startGame(500)
    await h.shot("01-result-unpaid")
    await h.rowMetrics(/500 sats an Mia/)
    await payStakeFirstTime(page, h, payer, payee)
    await h.dialog().getByText(h.L.reachedMia).waitFor({ timeout: 40_000 })
    await h.dialog().getByRole("button", { name: h.L.done }).click()
    await page.waitForTimeout(800)
    await h.shot("02-result-paid")
    await h.rowMetrics(h.L.paidRow)
    await h.startGame(500)
    await page.getByRole("button", { name: /sats/ }).first().click()
    await h.dialog().getByRole("button", { name: h.L.settledHere }).click()
    const alert = page.getByRole("alertdialog")
    expect(`${name} alert asks`, (await alert.getByRole("heading").textContent()) === h.L.settledTitle, await alert.getByRole("heading").textContent())
    await h.shot("03-settled-alert")
    await alert.getByRole("button", { name: h.L.noteIt }).click()
    await page.waitForTimeout(800)
    await h.shot("04-result-settled")
    await h.rowMetrics(h.L.settledRow)
    log(name, "pay_invoice", pays(payer), "errors", h.errors, "foreign", context.foreign)
    payer.stop()
    payee.stop()
    await context.close()
  }
  // 320x548 EN: Mia's side, waiting then received.
  {
    const name = "rows-en-dark-se"
    const wallet = await startFakeWallet({ relay: relay.url, notifications: true, lud16: "mia@wallet.test" })
    const context = await newContext(browser, { size: { width: 320, height: 548 }, scheme: "dark", locale: "en" })
    const page = await context.newPage()
    const h = helpers(page, name, false)
    await h.connectQuietly(wallet)
    await h.startGame(500)
    await h.stakeRow().click()
    await h.dialog().getByRole("button", { name: h.L.receiveHere }).click()
    await h.dialog().getByText(h.L.waiting).first().waitFor({ timeout: 30_000 })
    await h.dialog().getByRole("button", { name: h.L.done }).click()
    await page.waitForTimeout(800)
    await h.shot("01-result-waiting")
    await h.rowMetrics(h.L.waitingRow)
    // The code is followed only while it is shown: the row opens it again, then the wallet reports.
    await page.getByRole("button", { name: h.L.waitingRow }).first().click()
    await h.dialog().getByText(h.L.waiting).first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(2000)
    await wallet.settle(await h.waitingHash())
    await h.dialog().getByText(h.L.arrivedWallet).waitFor({ timeout: 40_000 })
    await h.dialog().getByRole("button", { name: h.L.done }).click()
    await page.getByRole("button", { name: h.L.receivedRow }).waitFor({ timeout: 10_000 })
    await h.shot("02-result-received")
    await h.rowMetrics(h.L.receivedRow)
    log(name, "errors", h.errors, "foreign", context.foreign)
    wallet.stop()
    await context.close()
  }
  // 390x844 DE with the longest name setup allows (16 characters): unpaid, then unknown after a
  // reload while paying.
  {
    const name = "rows-de-light-iphone-long"
    const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
    const payee = await startFakeWallet({ relay: relay.url })
    const context = await newContext(browser, { size: { width: 390, height: 844 }, scheme: "light", locale: "de" })
    const page = await context.newPage()
    const h = helpers(page, name, true)
    const L = { ...h.L, payStake: "500 sats an Maximilian-Alexa zahlen" }
    await h.startGame(500, { opponent: "Maximilian-Alexa" })
    await h.shot("01-result-unpaid")
    await h.rowMetrics(/Maximilian-Alexa/)
    await payStakeFirstTime(page, { ...h, L }, payer, payee, { silent: true })
    await h.dialog().getByText(L.sending).first().waitFor({ timeout: 20_000 })
    await page.reload()
    await page.waitForTimeout(2000)
    await h.shot("02-result-unknown-after-reload")
    await h.rowMetrics(L.unknownRow)
    // Round 2 (HIG, low): this wallet can report the status, so "Status prüfen" is the one way
    // offered; "In deiner Wallet nachgesehen?" comes only once a check found nothing.
    await page.getByRole("button", { name: L.unknownRow }).first().click()
    await h.dialog().getByRole("button", { name: L.check }).waitFor({ timeout: 10_000 })
    expect(`${name} unknown with lookup: Status prüfen alone, no by-hand rows`, (await h.dialog().getByRole("button", { name: L.wentThrough }).count()) === 0)
    await h.shot("03-unknown-sheet")
    await page.keyboard.press("Escape")
    await page.waitForTimeout(600)
    log(name, "journal", await h.journal(), "pay_invoice", pays(payer), "errors", h.errors)
    payer.stop()
    payee.stop()
    await context.close()
  }
  // 320x548 DE: unknown after a reload, and waiting.
  {
    const name = "rows-de-light-se"
    const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
    const payee = await startFakeWallet({ relay: relay.url })
    const context = await newContext(browser, { size: { width: 320, height: 548 }, scheme: "light", locale: "de" })
    const page = await context.newPage()
    const h = helpers(page, name, true)
    await h.startGame(500)
    await payStakeFirstTime(page, h, payer, payee, { silent: true })
    await h.dialog().getByText(h.L.sending).first().waitFor({ timeout: 20_000 })
    await page.reload()
    await page.waitForTimeout(2000)
    await h.shot("01-result-unknown-after-reload")
    await h.rowMetrics(h.L.unknownRow)
    await h.startGame(500)
    await h.stakeRow().click()
    await h.dialog().getByRole("button", { name: h.L.receiveHere }).click()
    await h.dialog().getByText(h.L.waiting).first().waitFor({ timeout: 30_000 })
    await h.dialog().getByRole("button", { name: h.L.done }).click()
    await page.waitForTimeout(800)
    await h.shot("02-result-waiting")
    await h.rowMetrics(h.L.waitingRow)
    log(name, "journal", await h.journal(), "pay_invoice", pays(payer), "errors", h.errors)
    payer.stop()
    payee.stop()
    await context.close()
  }
}

// Round 1, finding 1: a wallet app's answer counts only for this device's request, once, and only
// after the person confirmed it. The connect screen shows it when nothing else is open.
async function walletReturn(browser, variant) {
  const { name, size, scheme, locale } = variant
  const de = locale === "de"
  const mine = await startFakeWallet({ relay: relay.url, lud16: "me@mine.test" })
  const second = await startFakeWallet({ relay: relay.url, lud16: "second@mine.test" })
  const foreign = await startFakeWallet({ relay: relay.url, lud16: "attacker@evil.test" })
  const context = await newContext(browser, { size, scheme, locale })
  const page = await context.newPage()
  const h = helpers(page, name, de)
  const { L } = h

  await page.goto(BASE)
  await page.waitForTimeout(1500)
  await page.evaluate((hash) => (location.hash = hash), answerLink("", foreign.uri))
  await page.getByText(L.unrequested).waitFor({ timeout: 10_000 })
  await h.shot("01-unrequested")
  log(name, "unrequested link: wallet", await h.walletAddress())

  // "Wallet-App öffnen" notes a request; the wallet app answers it on the same screen.
  await page.getByRole("button", { name: L.openApp }).click().catch(() => {})
  await page.waitForTimeout(500)
  if (!page.url().startsWith(BASE)) await page.goto(BASE)
  const request = await page.evaluate(() => JSON.parse(localStorage.getItem("blueline.wallet-request") ?? "null"))
  await page.evaluate((hash) => (location.hash = hash), answerLink(request.id, mine.uri))
  await page.getByText(L.confirmWallet).waitFor({ timeout: 20_000 })
  expect(`${name} one connect screen`, (await screensTitled(page, L.connectWallet)) === 1)
  await h.shot("02-confirm")
  log(name, "before confirming: wallet", await h.walletAddress())
  await page.getByRole("button", { name: L.connect, exact: true }).click()
  await page.getByText(L.connected, { exact: true }).waitFor({ timeout: 20_000 })
  await h.shot("03-connected")
  log(name, "after confirming: wallet", await h.walletAddress())

  // The same answer again: refused, nothing changes.
  await page.evaluate((hash) => (location.hash = hash), answerLink(request.id, foreign.uri))
  await page.getByText(L.unrequested).waitFor({ timeout: 10_000 })
  await h.shot("04-replayed")
  log(name, "replayed link: wallet", await h.walletAddress())

  // A requested answer while a wallet is connected says it replaces it; cancelled, nothing changes.
  await page.evaluate(() => localStorage.setItem("blueline.wallet-request", JSON.stringify({ id: "ab".repeat(16), at: Date.now() })))
  await page.evaluate((hash) => (location.hash = hash), answerLink("ab".repeat(16), second.uri))
  await page.getByText(L.confirmWallet).waitFor({ timeout: 20_000 })
  await h.shot("05-confirm-replaces")
  await page.getByRole("button", { name: L.cancel }).click()
  await page.waitForTimeout(800)
  await h.shot("06-after-cancel")
  log(name, "replacement cancelled: wallet", await h.walletAddress(), "errors", h.errors, "foreign", context.foreign)
  for (const wallet of [mine, second, foreign]) wallet.stop()
  await context.close()
}

// Round 2 (HIG, high): "Wallet-App öffnen" from the stake sheet never ends the game. The answer
// goes back into the open sheet (same tab), reopens the saved game and its sheet (fresh load),
// shows up on the connect screen itself on the Profile path, and in a second tab.
async function returnSheet(browser) {
  const name = "returnsheet-de-light-iphone"
  const de = true
  const mine = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000, lud16: "me@mine.test" })
  const payee = await startFakeWallet({ relay: relay.url })
  const size = { width: 390, height: 844 }

  // Up to the request from the stake sheet; the wallet app's answer is returned for the test.
  const requestFromSheet = async (page, h) => {
    await h.startGame(500)
    await h.stakeRow().click()
    await h.dialog().getByRole("button", { name: h.L.payStake }).click()
    await h.dialog().getByRole("button", { name: h.L.openApp }).click().catch(() => {})
    await page.waitForTimeout(600)
    if (!page.url().startsWith(BASE)) await page.goto(BASE)
    const request = await page.evaluate(() => JSON.parse(localStorage.getItem("blueline.wallet-request") ?? "null"))
    log(name, "request from the sheet:", request && { from: request.from })
    return request
  }
  const state = (page) => page.evaluate(() => ({ result: !!document.querySelector("#result-title"), dialog: !!document.querySelector("[role=dialog]"), headings: [...document.querySelectorAll("h1, h2, h3")].filter((el) => el.getBoundingClientRect().height > 0).map((el) => el.textContent.trim().slice(0, 32)).slice(0, 5) }))

  // (a) Same tab: the answer arrives as a hash change while the sheet is open.
  {
    const context = await newContext(browser, { size })
    const page = await context.newPage()
    const h = helpers(page, `${name}-same-tab`, de)
    const request = await requestFromSheet(page, h)
    await page.evaluate((hash) => (location.hash = hash), answerLink(request.id, mine.uri))
    await h.dialog().getByText(h.L.confirmWallet).waitFor({ timeout: 20_000 })
    const s = await state(page)
    expect(`${name} same tab: result kept, confirmation in the sheet`, s.result && s.dialog, s)
    await h.shot("01-confirm-in-sheet")
    await h.dialog().getByRole("button", { name: h.L.connect, exact: true }).click()
    await h.dialog().getByLabel(h.L.pasteCode).waitFor({ timeout: 20_000 })
    expect(`${name} same tab: payment goes on`, (await state(page)).result)
    await h.shot("02-scan-after-connect")
    await h.paste(h.L.pasteCode, await invoiceFrom(payee, 500))
    await h.dialog().getByRole("button", { name: h.L.payStake }).click()
    await h.dialog().getByText(h.L.reachedMia).waitFor({ timeout: 40_000 })
    await h.dialog().getByRole("button", { name: h.L.done }).click()
    await page.waitForTimeout(800)
    await h.shot("03-result-paid")
    log(name, "same tab: journal", await h.journal(), "wallet", await h.walletAddress(), "pay_invoice", pays(mine), "errors", h.errors)
    await context.close()
  }
  // (b) A fresh load with the answer (the wallet app opened a new tab, or the page was dropped).
  {
    const context = await newContext(browser, { size })
    const page = await context.newPage()
    const h = helpers(page, `${name}-fresh-load`, de)
    const request = await requestFromSheet(page, h)
    await page.goto(`${BASE}/${answerLink(request.id, mine.uri)}`)
    await h.dialog().getByText(h.L.confirmWallet).waitFor({ timeout: 25_000 })
    const s = await state(page)
    expect(`${name} fresh load: game restored with its sheet`, s.result && s.dialog, s)
    expect(`${name} fresh load: answer left the address`, !page.url().includes("wallet-return"), page.url())
    await h.shot("01-confirm-in-sheet")
    await h.dialog().getByRole("button", { name: h.L.connect, exact: true }).click()
    await h.dialog().getByLabel(h.L.pasteCode).waitFor({ timeout: 20_000 })
    await h.shot("02-scan-after-connect")
    await h.dialog().getByRole("button", { name: h.L.cancel }).last().click()
    await page.waitForTimeout(600)
    expect(`${name} fresh load: result still open after cancel`, (await state(page)).result)
    log(name, "fresh load: wallet", await h.walletAddress(), "errors", h.errors)
    await context.close()
  }
  // (c) The Profile path: the connect screen's own panel shows the answer; Fertig lands on Zahlungen.
  {
    const context = await newContext(browser, { size })
    const page = await context.newPage()
    const h = helpers(page, `${name}-profile`, de)
    await h.toPayments()
    await page.getByRole("button", { name: h.L.connectWallet }).first().click()
    await page.waitForTimeout(800)
    await page.getByRole("button", { name: h.L.openApp }).click().catch(() => {})
    await page.waitForTimeout(600)
    if (!page.url().startsWith(BASE)) await page.goto(BASE)
    const request = await page.evaluate(() => JSON.parse(localStorage.getItem("blueline.wallet-request") ?? "null"))
    await page.evaluate((hash) => (location.hash = hash), answerLink(request.id, mine.uri))
    await page.getByText(h.L.confirmWallet).waitFor({ timeout: 20_000 })
    expect(`${name} profile path: one connect screen`, (await screensTitled(page, h.L.connectWallet)) === 1)
    await h.shot("01-confirm-on-screen")
    await page.getByRole("button", { name: h.L.connect, exact: true }).click()
    await page.getByText(h.L.connected, { exact: true }).waitFor({ timeout: 20_000 })
    await h.shot("02-connected")
    await page.getByRole("button", { name: h.L.done }).first().click()
    await page.waitForTimeout(800)
    const s = await state(page)
    expect(`${name} profile path: Fertig lands on Zahlungen`, s.headings.includes(h.L.paymentsTitle), s)
    await h.shot("03-after-fertig")
    log(name, "profile path: wallet", await h.walletAddress(), "errors", h.errors)
    await context.close()
  }
  // (d) Two tabs: the request on tab 1's connect screen, the answer loads in tab 2; tab 1 follows.
  {
    const context = await newContext(browser, { size })
    const page = await context.newPage()
    const h = helpers(page, `${name}-tab1`, de)
    await h.toPayments()
    await page.getByRole("button", { name: h.L.connectWallet }).first().click()
    await page.waitForTimeout(800)
    await page.getByRole("button", { name: h.L.openApp }).click().catch(() => {})
    await page.waitForTimeout(600)
    if (!page.url().startsWith(BASE)) await page.goto(BASE)
    const request = await page.evaluate(() => JSON.parse(localStorage.getItem("blueline.wallet-request") ?? "null"))
    const page2 = await context.newPage()
    const h2 = helpers(page2, `${name}-tab2`, de)
    await page2.goto(`${BASE}/${answerLink(request.id, mine.uri)}`)
    await page2.getByText(h.L.confirmWallet).waitFor({ timeout: 25_000 })
    await h2.shot("01-confirm")
    await page2.getByRole("button", { name: h.L.connect, exact: true }).click()
    await page2.getByText(h.L.connected, { exact: true }).waitFor({ timeout: 20_000 })
    await page.bringToFront()
    await page.getByText(h.L.connected, { exact: true }).waitFor({ timeout: 20_000 })
    await h.shot("02-tab1-connected")
    log(name, "two tabs: tab 1 shows Verbunden, wallet", await h.walletAddress(), "errors", h.errors, h2.errors)
    await context.close()
  }
  mine.stop()
  payee.stop()
}

// Round 1, findings 2 and 4; round 2: an unknown payment, the wallet replaced, no "Status prüfen"
// through the new one (it could only confirm), and settling it from what the old wallet shows,
// with the by-hand rows in view on the SE.
async function walletSwitch(browser, variant) {
  const { name, size, scheme, locale } = variant
  const de = locale === "de"
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const payee = await startFakeWallet({ relay: relay.url })
  const other = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const context = await newContext(browser, { size, scheme, locale })
  const page = await context.newPage()
  const h = helpers(page, name, de)
  const { L } = h

  await h.startGame(500)
  await payStakeFirstTime(page, h, payer, payee, { silent: true })
  await h.dialog().getByText(L.unknown).waitFor({ timeout: 45_000 })
  await h.shot("01-unknown")
  log(name, "paid by the first wallet", payer.paid.size, await h.journal())
  // Let the code run out, then replace the wallet.
  await page.waitForTimeout(22_000)
  await page.keyboard.press("Escape")
  await h.toPayments()
  await page.getByRole("button", { name: L.remove }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: L.removeConfirm }).click()
  await page.waitForTimeout(800)
  await page.getByRole("button", { name: L.connectWallet }).first().click()
  await page.waitForTimeout(800)
  await h.paste(L.pasteConn, other.uri)
  await page.getByText(L.connected, { exact: true }).waitFor({ timeout: 20_000 })
  await page.getByRole("button", { name: L.done }).first().click()
  await page.waitForTimeout(1200)
  await page.getByRole("button", { name: L.unknownRow }).first().click()
  await page.waitForTimeout(800)
  expect(`${name} no Status prüfen through another wallet`, (await h.dialog().getByRole("button", { name: L.check }).count()) === 0)
  expect(`${name} by-hand row in view`, await h.inView(h.dialog().getByRole("button", { name: L.wentThrough })))
  await h.shot("02-by-hand-other-wallet")
  await h.dialog().getByRole("button", { name: L.wentThrough }).click()
  await page.waitForTimeout(400)
  await h.shot("03-confirm-by-hand")
  await page.getByRole("alertdialog").getByRole("button", { name: L.noteIt }).click()
  await page.waitForTimeout(1200)
  await h.shot("04-noted")
  log(name, "noted by hand", await h.journal())
  await page.keyboard.press("Escape")
  // The stake is settled: the result offers no second payment.
  await page.getByRole("navigation").getByRole("button", { name: L.play }).filter({ visible: true }).click().catch(() => {})
  await page.reload()
  await page.waitForTimeout(2000)
  await h.shot("05-result")
  log(name, "pay_invoice first", pays(payer), "second", pays(other), "errors", h.errors, "foreign", context.foreign)
  for (const wallet of [payer, payee, other]) wallet.stop()
  await context.close()
}

// Round 1, finding 5: a Lightning address that doesn't answer, while looking it up and while
// asking it for the invoice; both can be cancelled, and nothing is paid.
async function address(browser) {
  const de = true
  const name = "address-de-dark-se"
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const context = await newContext(browser, { size: { width: 320, height: 548 }, scheme: "dark", locale: "de" })
  const page = await context.newPage()
  const h = helpers(page, name, de)
  await h.startGame(500, { linkMia: true })
  context.lnurlHang = "endpoint"
  await h.stakeRow().click()
  // The address is looked up from the moment the payment opens, while the wallet is connected.
  const started = Date.now()
  await h.dialog().getByRole("button", { name: "500 sats an Mia zahlen" }).click()
  await h.paste("Verbindung einfügen", payer.uri)
  await h.dialog().getByText("Empfangsadresse wird gesucht").waitFor({ timeout: 20_000 })
  await h.shot("01-looking-up")
  await h.dialog().getByText("mia@wallet.test ist gerade nicht erreichbar").waitFor({ timeout: 30_000 })
  log(name, "lookup given up after", Math.round((Date.now() - started) / 1000), "s from opening the payment (lab value)")
  await h.shot("02-unreachable")
  await h.dialog().getByRole("button", { name: "Abbrechen" }).last().click()
  await page.waitForTimeout(800)
  // The address answers now; its invoice doesn't come.
  context.lnurlHang = "invoice"
  await h.stakeRow().click()
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

// Round 1, finding 8: a payment that may be repeated, paid in one window while the other shows
// its review.
async function tabs(browser) {
  const de = true
  const name = "tabs-de-light"
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const payee = await startFakeWallet({ relay: relay.url })
  const context = await newContext(browser)
  const page = await context.newPage()
  const h = helpers(page, name, de)
  // A wallet first (Zahlungen needs one for "Bezahlen oder empfangen" without a stake).
  await h.connectQuietly(payer)
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

// Round 1, finding 9; round 2: a guest who never used payments loads nothing of them on the start
// page or the result; setup loads only the stake row. The Profile tab shows the Zahlungen row,
// which leads to "Wallet verbinden". Each phase lists the scripts it added (gzip bytes) and
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
  // Each phase lists only scripts no earlier phase loaded (a reload fetches the same files again).
  const seen = new Set()
  const phase = (label, from) => {
    const added = scripts.slice(from).filter(({ file }) => !seen.has(file) && seen.add(file))
    log(`guest ${label}:`, added.map(({ file, gzip, payments }) => `${file} ${gzip}${payments.length ? ` [${payments}]` : ""}`))
  }
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
  phase("game and result", beforeResult)
  await h.shot("result-no-stake")
  log("guest sockets", context.sockets, "foreign", context.foreign)
  // Profil › Zahlungen › Wallet verbinden for a fresh guest.
  const beforeProfile = scripts.length
  await h.dismissResult()
  await page.getByRole("navigation").getByRole("button", { name: h.L.profile }).filter({ visible: true }).click()
  await page.getByRole("button", { name: h.L.payments }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(800)
  phase("profile tab", beforeProfile)
  expect("guest Zahlungen row says no wallet", await page.getByText(h.L.notConnected).isVisible())
  await h.shot("profile-row")
  await page.getByRole("button", { name: h.L.payments }).click()
  await page.waitForTimeout(1000)
  await h.shot("payments-no-wallet")
  await page.getByRole("button", { name: h.L.connectWallet }).first().click()
  await page.waitForTimeout(800)
  expect("guest reaches Wallet verbinden", await page.getByLabel(h.L.pasteConn).isVisible())
  await h.shot("connect-screen")
  await context.close()
}

// Round 1, finding 6: while a code is shown and the wallet answers slowly (every relay message
// held back 6 s), the screen keeps one connection to it.
async function receive(browser) {
  const de = false
  const name = "receive-en-dark-se"
  const wallet = await startFakeWallet({ relay: relay.url })
  const context = await newContext(browser, { size: { width: 320, height: 548 }, scheme: "dark", locale: "en" })
  const page = await context.newPage()
  const h = helpers(page, name, de)
  await h.connectQuietly(wallet)
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

// Round 2 (medium): on the iPhone SE the message that explains what happened is in view: after a
// failed attempt (the browser offline, so the wallet can't be reached) above the pay button, and
// the offline note while a code is shown; back online the payment goes through once.
async function notes(browser) {
  const name = "notes-de-dark-se"
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const payee = await startFakeWallet({ relay: relay.url })
  const context = await newContext(browser, { size: { width: 320, height: 548 }, scheme: "dark", locale: "de" })
  const page = await context.newPage()
  const h = helpers(page, name, true)
  const { L } = h
  await h.connectQuietly(payer)
  await h.startGame(500)
  await h.stakeRow().click()
  await h.dialog().getByRole("button", { name: L.payStake }).click()
  await h.paste(L.pasteCode, await invoiceFrom(payee, 500))
  await h.dialog().getByRole("button", { name: L.payStake }).waitFor({ timeout: 20_000 })
  await context.setOffline(true)
  await h.dialog().getByRole("button", { name: L.payStake }).click()
  const problem = h.dialog().getByRole("alert")
  await problem.waitFor({ timeout: 40_000 })
  const payButton = h.dialog().getByRole("button", { name: L.payStake })
  expect(`${name} failed attempt: message in view`, await h.inView(problem), await problem.textContent())
  expect(`${name} failed attempt: message above the button`, (await problem.boundingBox()).y < (await payButton.boundingBox()).y)
  await h.shot("01-failed-attempt")
  log(name, "after the failed attempt: journal", await h.journal(), "pay_invoice", pays(payer))
  await context.setOffline(false)
  await payButton.click()
  await h.dialog().getByText(L.reachedMia).waitFor({ timeout: 40_000 })
  await h.shot("02-paid-after-reconnect")
  await h.dialog().getByRole("button", { name: L.done }).click()
  // A code shown from Zahlungen while the connection goes away.
  await h.toPayments()
  await page.getByRole("button", { name: L.receiveMoney }).click()
  await h.dialog().getByRole("radio", { name: L.thousand }).click()
  await h.dialog().getByRole("button", { name: L.createCode }).click()
  await h.dialog().getByText(L.waiting).first().waitFor({ timeout: 20_000 })
  await context.setOffline(true)
  const offline = h.dialog().getByRole("alert")
  await offline.waitFor({ timeout: 45_000 })
  expect(`${name} offline: note in view`, await h.inView(offline), await offline.textContent())
  await h.shot("03-receive-offline")
  await context.setOffline(false)
  log(name, "journal", await h.journal(), "pay_invoice", pays(payer), "errors", h.errors, "foreign", context.foreign)
  payer.stop()
  payee.stop()
  await context.close()
}

// Round 2 (medium): phones in landscape. The stake sheet in setup, the choice, connecting in the
// sheet, the review and the code are usable without scrolling: no description, buttons side by
// side, amount with wallet and fees in view, the code at least 160 px with its status.
async function landscape(browser, variant) {
  const { name, size, scheme, locale } = variant
  const de = locale === "de"
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000 })
  const payee = await startFakeWallet({ relay: relay.url })
  const context = await newContext(browser, { size, scheme, locale })
  const page = await context.newPage()
  const h = helpers(page, name, de)
  const { L } = h
  await h.home()
  await page.getByRole("button", { name: /^X01/ }).click()
  await page.waitForTimeout(500)
  await page.locator("main input").nth(0).fill("Tom")
  await page.locator("main input").nth(1).fill("Mia")
  await page.getByRole("button", { name: L.stakeRow }).click()
  await h.dialog().getByRole("radio", { name: "500" }).waitFor()
  expect(`${name} stake sheet: no description`, (await h.dialog().getByText(L.stakeText).count()) === 0)
  expect(`${name} stake sheet: amounts and Übernehmen in view`, (await h.inView(h.dialog().getByRole("radio", { name: "500" }))) && (await h.inView(h.dialog().getByRole("button", { name: L.apply }))))
  await h.shot("01-stake-sheet")
  await h.dialog().getByRole("radio", { name: "500" }).click()
  await h.dialog().getByRole("button", { name: L.apply }).click()
  await h.dialog().waitFor({ state: "detached" })
  await h.startGame(500)
  await h.rowMetrics(/500 sats/)
  await page.getByRole("button", { name: /500 sats/ }).first().click()
  expect(`${name} choice: Vor Ort erledigt in view`, await h.inView(h.dialog().getByRole("button", { name: L.settledHere })))
  await h.shot("02-choice")
  await h.dialog().getByRole("button", { name: L.payStake }).click()
  await h.shot("03-connect-in-sheet")
  await h.paste(L.pasteConn, payer.uri)
  await h.dialog().getByLabel(L.pasteCode).waitFor({ timeout: 20_000 })
  await h.shot("04-scan")
  await h.paste(L.pasteCode, await invoiceFrom(payee, 500))
  const pay = h.dialog().getByRole("button", { name: L.payStake })
  await pay.waitFor({ timeout: 20_000 })
  await page.waitForTimeout(400)
  expect(`${name} review: amount, wallet row and pay button in view`, (await h.inView(h.dialog().getByText("500 sats", { exact: true }))) && (await h.inView(h.dialog().getByText(L.fromWallet, { exact: true }))) && (await h.inView(pay)))
  await h.shot("05-review")
  await pay.click()
  await h.dialog().getByText(L.reachedMia).waitFor({ timeout: 40_000 })
  await h.shot("06-paid")
  await h.dialog().getByRole("button", { name: L.done }).click()
  await page.waitForTimeout(800)
  await h.rowMetrics(L.paidRow)
  await h.shot("07-result-paid")
  // Mia's side: the code with its status.
  await h.startGame(500)
  await page.getByRole("button", { name: /500 sats/ }).first().click()
  await h.dialog().getByRole("button", { name: L.receiveHere }).click()
  await h.dialog().getByText(L.waiting).first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(800)
  const qr = await h.dialog().getByRole("img").first().boundingBox()
  expect(`${name} code at least 160 px with its status in view`, qr.height >= 159 && qr.y >= 0 && qr.y + qr.height <= size.height + 1 && (await h.inView(h.dialog().getByText(L.waiting).first())), qr)
  await h.shot("08-receive-waiting")
  log(name, "pay_invoice", pays(payer), "errors", h.errors, "foreign", context.foreign)
  payer.stop()
  payee.stop()
  await context.close()
}

// Round 2 (low): "Abbrechen" until a code exists and "Fertig" after it, a filled "Fertig" once it
// arrived; a payment's sheet titled by the payment; "NIP-47" on one line at 320 px.
async function details(browser) {
  {
    const name = "details-de-light-iphone"
    const wallet = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000, notifications: true })
    const payee = await startFakeWallet({ relay: relay.url })
    const context = await newContext(browser)
    const page = await context.newPage()
    const h = helpers(page, name, true)
    const { L } = h
    await h.connectQuietly(wallet)
    await h.toPayments()
    await page.getByRole("button", { name: L.receiveMoney }).click()
    await h.dialog().getByRole("radio", { name: L.thousand }).waitFor()
    expect(`${name} before a code: Abbrechen, no Fertig`, (await h.dialog().getByRole("button", { name: L.cancel }).count()) === 1 && (await h.dialog().getByRole("button", { name: L.done }).count()) === 0)
    await h.shot("01-receive-amount")
    await h.dialog().getByRole("radio", { name: L.thousand }).click()
    await h.dialog().getByRole("button", { name: L.createCode }).click()
    await h.dialog().getByText(L.waiting).first().waitFor({ timeout: 20_000 })
    const filled = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)")
    expect(`${name} with a code: plain Fertig`, (await h.dialog().getByRole("button", { name: L.done }).count()) === 1 && !(await filled(h.dialog().getByRole("button", { name: L.done }))))
    await h.shot("02-receive-waiting")
    await wallet.settle(await h.waitingHash())
    await h.dialog().getByText(L.arrivedWallet).waitFor({ timeout: 40_000 })
    expect(`${name} received: filled Fertig`, await filled(h.dialog().getByRole("button", { name: L.done })))
    await h.shot("03-received")
    await h.dialog().getByRole("button", { name: L.done }).click()
    // A scanned code paid from Zahlungen: its review names nobody, so it starts with the amount,
    // and Enter in the paste field leaves no focus ring around the sheet (Tailwind's outline-none
    // is a transparent outline). Then its entry in "Letzte Zahlungen".
    await page.getByRole("button", { name: L.scanCode }).click()
    await h.paste(L.pasteCode, await invoiceFrom(payee, 2100))
    await h.dialog().getByRole("button", { name: L.pay2100 }).waitFor({ timeout: 20_000 })
    const focus = await h.dialog().evaluate((el) => { const s = getComputedStyle(el); return { active: document.activeElement === el, outline: s.outlineStyle, color: s.outlineColor } })
    expect(`${name} no focus ring around the sheet after Enter`, focus.outline === "none" || focus.color === "rgba(0, 0, 0, 0)", focus)
    expect(`${name} review from Zahlungen starts with the amount`, await h.dialog().locator("p.font-display").first().evaluate((el) => el.parentElement?.firstElementChild === el))
    await h.shot("04-review-from-payments")
    await h.dialog().getByRole("button", { name: L.pay2100 }).click()
    await h.dialog().getByText("sind angekommen").waitFor({ timeout: 40_000 })
    await h.dialog().getByRole("button", { name: L.done }).click()
    await page.waitForTimeout(800)
    const row = page.getByRole("button", { name: /2\.100 sats/ }).first()
    const rowTitle = (await row.locator("span.block").first().textContent()).trim()
    await row.click()
    await page.waitForTimeout(600)
    const sheetTitle = (await h.dialog().getByRole("heading").first().textContent()).trim()
    expect(`${name} entry sheet titled by the payment`, sheetTitle === rowTitle && sheetTitle !== L.paymentsTitle, { rowTitle, sheetTitle })
    await h.shot("05-history-entry")
    log(name, "errors", h.errors, "foreign", context.foreign)
    wallet.stop()
    payee.stop()
    await context.close()
  }
  {
    const name = "details-en-dark-se"
    const wallet = await startFakeWallet({ relay: relay.url })
    const context = await newContext(browser, { size: { width: 320, height: 548 }, scheme: "dark", locale: "en" })
    const page = await context.newPage()
    const h = helpers(page, name, false)
    await h.connectQuietly(wallet)
    await h.toPayments()
    await page.getByRole("button", { name: h.L.advanced }).click()
    await page.waitForTimeout(800)
    // The line may wrap before it, but never inside "NIP‑47".
    const value = page.getByText("Nostr Wallet Connect (NIP‑47)")
    expect(`${name} NIP‑47 on one line`, (await value.evaluate((el) => { const node = el.firstChild; const range = document.createRange(); range.setStart(node, node.textContent.indexOf("NIP")); range.setEnd(node, node.textContent.length); return range.getClientRects().length })) === 1)
    await h.shot("01-advanced")
    wallet.stop()
    await context.close()
  }
}

const browser = await chromium.launch()
// A rejection nobody awaited ends up in the report instead of ending the run.
process.on("unhandledRejection", (error) => log("FAILED unhandled", String(error?.stack ?? error)))
const SCENARIOS = {
  rows: () => rows(browser),
  return: async () => {
    await walletReturn(browser, { name: "return-de-light-iphone", size: { width: 390, height: 844 }, scheme: "light", locale: "de" })
    await walletReturn(browser, { name: "return-en-dark-se", size: { width: 320, height: 548 }, scheme: "dark", locale: "en" })
  },
  returnSheet: () => returnSheet(browser),
  switch: async () => {
    await walletSwitch(browser, { name: "switch-de-light-iphone", size: { width: 390, height: 844 }, scheme: "light", locale: "de" })
    await walletSwitch(browser, { name: "switch-en-dark-se", size: { width: 320, height: 548 }, scheme: "dark", locale: "en" })
  },
  address: () => address(browser),
  tabs: () => tabs(browser),
  guest: () => guest(browser),
  receive: () => receive(browser),
  notes: () => notes(browser),
  landscape: async () => {
    await landscape(browser, { name: "landscape-de-dark-568", size: { width: 568, height: 320 }, scheme: "dark", locale: "de" })
    await landscape(browser, { name: "landscape-en-light-844", size: { width: 844, height: 390 }, scheme: "light", locale: "en" })
  },
  details: () => details(browser),
}
// Each scenario runs on its own: one that fails is reported, and the others still run.
for (const [id, scenario] of Object.entries(SCENARIOS)) {
  if (ONLY.length > 0 && !ONLY.includes(id)) continue
  try {
    await scenario()
  } catch (error) {
    log("FAILED", id, String(error.stack ?? error))
  }
}
await browser.close()
await relay.stop()
writeFileSync(`${OUT}/report-${ONLY.join("-") || "all"}.txt`, report.join("\n"))
