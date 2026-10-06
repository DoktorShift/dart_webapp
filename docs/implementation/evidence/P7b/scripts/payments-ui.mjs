// P7b: the payment screens in a real browser against a NIP-47 wallet simulator on a local relay.
// No real wallet, no money, no public relay: the app is built with every relay replaced by the
// local one, the wallet is tests/support/fake-wallet.ts, and the browser may only reach the app
// and 127.0.0.1 (the exchange rate is answered with a fixed value).
//
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:18960 npm run build && npx next start -p 3314 &
//   node docs/implementation/evidence/P7b/scripts/payments-ui.mjs <out dir>
//
// Walks: setup stake → finished game → "500 sats an Mia zahlen" → connect the wallet in the sheet →
// scan Mia's invoice → review → paid; a game without a stake → "Mia gratulieren" through the
// Lightning address in her profile (a local profile event and a simulated address service);
// Zahlungen with rights, balance, limit and history; receiving with a notification; a payment
// whose answer never comes (unknown) and "Status prüfen"; Erweitert; removing the connection.
// Every screenshot gets a layout audit. Reaching Zahlungen from the Profile tab needs the profile
// area to render the "profile.rows" slot list (it does for guests and signed-in profiles).
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { sha256 } from "@noble/hashes/sha2.js"
import { finalizeEvent, generateSecretKey, getPublicKey, Relay } from "nostr-core"
import { encodeInvoice } from "../../../../../tests/support/bolt11.ts"
import { connectWallet } from "../../../../../lib/nostr/wallet.ts"
import { startFakeWallet } from "../../../../../tests/support/fake-wallet.ts"
import { startRelay } from "../../../../../tests/support/nak.ts"

const BASE = process.env.BASE ?? "http://localhost:3314"
const OUT = process.argv[2] ?? "screens"
const RELAY_PORT = 18960
mkdirSync(OUT, { recursive: true })

const relay = await startRelay({ port: RELAY_PORT })
const report = []

// Mia's public profile names a Lightning address; its service (LUD-06/16) is answered below.
const mia = generateSecretKey()
const METADATA = JSON.stringify([["text/plain", "Zahlung an Mia"]])
const nodeKey = randomBytes(32)
const profileRelay = new Relay(relay.url, { reconnect: false })
await profileRelay.connect()
await profileRelay.publish(finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: "Mia", lud16: "mia@wallet.test" }) }, mia))
profileRelay.close()

function lightningAddressService(url) {
  const cors = { "access-control-allow-origin": "*" }
  if (url.pathname === "/.well-known/lnurlp/mia") {
    return { json: { tag: "payRequest", callback: "https://wallet.test/callback", minSendable: 1000, maxSendable: 1_000_000_000, metadata: METADATA }, headers: cors }
  }
  const amountMsat = Number(url.searchParams.get("amount"))
  const pr = encodeInvoice({ amountMsat, timestamp: Math.floor(Date.now() / 1000), expirySeconds: 600, paymentHash: randomBytes(32), descriptionHash: sha256(new TextEncoder().encode(METADATA)), nodeKey })
  return { json: { pr, routes: [] }, headers: cors }
}

