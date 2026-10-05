// Run from the repository root against a production build (npm run build && npx next start -p 3201):
//   [OUT=<folder for screenshots>] node docs/implementation/evidence/P1/scripts/review2.mjs
// BASE overrides the address (default http://localhost:3201).
// Review round 2:
// A: game 1 can't be archived; the rematch is archived fine. The alert stays, one retry writes
//    game 1 whole, and the Rangliste lists every player once (nothing "Importiert").
// B: the alert was hidden for game 1; game 2 failing too shows it again.
// C: deleting everything fails part way: this tab stays and says so, the data is still there,
//    another open tab starts fresh.
import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"

const BASE = process.env.BASE ?? "http://localhost:3201"
const OUT = `${process.env.OUT ?? `${os.tmpdir()}/blueline-p1-shots`}/`
fs.mkdirSync(OUT, { recursive: true })
const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "de-DE", hasTouch: true, isMobile: true }
const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}

// Writes to the "matches" store throw while window.__failMatches is set; clear() throws while
// window.__failClear is set.
const faults = () => {
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (...args) {
    if (window.__failMatches && this.name === "matches") throw new DOMException("simulated", "UnknownError")
    return put.apply(this, args)
  }
  const clear = IDBObjectStore.prototype.clear
  IDBObjectStore.prototype.clear = function () {
    if (window.__failClear) throw new DOMException("simulated", "UnknownError")
    return clear.call(this)
  }
}

const archived = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("blueline")
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(["matches", "kv"])
          const all = tx.objectStore("matches").getAll()
          const kv = tx.objectStore("kv").count()
          tx.oncomplete = () => {
            resolve({ matches: all.result.map((m) => ({ source: m.source, throws: m.throws?.length ?? null })), kv: kv.result })
            db.close()
          }
        }
      }),
  )
const alertShown = (page) => page.getByRole("alert").filter({ hasText: "nicht gespeichert" }).isVisible()

// 501, Anna against Ben: Anna wins with 180, 180, 141 (Ben misses everything).
async function playGame(page, failWinningDart) {
  const entry = page.locator('[data-area="entry"]')
  const key = async (label) => {
    await entry.locator("button").filter({ hasText: new RegExp(`^${label}$`) }).first().click()
    await page.waitForTimeout(120)
  }
  const visit = async (...darts) => {
    for (const [multiplier, n] of darts) {
      await key(multiplier)
      await key(multiplier[0] + n)
    }
  }
  const missRest = async () => {
    await page.waitForTimeout(1300)
    await entry.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
    await page.waitForTimeout(1300)
  }
  await visit(["Triple", 20], ["Triple", 20], ["Triple", 20])
  await missRest()
  await visit(["Triple", 20], ["Triple", 20], ["Triple", 20])
  await missRest()
  await visit(["Triple", 20], ["Triple", 19])
  if (failWinningDart) await page.evaluate(() => (window.__failMatches = true))
  await visit(["Double", 12])
  await page.waitForTimeout(1200)
  await page.evaluate(() => (window.__failMatches = false))
}

async function startGame(page, theme) {
  await page.goto(`${BASE}/about`)
  await page.evaluate((theme) => {
    localStorage.clear()
    localStorage.setItem("theme", theme)
  }, theme)
  await page.goto(BASE)
  await page.waitForTimeout(700)
  await page.getByRole("button", { name: /^X01/ }).first().click()
  await page.waitForTimeout(500)
  await page.locator("input").nth(0).fill("Anna")
  await page.locator("input").nth(1).fill("Ben")
  await page.getByRole("button", { name: "Spiel starten" }).click()
  await page.waitForTimeout(900)
}

const browser = await chromium.launch()

