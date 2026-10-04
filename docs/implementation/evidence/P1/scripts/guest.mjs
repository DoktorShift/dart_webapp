// Run from the repository root against a production build (npm run build && npx next start -p 3201):
//   [OUT=<folder for screenshots>] node docs/implementation/evidence/P1/scripts/guest.mjs 
// BASE overrides the address (default http://localhost:3201).
// Scenario D: a guest on a fresh device. Setup gives known names their stable id again, the
// app never talks to anything but its own origin, and nothing asks to sign in.
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3201"
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "de-DE", hasTouch: true, isMobile: true })
const page = await context.newPage()
const foreign = []
page.on("request", (r) => !r.url().startsWith(BASE) && !r.url().startsWith("data:") && !r.url().startsWith("blob:") && foreign.push(r.url()))
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))

const t0 = Date.now()
await page.goto(BASE)
await page.getByRole("button", { name: /^X01/ }).waitFor()
console.log("Play tab interactive after", Date.now() - t0, "ms (local production server)")

async function startWith(names) {
  await page.getByRole("button", { name: /^X01/ }).click()
  await page.waitForTimeout(400)
  const inputs = page.locator("main input")
  for (let i = 0; i < names.length; i++) await inputs.nth(i).fill(names[i])
  await page.getByRole("button", { name: "Spiel starten" }).click()
  await page.waitForTimeout(700)
  return JSON.parse(await page.evaluate(() => localStorage.getItem("dart-scorer.current-match.v1"))).config.players
}
const listDirectory = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("blueline", 1)
        open.onsuccess = () => {
          const req = open.result.transaction("players").objectStore("players").getAll()
          req.onsuccess = () => {
            open.result.close()
            resolve(req.result.map((p) => [p.name, p.id]))
          }
        }
      }),
  )

const first = await startWith(["Anna", ""])
console.log("first game seats:", first)
await page.waitForTimeout(500)
console.log("directory:", await listDirectory())
// Leave the game (it stays as "paused") and start a new one with the same names, other order.
await page.getByRole("button", { name: "Spiel verlassen" }).click()
await page.waitForTimeout(500)
const leave = page.getByRole("button", { name: /Speichern|Pausieren|Später weiterspielen/ })
if (await leave.count()) await leave.first().click()
else await page.keyboard.press("Escape")
await page.waitForTimeout(600)
const second = await startWith(["", "anna "])
console.log("second game seats:", second)
console.log("Anna keeps her id:", first[0].id === second[1].id, "| empty seats differ:", first[1].id !== second[0].id)
console.log("requests to other origins:", foreign)
console.log("page errors:", errors)
await browser.close()