// Mia's invoices come from her own (simulated) wallet, as her "Geld empfangen" would show them.
async function invoiceFrom(wallet, sats) {
  const client = await connectWallet(wallet.uri)
  try {
    return (await client.makeInvoice({ amountMsat: sats * 1000, description: "BlueLine Darts", expirySeconds: 600 })).invoice
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
  const describe = (el) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}`
  return {
    pageScroll: document.scrollingElement.scrollWidth > vw + 1,
    offscreen: all.filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 }).map(describe).slice(0, 5),
    ellipsis: all.filter((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1).map(describe),
    small: all
      .filter((el) => el.matches("button, a[href], input, [role=radio], summary") && !el.closest("[data-vaul-drawer] [data-vaul-handle]"))
      .map((el) => (el.matches("[role=switch]") && el.closest("label") ? el.closest("label") : el))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 })
      .map((el) => { const r = el.getBoundingClientRect(); return `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}` }),
  }
}

async function run(name, size, scheme, locale, full) {
  const payer = await startFakeWallet({ relay: relay.url, balanceMsat: 50_000_000, budget: { totalMsat: 100_000_000, usedMsat: 20_000_000 }, notifications: true, lud16: "tom@wallet.test" })
  const payee = await startFakeWallet({ relay: relay.url })
  const browser = await chromium.launch()
  const touch = size.width < 1200
  const context = await browser.newContext({ viewport: size, colorScheme: scheme, locale: locale === "de" ? "de-DE" : "en-US", deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, serviceWorkers: "block" })
  await context.addInitScript((theme) => {
    localStorage.setItem("theme", theme)
    // Headless Chromium answers "denied"; show the scanner as a first visitor sees it.
    navigator.permissions.query = () => Promise.resolve({ state: "prompt" })
  }, scheme)
  const foreign = []
  await context.route(/^https?:\/\//, (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) return route.continue()
    if (url.includes("api.coingecko.com")) return route.fulfill({ json: { bitcoin: { eur: 61_500 } }, headers: { "access-control-allow-origin": "*" } })
    if (url.startsWith("https://wallet.test/")) return route.fulfill(lightningAddressService(new URL(url)))
    foreign.push(url)
    return route.abort()
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  const dialog = () => page.getByRole("dialog")
  const de = locale === "de"
  const shot = async (step) => {
    await page.waitForTimeout(450)
    const file = `${name}-${step}.jpg`
    await page.screenshot({ path: `${OUT}/${file}`, quality: 70 })
    report.push({ shot: file, ...(await page.evaluate(audit)) })
  }

  await page.goto(BASE)
  await page.getByRole("button", { name: /^X01/ }).click()
  await page.waitForTimeout(500)
  const inputs = page.locator("main input")
  await inputs.nth(0).fill("Tom")
  await inputs.nth(1).fill("Mia")
  await page.getByRole("radio", { name: "301" }).click()
  await page.getByRole("button", { name: de ? /Einsatz/ : /Stake/ }).click()
  await page.getByRole("radio", { name: "500" }).click()
  if (full) await shot("01-stake-sheet")
  await dialog().getByRole("button", { name: de ? "Übernehmen" : "Set Stake" }).click()
  await dialog().waitFor({ state: "detached" })
  await page.getByRole("button", { name: de ? /Einsatz/ : /Stake/ }).scrollIntoViewIfNeeded()
  await shot("02-setup-stake-row")
  await page.getByRole("button", { name: de ? "Spiel starten" : "Start Game" }).click()
  await page.waitForTimeout(800)

  // Finish the game: Mia checks out 121 on her second visit.
  await page.evaluate(() => {
    const key = "dart-scorer.current-match.v1"
    const saved = JSON.parse(localStorage.getItem(key))
    const d = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
    saved.throws = [d(1), d(1), d(1), d(20, 3), d(20, 3), d(20, 3), d(1), d(1), d(1), d(20, 3), d(17, 3), d(5, 2)]
    localStorage.setItem(key, JSON.stringify(saved))
  })
  await page.reload()
  await page.waitForTimeout(1500)
  const payRow = page.getByRole("button", { name: de ? "500 sats an Mia zahlen" : "Pay 500 sats to Mia" })
  await payRow.waitFor()
  await shot("03-result-row")

  await payRow.click()
  await shot("04-stake-choice")
  await dialog().getByRole("button", { name: de ? "500 sats an Mia zahlen" : "Pay 500 sats to Mia" }).click()
  if (full) await shot("05-connect-in-sheet")
  await dialog().getByLabel(de ? "Verbindung einfügen" : "Paste connection").fill(payer.uri)
  await dialog().getByLabel(de ? "Verbindung einfügen" : "Paste connection").press("Enter")
  await dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").waitFor({ timeout: 20_000 })
  if (full) await shot("06-scan-invoice")
  const wrong = await invoiceFrom(payee, 400)
  await dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").fill(wrong)
  await dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").press("Enter")
  if (full) await shot("07-wrong-amount")
  await dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").fill(await invoiceFrom(payee, 500))
  await dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").press("Enter")
  const confirm = dialog().getByRole("button", { name: de ? "500 sats an Mia zahlen" : "Pay 500 sats to Mia" })
  await confirm.waitFor()
  await shot("08-review")
  await confirm.click()
  await dialog().getByText(de ? "sind bei Mia angekommen" : "reached Mia").waitFor({ timeout: 40_000 })
  await shot("09-paid")
  await dialog().getByRole("button", { name: de ? "Fertig" : "Done" }).click()
  await page.waitForTimeout(600)
  await shot("10-result-paid")

  if (full) {
    // A second game without a stake; Mia's seat is linked to her profile on this device.
    await page.getByRole("button", { name: de ? "Fertig" : "Done" }).first().click()
    await page.waitForTimeout(800)
    await page.getByRole("button", { name: /^X01/ }).click()
    await page.waitForTimeout(500)
    await page.locator("main input").nth(0).fill("Tom")
    await page.locator("main input").nth(1).fill("Mia")
    await page.getByRole("radio", { name: "301" }).click()
    await page.getByRole("button", { name: de ? "Spiel starten" : "Start Game" }).click()
    await page.waitForTimeout(800)
    await page.evaluate((pubkey) => {
      const key = "dart-scorer.current-match.v1"
      const saved = JSON.parse(localStorage.getItem(key))
      const d = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
      saved.throws = [d(1), d(1), d(1), d(20, 3), d(20, 3), d(20, 3), d(1), d(1), d(1), d(20, 3), d(17, 3), d(5, 2)]
      localStorage.setItem(key, JSON.stringify(saved))
      const miaId = saved.config.players[1].id
      return new Promise((resolve) => {
        const open = indexedDB.open("blueline", 1)
        open.onsuccess = () => {
          const store = open.result.transaction("players", "readwrite").objectStore("players")
          const get = store.get(miaId)
          get.onsuccess = () => store.put({ ...get.result, pubkey }).onsuccess = resolve
        }
      })
    }, getPublicKey(mia))
    await page.reload()
    await page.waitForTimeout(1500)
    await page.getByRole("button", { name: de ? "Bezahlen oder empfangen" : "Pay or Receive" }).click()
    await shot("11-free-choices")
    await dialog().getByRole("button", { name: de ? "Mia gratulieren" : "Congratulate Mia" }).click()
    await dialog().getByRole("radio", { name: "100" }).waitFor({ timeout: 20_000 })
    await shot("12-congratulate")
    await dialog().getByRole("button", { name: de ? "Weiter" : "Next" }).click()
    const send = dialog().getByRole("button", { name: de ? "100 sats an Mia zahlen" : "Pay 100 sats to Mia" })
    await send.waitFor({ timeout: 20_000 })
    await shot("13-congratulate-review")
    await send.click()
    await dialog().getByText(de ? "sind bei Mia angekommen" : "reached Mia").waitFor({ timeout: 40_000 })
    await shot("14-congratulate-paid")
    await dialog().getByRole("button", { name: de ? "Fertig" : "Done" }).click()
    await page.waitForTimeout(500)
    await page.getByRole("button", { name: de ? "Fertig" : "Done" }).first().click()
    await page.waitForTimeout(800)
    await page.getByRole("navigation").getByRole("button", { name: de ? "Profil" : "Profile" }).filter({ visible: true }).click()
    await page.waitForTimeout(800)
    await shot("15-profile-row")
    await page.getByRole("button", { name: de ? /Zahlungen/ : /Payments/ }).click()
    await page.getByText(de ? "Letzte Zahlungen" : "Recent payments").waitFor()
    await page.waitForTimeout(1500)
    await shot("16-payments")

    // Receiving 1.000 sats, paid by someone else: the wallet's notification turns it into "Erhalten".
    await page.getByRole("button", { name: de ? "Geld empfangen" : "Receive Money" }).click()
    await dialog().getByRole("radio", { name: de ? "1.000" : "1,000" }).click()
    await dialog().getByRole("button", { name: de ? "Zahlungscode erstellen" : "Create Payment Code" }).click()
    await dialog().getByText(de ? "Warte auf Zahlung" : "Waiting for payment").waitFor({ timeout: 20_000 })
    await shot("17-receive-waiting")
    const waiting = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("blueline", 1)
          open.onsuccess = () => {
            const req = open.result.transaction("payments").objectStore("payments").getAll()
            req.onsuccess = () => resolve(req.result.find((e) => e.state === "waiting").id)
          }
        }),
    )
    await payer.settle(waiting)
    await dialog().getByText(de ? "sind in deiner Wallet angekommen" : "arrived in your wallet").waitFor({ timeout: 40_000 })
    await shot("18-received")
    await dialog().getByRole("button", { name: de ? "Fertig" : "Done" }).click()

    // A payment whose answer never comes: "noch nicht bestätigt", then cleared up by asking.
    payer.payBehaviour = "silent"
    await page.getByRole("button", { name: de ? "Zahlungscode scannen" : "Scan Payment Code" }).click()
    await dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").fill(await invoiceFrom(payee, 2100))
    await dialog().getByLabel(de ? "Zahlungscode einfügen" : "Paste payment code").press("Enter")
    await dialog().getByRole("button", { name: de ? "2.100 sats zahlen" : "Pay 2,100 sats" }).click()
    await dialog().getByText(de ? "Zahlung noch nicht bestätigt" : "Payment not confirmed yet").waitFor({ timeout: 60_000 })
    await shot("19-unknown")
    await dialog().getByRole("button", { name: de ? "Status prüfen" : "Check Status" }).click()
    await dialog().getByText(de ? "sind angekommen" : "arrived").waitFor({ timeout: 40_000 })
    await shot("20-checked-paid")
    await dialog().getByRole("button", { name: de ? "Fertig" : "Done" }).click()
    await page.waitForTimeout(600)
    await shot("21-payments-history")

    await page.getByRole("button", { name: de ? "Erweitert" : "Advanced" }).click()
    await page.waitForTimeout(600)
    await shot("22-advanced")
    await page.getByRole("button", { name: de ? /Zurück|Zahlungen/ : /Back|Payments/ }).first().click()
    await page.waitForTimeout(600)
    await page.getByRole("button", { name: de ? "Verbindung entfernen" : "Remove Connection" }).click()
    await shot("23-remove-confirm")
    await page.getByRole("alertdialog").getByRole("button", { name: de ? "Entfernen" : "Remove" }).click()
    await page.waitForTimeout(800)
    await shot("24-payments-not-connected")
    await page.getByRole("button", { name: de ? "Wallet verbinden" : "Connect Wallet" }).click()
    await page.waitForTimeout(800)
    await shot("25-connect-screen")
  }

  report.push({ run: name, pays: payer.requests.filter((m) => m === "pay_invoice").length, foreign, errors })
  payer.stop()
  payee.stop()
  await browser.close()
}

try {
  await run("de-light-iphone", { width: 390, height: 844 }, "light", "de", true)
  await run("de-dark-se", { width: 320, height: 548 }, "dark", "de", true)
  await run("de-light-desktop", { width: 1440, height: 900 }, "light", "de", false)
  await run("de-dark-phone-landscape", { width: 844, height: 390 }, "dark", "de", false)
  await run("en-dark-iphone", { width: 390, height: 844 }, "dark", "en", false)
} finally {
  await relay.stop()
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.filter((r) => r.run || r.pageScroll || r.offscreen.length || r.ellipsis.length || r.small.length), null, 2))
