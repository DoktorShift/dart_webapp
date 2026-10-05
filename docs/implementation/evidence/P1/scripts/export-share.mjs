// Run from the repository root against a production build (npm run build && npx next start -p 3301):
//   [OUT=<folder for screenshots>] node docs/implementation/evidence/P1/scripts/export-share.mjs light 320x548 de
// BASE overrides the address (default http://localhost:3301).
// Review round 1, on a touch device (Chromium emulation, not a real iPhone):
// - the share sheet refuses the first share because preparing the file took longer than the tap
//   allows (NotAllowedError): the file is offered again with "Datei teilen", shared in that tap;
// - the import result for files with nothing usable, nothing new, or both.
import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"

const BASE = process.env.BASE ?? "http://localhost:3301"
const OUT = `${process.env.OUT ?? `${os.tmpdir()}/blueline-p1-shots`}/`
fs.mkdirSync(OUT, { recursive: true })
const theme = process.argv[2] ?? "dark"
const [w, h] = (process.argv[3] ?? "390x844").split("x").map(Number)
const lang = process.argv[4] ?? "de"
const tag = `export-${theme}-${w}x${h}-${lang}`
const T =
  lang === "de"
    ? { settings: "Einstellungen", export: "Daten exportieren", share: "Datei teilen", cancel: "Abbrechen" }
    : { settings: "Settings", export: "Export data", share: "Share file", cancel: "Cancel" }

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 2,
  locale: lang === "de" ? "de-DE" : "en-US",
  colorScheme: theme,
  hasTouch: true,
  isMobile: true,
})
// A share sheet that records what it gets; while window.__blockNext is set it refuses once, as
// Safari does when the tap that asked for it is too long ago.
await context.addInitScript(() => {
  window.__shares = []
  navigator.canShare = () => true
  navigator.share = async (data) => {
    const file = data.files[0]
    window.__shares.push({ name: file.name, type: file.type, size: file.size, inTap: navigator.userActivation?.isActive ?? null })
    if (window.__blockNext) {
      window.__blockNext = false
      throw new DOMException("Must be handling a user gesture to perform a share request.", "NotAllowedError")
    }
  }
})
const page = await context.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
const downloads = []
page.on("download", (d) => downloads.push(d.suggestedFilename()))
await page.goto(`${BASE}/about`)
await page.evaluate((theme) => {
  localStorage.clear()
  localStorage.setItem("theme", theme)
}, theme)
await page.goto(BASE)
await page.waitForTimeout(600)
await page.getByRole("button", { name: T.settings, exact: true }).click()
await page.waitForTimeout(800)
console.log("pointer coarse:", await page.evaluate(() => matchMedia("(pointer: coarse)").matches))
const shares = () => page.evaluate(() => window.__shares)
const dialog = page.getByRole("alertdialog")

// 1. Refused once: the file is offered again and shared in the next tap.
await page.evaluate(() => (window.__blockNext = true))
await page.getByRole("button", { name: T.export }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}${tag}-01-ready.png` })
console.log("ready dialog:", await dialog.isVisible(), JSON.stringify(await dialog.innerText().catch(() => "")))
await dialog.getByRole("button", { name: T.share }).click()
await page.waitForTimeout(500)
console.log("after 'share file':", JSON.stringify(await shares()), "dialog open:", await dialog.isVisible())

// 2. Not refused: straight to the share sheet, no extra step.
await page.getByRole("button", { name: T.export }).click()
await page.waitForTimeout(800)
console.log("direct share: calls", (await shares()).length, "dialog open:", await dialog.isVisible())

// 3. Refused, then cancelled: nothing more happens.
await page.evaluate(() => (window.__blockNext = true))
await page.getByRole("button", { name: T.export }).click()
await page.waitForTimeout(800)
await dialog.getByRole("button", { name: T.cancel }).click()
await page.waitForTimeout(500)
console.log("after cancel: calls", (await shares()).length, "dialog open:", await dialog.isVisible(), "downloads", downloads)

// Import results.
const player = { id: `pl_${"a".repeat(32)}`, name: "Anna", createdAt: "2026-10-01T18:00:00.000Z" }
const file = (players, matches = []) => {
  const path = `${OUT}${tag}-import-${Math.random().toString(36).slice(2)}.json`
  fs.writeFileSync(path, JSON.stringify({ format: "blueline-data", version: 1, exportedAt: new Date().toISOString(), matches, players, v1: {}, v1Snapshot: null }))
  return path
}
const importing = async (label, path) => {
  await page.locator('input[type="file"]').setInputFiles(path)
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}${tag}-${label}.png` })
  console.log(`${label}:`, JSON.stringify(await dialog.innerText()))
  await dialog.getByRole("button", { name: "OK" }).click()
  await page.waitForTimeout(400)
}
await importing("02-unreadable", file([{ ...player, name: "x".repeat(5000) }]))
await importing("03-empty", file([]))
await importing("04-added", file([player]))
await importing("05-nothing-new", file([player]))
await importing("06-known-and-unreadable", file([player, { id: "nope", name: "X" }]))

console.log("page errors:", errors)
await browser.close()