// A
{
  const context = await browser.newContext({ ...opts, colorScheme: "light" })
  await context.addInitScript(faults)
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  await startGame(page, "light")
  await playGame(page, true)
  check("A: game 1 not archived, alert shown", (await alertShown(page)) && (await archived(page)).matches.length === 0)
  await page.getByRole("button", { name: "Revanche" }).click()
  await page.waitForTimeout(1000)
  await playGame(page, false)
  await page.screenshot({ path: `${OUT}review2-a-light-390x844-01-rematch-won.png` })
  const afterRematch = await archived(page)
  check("A: rematch archived, alert still shown for game 1", (await alertShown(page)) && afterRematch.matches.length === 1, JSON.stringify(afterRematch.matches))
  await page.getByRole("button", { name: "Erneut versuchen" }).click()
  await page.waitForTimeout(1200)
  const afterRetry = await archived(page)
  check(
    "A: one retry archives game 1 whole",
    !(await alertShown(page)) && afterRetry.matches.length === 2 && afterRetry.matches.every((m) => m.source === "local" && m.throws > 0),
    JSON.stringify(afterRetry.matches),
  )
  await page.goto(BASE)
  await page.waitForTimeout(800)
  await page.getByRole("button", { name: "Rangliste", exact: true }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}review2-a-light-390x844-02-leaderboard.png` })
  const text = await page.locator("body").innerText()
  check("A: Rangliste lists each player once, nothing imported", !text.includes("Importiert") && (text.match(/2 Spiele/g) ?? []).length === 2)
  check("A: no page errors", errors.length === 0, errors.join(" | "))
  await context.close()
}

// B
{
  const context = await browser.newContext({ ...opts, colorScheme: "dark" })
  await context.addInitScript(faults)
  const page = await context.newPage()
  await startGame(page, "dark")
  await playGame(page, true)
  await page.getByRole("button", { name: "Hinweis ausblenden" }).click()
  await page.waitForTimeout(600)
  check("B: alert hidden for game 1", !(await alertShown(page)))
  await page.getByRole("button", { name: "Revanche" }).click()
  await page.waitForTimeout(1000)
  await playGame(page, true)
  await page.screenshot({ path: `${OUT}review2-b-dark-390x844-01-second-failure.png` })
  check("B: game 2 failing too shows it again", await alertShown(page))
  await page.getByRole("button", { name: "Erneut versuchen" }).click()
  await page.waitForTimeout(1200)
  check("B: one retry archives both games", (await archived(page)).matches.filter((m) => m.source === "local").length === 2)
  await context.close()
}

// C
{
  const context = await browser.newContext({ ...opts, colorScheme: "dark" })
  await context.addInitScript(faults)
  const a = await context.newPage()
  await a.goto(`${BASE}/about`)
  await a.evaluate(() => {
    localStorage.clear()
    const players = [
      { name: "Anna", won: true, darts: 18, points: 501 },
      { name: "Ben", won: false, darts: 18, points: 400 },
    ]
    const record = { id: "mut3p9t1-9znimr", finishedAt: "2026-09-01T20:00:00.000Z", modeId: "501", modeName: "501", modeType: "x01", players }
    localStorage.setItem("dart-scorer.matches.v1", JSON.stringify([record]))
  })
  await a.goto(BASE)
  await a.waitForTimeout(800)
  await a.getByRole("button", { name: "Rangliste", exact: true }).click()
  await a.waitForTimeout(1000)
  const before = await archived(a)
  const b = await context.newPage()
  await b.goto(BASE)
  await b.waitForTimeout(800)
  let navsA = 0
  let navsB = 0
  a.on("framenavigated", (f) => f === a.mainFrame() && navsA++)
  b.on("framenavigated", (f) => f === b.mainFrame() && navsB++)
  await a.getByRole("button", { name: "Einstellungen", exact: true }).click()
  await a.waitForTimeout(800)
  await a.evaluate(() => (window.__failClear = true))
  await a.getByRole("button", { name: "Alle Daten auf diesem Gerät löschen" }).click()
  await a.waitForTimeout(400)
  await a.getByRole("button", { name: "Alles löschen" }).click()
  await a.waitForTimeout(2500)
  await a.screenshot({ path: `${OUT}review2-c-dark-390x844-01-wipe-failed.png` })
  check("C: this tab stays and says not everything was deleted", navsA === 0 && (await a.getByText("Nicht alles gelöscht").isVisible()))
  const after = await archived(a)
  check("C: the archive is still there", after.matches.length === before.matches.length && after.matches.length > 0, JSON.stringify({ before, after }))
  check("C: the other tab started fresh", navsB > 0)
  await context.close()
}

await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(failed ? `${failed} check(s) failed` : "all checks passed")
process.exitCode = failed ? 1 : 0
