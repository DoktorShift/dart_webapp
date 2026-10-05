// Run from the repository root against a production build (npm run build && npx next start -p 3301):
//   [OUT=<folder for screenshots>] node docs/implementation/evidence/P1/scripts/save-alert-layout.mjs light 320x548 de [x01|cricket]
// BASE overrides the address (default http://localhost:3301).
// Review round 1: the save alert must never cover a key of the score entry. The running game's
// writes fail; for the alert, the answer to a failed retry and the "saved" confirmation, every
// key is checked to be the topmost element at its centre, and the alert's box is printed.
import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"

const BASE = process.env.BASE ?? "http://localhost:3301"
const OUT = `${process.env.OUT ?? `${os.tmpdir()}/blueline-p1-shots`}/`
fs.mkdirSync(OUT, { recursive: true })
const theme = process.argv[2] ?? "dark"
const [w, h] = (process.argv[3] ?? "390x844").split("x").map(Number)
const lang = process.argv[4] ?? "de"
const mode = process.argv[5] ?? "x01"
const tag = `alert-${theme}-${w}x${h}-${lang}-${mode}`
const T =
  lang === "de"
    ? { start: "Spiel starten", retry: "Erneut versuchen", hide: "Hinweis ausblenden", saved: "Dein Spiel ist gespeichert." }
    : { start: "Start game", retry: "Try again", hide: "Hide message", saved: "Your game is saved." }

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
await page.getByRole("button", { name: mode === "x01" ? /^X01/ : /^Cricket/ }).first().click()
await page.waitForTimeout(500)
await page.getByRole("button", { name: T.start }).click()
await page.waitForTimeout(900)

// Every key in the score entry that is covered by something else, and where the alert is.
const check = (label) =>
  page.evaluate((label) => {
    const entry = document.querySelector('[data-area="entry"]')
    const covered = []
    for (const key of entry.querySelectorAll("button")) {
      const r = key.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!key.contains(top)) covered.push(key.getAttribute("aria-label") ?? key.textContent.trim())
    }
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    }
    const alert = document.querySelector('[role="alert"], [role="status"]')
    return {
      label,
      alert: box(alert),
      entry: box(entry),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      ellipsis: [...document.querySelectorAll("*")].some((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth),
      covered,
    }
  }, label)

const pad = ["20", "19", "18", "17"]
await page.getByRole("button", { name: pad[0], exact: true }).first().click()
await page.waitForTimeout(300)
await page.evaluate(() => (window.__failSaves = true))
await page.getByRole("button", { name: pad[1], exact: true }).first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}${tag}-01-failed.png` })
console.log(JSON.stringify(await check("failed")))

// A key next to the alert still takes a dart.
await page.getByRole("button", { name: pad[2], exact: true }).first().click()
await page.waitForTimeout(300)

// Retry while still failing: the answer comes as an alert of its own.
await page.getByRole("button", { name: T.retry }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}${tag}-02-still-failing.png` })
const dialog = page.getByRole("alertdialog")
console.log("still-failing dialog:", await dialog.isVisible(), JSON.stringify(await dialog.innerText().catch(() => "")))
await dialog.getByRole("button", { name: "OK" }).click()
await page.waitForTimeout(500)
console.log(JSON.stringify(await check("after still failing")))

// Storage works again: retry, confirmation.
await page.evaluate(() => (window.__failSaves = false))
await page.getByRole("button", { name: T.retry }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}${tag}-03-saved.png` })
console.log("saved shown:", await page.getByText(T.saved).isVisible(), JSON.stringify(await check("saved")))
await page.waitForTimeout(3000)
console.log("saved gone after 3 s:", !(await page.getByText(T.saved).isVisible()))

// Dismissed: the navigation bar is back in full.
await page.evaluate(() => (window.__failSaves = true))
await page.getByRole("button", { name: pad[3], exact: true }).first().click()
await page.waitForTimeout(500)
await page.getByRole("button", { name: T.hide }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}${tag}-04-dismissed.png` })
console.log("alert after dismiss:", await page.getByRole("alert").filter({ hasText: T.retry }).count())
await page.evaluate(() => (window.__failSaves = false))
const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("dart-scorer.current-match.v1")))
console.log("stored darts:", stored.throws.length)
console.log("page errors:", errors)
await browser.close()
