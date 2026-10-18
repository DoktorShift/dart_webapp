// Run from the repository root against a production build (npm run build && npx next start -p 3201):
//   [OUT=<folder for screenshots>] node docs/implementation/evidence/P1/scripts/tabs.mjs 
// BASE overrides the address (default http://localhost:3201).
// Scenario C: two tabs stay in step (BroadcastChannel), deleting everything in one tab resets
// the other, and a browser without IndexedDB still plays, ranks and says what it can't keep.
import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"

const BASE = process.env.BASE ?? "http://localhost:3201"
const OUT = `${process.env.OUT ?? `${os.tmpdir()}/blueline-p1-shots`}/`
fs.mkdirSync(OUT, { recursive: true })
const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
const nearlyWon = (id, a, b) => ({
  id,
  config: { modeId: "301", modeName: "301", type: "x01", startScore: 301, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: [{ id: "p-a", name: a }, { id: "p-b", name: b }] },
  throws: [dart(20, 3), dart(20, 3), dart(20, 3), dart(20), dart(20), dart(20), dart(20, 3), dart(15, 3)],
  startedAt: "2026-10-04T05:00:00.000Z",
  acknowledgedLegs: 0,
  status: "playing",
})
const finish = async (page) => {
  await page.getByRole("button", { name: "Double", exact: true }).click()
  await page.getByRole("button", { name: "D8", exact: true }).click()
}
const opts = { viewport: { width: 390, height: 844 }, locale: "de-DE", hasTouch: true, isMobile: true }

const browser = await chromium.launch()
{
  const context = await browser.newContext(opts)
  const a = await context.newPage()
  const b = await context.newPage()
  await a.goto(`${BASE}/about`)
  await a.evaluate(() => localStorage.clear())
  // Tab B shows the Rangliste first (empty), then tab A gets the game.
  await b.goto(BASE)
  await b.waitForTimeout(600)
  await b.getByRole("button", { name: "Rangliste", exact: true }).click()
  await a.evaluate((m) => localStorage.setItem("dart-scorer.current-match.v1", JSON.stringify(m)), nearlyWon("tab-game", "Clara", "Dieter"))
  await a.goto(BASE)
  await a.waitForTimeout(800)
  await finish(a)
  await b.waitForTimeout(1200)
  console.log("tab B sees Clara without reload:", await b.getByText("Clara").first().isVisible())
  await b.screenshot({ path: `${OUT}tabs-b-after-a-finished.png` })

  // A tab still running 1.0.0 adds a result: tab B takes it over (storage event).
  await a.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("dart-scorer.matches.v1") ?? "[]")
    list.unshift({ id: "old-tab", finishedAt: new Date().toISOString(), modeId: "cricket", modeName: "Cricket", modeType: "cricket", players: [{ name: "Erika", won: true, darts: 30, points: 0 }, { name: "Clara", won: false, darts: 30, points: 0 }] })
    localStorage.setItem("dart-scorer.matches.v1", JSON.stringify(list))
  })
  await b.waitForTimeout(1200)
  console.log("tab B sees the 1.0.0 result (Erika):", await b.getByText("Erika").first().isVisible())

  // Delete everything in tab B: tab A (on the result screen) starts fresh too.
  await b.getByRole("button", { name: "Einstellungen", exact: true }).click()
  await b.waitForTimeout(500)
  await b.getByRole("button", { name: "Alle Daten auf diesem Gerät löschen" }).click()
  await b.getByRole("button", { name: "Alles löschen" }).click()
  await a.waitForTimeout(2000)
  const aKeys = await a.evaluate(() => Object.keys(localStorage))
  console.log("tab A after wipe in B: keys", aKeys, "result screen gone:", !(await a.getByText("Clara gewinnt").isVisible().catch(() => false)))
  await a.screenshot({ path: `${OUT}tabs-a-after-wipe.png` })
  await context.close()
}
{
  // No IndexedDB at all (blocked storage in some private modes).
  const context = await browser.newContext({ ...opts, colorScheme: "light" })
  await context.addInitScript(() => Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true }))
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.goto(`${BASE}/about`)
  await page.evaluate((m) => {
    localStorage.clear()
    localStorage.setItem("theme", "light")
    localStorage.setItem("dart-scorer.current-match.v1", JSON.stringify(m))
  }, nearlyWon("no-idb", "Fritz", "Gina"))
  await page.goto(BASE)
  await page.waitForTimeout(800)
  await finish(page)
  await page.waitForTimeout(1200)
  console.log("no IndexedDB: alert shown after win:", await page.getByRole("alert").filter({ hasText: "Erneut versuchen" }).isVisible().catch(() => false))
  await page.getByRole("button", { name: "Rangliste", exact: true }).click()
  await page.waitForTimeout(800)
  console.log("no IndexedDB: Rangliste shows Fritz:", await page.getByText("Fritz").first().isVisible())
  await page.reload()
  await page.waitForTimeout(800)
  await page.getByRole("button", { name: "Rangliste", exact: true }).click()
  await page.waitForTimeout(800)
  console.log("no IndexedDB, after reload: Rangliste still shows Fritz (1.0.0 copy):", await page.getByText("Fritz").first().isVisible())
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole("heading", { name: "Daten" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}no-idb-settings.png` })
  console.log("no IndexedDB: page errors", errors)
  await context.close()
}
await browser.close()
