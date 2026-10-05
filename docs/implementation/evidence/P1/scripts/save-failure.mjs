// Run from the repository root against a production build (npm run build && npx next start -p 3201):
//   [OUT=<folder for screenshots>] node docs/implementation/evidence/P1/scripts/save-failure.mjs dark 390x844 de
// BASE overrides the address (default http://localhost:3201).
// Scenario B: the running game can't be written (storage full). The game says so, keeps the
// darts, retries, and confirms once it worked; a reload resumes the latest state.
import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"

const BASE = process.env.BASE ?? "http://localhost:3201"
const OUT = `${process.env.OUT ?? `${os.tmpdir()}/blueline-p1-shots`}/`
fs.mkdirSync(OUT, { recursive: true })
const theme = process.argv[2] ?? "dark"
const [w, h] = (process.argv[3] ?? "390x844").split("x").map(Number)
const lang = process.argv[4] ?? "de"
const tag = `save-${theme}-${w}x${h}-${lang}`
const T =
  lang === "de"
    ? { x01: /^X01/, start: "Spiel starten", retry: "Erneut versuchen", hide: "Hinweis ausblenden", saved: "Dein Spiel ist gespeichert." }
    : { x01: /^X01/, start: "Start game", retry: "Try again", hide: "Hide message", saved: "Your game is saved." }

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 2,
  locale: lang === "de" ? "de-DE" : "en-US",
  colorScheme: theme,
  hasTouch: true,
  isMobile: w < 800 || h < 500,
})
// Writes of the running game throw like a full disk while window.__failSaves is set.
await context.addInitScript(() => {
  const setItem = Storage.prototype.setItem
  Storage.prototype.setItem = function (key, value) {
    if (window.__failSaves && key === "dart-scorer.current-match.v1") throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
    return setItem.call(this, key, value)
  }
})
const page = await context.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
await page.goto(`${BASE}/about`)
await page.evaluate((theme) => {
  localStorage.clear()
  localStorage.setItem("theme", theme)
}, theme)
await page.goto(BASE)
await page.waitForTimeout(600)
await page.getByRole("button", { name: T.x01 }).click()
await page.waitForTimeout(500)
await page.getByRole("button", { name: T.start }).click()
await page.waitForTimeout(800)

// One dart saved normally, then storage fills up.
await page.getByRole("button", { name: "20", exact: true }).click()
await page.waitForTimeout(300)
await page.evaluate(() => (window.__failSaves = true))
await page.getByRole("button", { name: "19", exact: true }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}${tag}-01-failed.png` })
const alert = page.getByRole("alert").filter({ hasText: T.retry })
console.log("alert visible:", await alert.isVisible())

// Darts keep working while it fails.
await page.getByRole("button", { name: "18", exact: true }).click()
await page.waitForTimeout(300)

// Retry while still failing.
await page.getByRole("button", { name: T.retry }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}${tag}-02-still-failing.png` })
// The answer to the failed retry is an alert of its own.
await page.getByRole("alertdialog").getByRole("button", { name: "OK" }).click()
await page.waitForTimeout(400)

// Storage works again: retry, confirmation.
await page.evaluate(() => (window.__failSaves = false))
await page.getByRole("button", { name: T.retry }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}${tag}-03-saved.png` })
console.log("saved toast:", await page.getByText(T.saved).isVisible())
await page.waitForTimeout(3000)
console.log("toast gone after 3 s:", !(await page.getByText(T.saved).isVisible()))

// What is stored now is the latest state: 20, 19, 18.
const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("dart-scorer.current-match.v1")))
console.log("stored darts:", stored.throws.map((t) => t.dart?.segment))

// Dismissing hides it until the next failure after a success.
await page.evaluate(() => (window.__failSaves = true))
await page.getByRole("button", { name: "17", exact: true }).click()
await page.waitForTimeout(400)
await page.getByRole("button", { name: T.hide }).click()
await page.waitForTimeout(400)
console.log("after dismiss, alert visible:", await alert.isVisible().catch(() => false))
await page.screenshot({ path: `${OUT}${tag}-04-dismissed.png` })
await page.evaluate(() => (window.__failSaves = false))
// The next dart saves everything (the whole game is written each time).
await page.getByRole("button", { name: "Double", exact: true }).click()
await page.getByRole("button", { name: "D1", exact: true }).click()
await page.waitForTimeout(400)
await page.reload()
await page.waitForTimeout(1200)
const resumed = JSON.parse(await page.evaluate(() => localStorage.getItem("dart-scorer.current-match.v1")))
console.log("after reload, stored darts:", resumed.throws.map((t) => t.dart && `${t.dart.multiplier}x${t.dart.segment}`))
await page.screenshot({ path: `${OUT}${tag}-05-reloaded.png` })
console.log("page errors:", errors)
await browser.close()
