// Wave 3: a build with areas switched off (lib/shell/features.ts) registers nothing of them and
// the guest app stays as it is. Usage, against a build with only the live area on:
//   NEXT_PUBLIC_BLUELINE_FEATURES=live npm run build && npx next start -p 3340 &
//   node docs/implementation/evidence/P0.02/scripts/features-off.mjs
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3340"
const OUT = process.env.OUT ?? new URL("../screens/", import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "de-DE", hasTouch: true, isMobile: true, serviceWorkers: "block" })
const page = await ctx.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
// A profile key kept on the device from an earlier build: a switch must leave it alone.
await ctx.addInitScript(() => localStorage.setItem("features-off.probe", "kept"))

// Setup without the payments area: no stake row. The game's result without the profile area: no
// offer to keep the results.
await page.goto(BASE)
await page.waitForTimeout(1500)
await page.getByRole("button", { name: /^X01/ }).click()
await page.waitForTimeout(500)
check("setup shows no stake row without payments", (await page.getByRole("button", { name: /^Einsatz/ }).count()) === 0)
const inputs = page.locator("main input")
await inputs.nth(0).fill("Tom")
await inputs.nth(1).fill("Mia")
await page.getByRole("radio", { name: "301" }).click()
await page.getByRole("button", { name: "Spiel starten" }).click()
await page.waitForTimeout(800)
await page.evaluate(() => {
  const key = "dart-scorer.current-match.v1"
  const saved = JSON.parse(localStorage.getItem(key))
  const d = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
  saved.throws = [d(1), d(1), d(1), d(20, 3), d(20, 3), d(20, 3), d(1), d(1), d(1), d(20, 3), d(17, 3), d(5, 2)]
  localStorage.setItem(key, JSON.stringify(saved))
})
await page.reload()
await page.getByText("Mia gewinnt").waitFor({ timeout: 15_000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/features-off-result.jpg`, quality: 80 })
check("the result shows no offer to keep the results without the profile area", (await page.getByText("Deine Ergebnisse mitnehmen").count()) === 0)
// The live area is on and registers a piece that shows nothing here: its wrapper is empty and hidden.
check("the pieces' wrapper takes no room", await page.evaluate(() => {
  const wrapper = document.querySelector('[aria-labelledby="result-title"] .grid.gap-2.empty\\:hidden')
  return wrapper === null || (wrapper.childElementCount === 0 && getComputedStyle(wrapper).display === "none")
}))
await page.getByRole("button", { name: "Fertig" }).first().click()
await page.waitForTimeout(800)

// The Profile tab is the shell's own guest view; "Profil anlegen" leads to the placeholder.
await page.getByRole("navigation").getByRole("button", { name: "Profil" }).filter({ visible: true }).click()
await page.waitForTimeout(800)
check("the Profile tab shows the shell's guest view", await page.getByRole("heading", { name: "Gast" }).isVisible())
check("Profil › Zahlungen is gone without payments", (await page.getByRole("button", { name: /^Zahlungen/ }).count()) === 0)
await page.getByRole("button", { name: "Profil anlegen" }).first().click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/features-off-profile-create.jpg`, quality: 80 })
check("Profil anlegen opens the shell's placeholder", await page.getByText("Dieser Bereich kommt mit einer der nächsten Versionen.").isVisible())

// A link of an area that is off is answered as not yet openable, and the data stays.
await page.goto(`${BASE}/#p=npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq`)
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/features-off-link.jpg`, quality: 80 })
check("a profile link says this version can't open it yet", await page.getByText("Diesen Link kann diese Version noch nicht öffnen.").isVisible())
check("the device's data is untouched", (await page.evaluate(() => localStorage.getItem("features-off.probe"))) === "kept")
check("no page errors", errors.length === 0, errors.join(" | "))

await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`${results.length - failed} of ${results.length} passed`)
process.exit(failed ? 1 : 0)
