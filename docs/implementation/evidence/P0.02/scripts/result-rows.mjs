// Wave 3: the result's pieces as one shared row (components/shell/result-row.tsx) at the three
// heights the contract names: a tall phone (a row each), a short phone in portrait (one row and a
// count) and a phone in landscape (the top bar). As a guest with one piece (the profile's offer)
// and with two (the offer and a stake's row). Usage, against a production build:
//   npm run build && npx next start -p 3340 &
//   node docs/implementation/evidence/P0.02/scripts/result-rows.mjs
// Pictures go to ../screens/result-row-*.jpg; BASE and OUT override the address and the folder.
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

const SIZES = { se: { width: 320, height: 548 }, iphone: { width: 390, height: 844 }, landscape: { width: 568, height: 320 } }

const browser = await chromium.launch()

async function open(viewport) {
  const ctx = await browser.newContext({ viewport, locale: "de-DE", hasTouch: true, isMobile: true, serviceWorkers: "block" })
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text())
  })
  return { ctx, page, errors }
}

// A finished X01 game, Tom vs Mia, 301, with or without a 500 sats stake: Mia checks out 121 on
// her second visit, so the result is on screen after the reload.
async function finishedGame(page, { stake }) {
  await page.goto(BASE)
  await page.waitForTimeout(1500)
  await page.getByRole("button", { name: /^X01/ }).click()
  await page.waitForTimeout(500)
  const inputs = page.locator("main input")
  await inputs.nth(0).fill("Tom")
  await inputs.nth(1).fill("Mia")
  await page.getByRole("radio", { name: "301" }).click()
  if (stake) {
    await page.getByRole("button", { name: /^Einsatz/ }).click()
    await page.getByRole("radio", { name: "500" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Übernehmen" }).click()
    await page.getByRole("dialog").waitFor({ state: "detached" })
  }
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
}

const shot = async (page, name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/result-row-${name}.jpg`, quality: 80 })
}
const box = (locator) => locator.first().evaluate((el) => {
  const r = el.getBoundingClientRect()
  return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width), bottom: Math.round(r.bottom) }
})
const visibleCount = (page, text) => page.getByText(text, { exact: true }).locator("visible=true").count()
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
const tableHeight = (page) => page.locator('[aria-labelledby="result-title"] table').first().evaluate((el) => Math.round(el.closest("div").getBoundingClientRect().height))

const offer = "Deine Ergebnisse mitnehmen"
const stakeRow = (page) => page.getByRole("button", { name: /500 sats/ }).first()

for (const [name, viewport] of Object.entries(SIZES)) {
  const landscape = viewport.height <= 500
  const short = viewport.height <= 740 && !landscape

  // One piece: a guest's offer to keep the results.
  {
    const { ctx, page, errors } = await open(viewport)
    await finishedGame(page, { stake: false })
    const row = page.getByRole("button", { name: offer })
    const r = await box(row)
    await shot(page, `one-${name}`)
    const inView = r.top >= 0 && r.bottom <= viewport.height
    if (landscape) check(`${name}: one piece is a bar button of 44 pt`, r.height === 44 && inView && (await noHorizontalScroll(page)), JSON.stringify(r))
    else check(`${name}: one piece is one row of ${short ? 44 : 48} pt`, r.height === (short ? 44 : 48) && inView && (await noHorizontalScroll(page)), JSON.stringify(r))
    check(`${name}: one piece shows no count`, (await page.getByRole("button", { name: /Mehr zum Ergebnis/ }).count()) === 0)
    const later = page.getByRole("button", { name: "Später, nicht für dieses Spiel" })
    if (landscape) check(`${name}: the bar button has no trailing part`, (await later.count()) === 0)
    else {
      await later.click()
      await page.waitForTimeout(500)
      check(`${name}: Später puts the offer away`, (await visibleCount(page, offer)) === 0)
    }
    check(`${name}: no page errors with one piece`, errors.length === 0, errors.join(" | "))
    await ctx.close()
  }

  // Two pieces: the offer and the stake's row.
  {
    const { ctx, page, errors } = await open(viewport)
    await finishedGame(page, { stake: true })
    const table = await tableHeight(page)
    await shot(page, `two-${name}`)
    const more = page.getByRole("button", { name: "Mehr zum Ergebnis, 2 Einträge" })
    if (landscape) {
      check(`${name}: two pieces become one bar button with the count 2, neither inline`, (await more.count()) === 1 && (await visibleCount(page, offer)) === 0 && (await stakeRow(page).isVisible().catch(() => false)) === false)
    } else if (short) {
      const r = await box(page.getByRole("button", { name: offer }))
      const m = await box(more)
      check(`${name}: the first piece is inline at 44 pt, "+1" beside it at 44 pt, the stake's row hidden`, r.height === 44 && m.height === 44 && m.width >= 44 && Math.abs(m.top - r.top) <= 2 && (await more.textContent()) === "+1" && !(await stakeRow(page).isVisible().catch(() => false)), JSON.stringify({ r, m }))
      check(`${name}: the key numbers keep more than their header`, table > 59, `table ${table} px`)
    } else {
      check(`${name}: two pieces are two rows, no count`, (await more.count()) === 0 && (await visibleCount(page, offer)) === 1 && (await stakeRow(page).isVisible()), `table ${table} px`)
    }
    if (landscape || short) {
      await more.click()
      await page.getByRole("dialog").getByText("Mehr zum Ergebnis").waitFor()
      await page.waitForTimeout(600)
      await shot(page, `sheet-${name}`)
      const dialog = page.getByRole("dialog").last()
      check(`${name}: the sheet lists both pieces as rows`, (await dialog.getByRole("button", { name: offer }).count()) === 1 && (await dialog.getByRole("button", { name: /500 sats/ }).count()) === 1)
      // A piece's own sheet opens over the shared one, which stays.
      await dialog.getByRole("button", { name: offer }).click()
      await page.getByText("Welcher Spieler bist du?").waitFor({ timeout: 10_000 })
      await page.waitForTimeout(600)
      await shot(page, `keep-from-sheet-${name}`)
      check(`${name}: the offer's own sheet opens from the shared sheet`, await page.getByText("Welcher Spieler bist du?").isVisible())
      await page.getByRole("dialog").last().getByRole("button", { name: "Später" }).click()
      await page.waitForTimeout(800)
      check(`${name}: Später in the offer's sheet puts the offer away; the shared sheet remains`, (await page.getByRole("dialog").getByText("Mehr zum Ergebnis").isVisible()) && (await page.getByRole("dialog").getByRole("button", { name: offer }).count()) === 0)
      await page.getByRole("dialog").getByRole("button", { name: "Fertig" }).click()
      await page.waitForTimeout(800)
      check(`${name}: back on the result the stake's row stands alone`, (await page.getByRole("button", { name: /Mehr zum Ergebnis/ }).count()) === 0 && (await stakeRow(page).isVisible()))
      await shot(page, `after-sheet-${name}`)
    }
    check(`${name}: no page errors with two pieces`, errors.length === 0, errors.join(" | "))
    await ctx.close()
  }
}

await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`${results.length - failed} of ${results.length} passed`)
process.exit(failed ? 1 : 0)
