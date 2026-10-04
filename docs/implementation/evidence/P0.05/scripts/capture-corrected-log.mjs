// P0.05: play a guest game with a real correction on the local production build and keep the
// stored throw log, so the compact throw encoding is tested on what the app really writes.
//   npx next start -p 3204   then   node docs/implementation/evidence/P0.05/scripts/capture-corrected-log.mjs <out-dir>
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const btn = (name, exact = true) => page.getByRole('button', { name, exact }).first()
const dart = async (d) => {
  if (d.startsWith('T')) { await btn('Triple').click(); await btn(d).click() }
  else if (d.startsWith('D')) { await btn('Double').click(); await btn(d).click() }
  else if (d === 'BULL') await btn('Bull, 50').click()
  else await btn(d).click()
  await page.waitForTimeout(150)
}
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 80 })

await page.goto('http://localhost:3204/')
await page.waitForLoadState('networkidle')
await btn('X01 301, 501, 701').click()
await page.getByRole('textbox', { name: 'Spieler 1' }).fill('Anna')
await page.getByRole('textbox', { name: 'Spieler 2' }).fill('Ben')
await page.getByRole('radio', { name: '301' }).click()
await btn('Spiel starten').click()
await page.waitForTimeout(500)

// Anna T20 T20 20 (140), Ben 20 19 20 (59)
for (const d of ['T20', 'T20', '20', '20', '19', '20']) await dart(d)
await page.waitForTimeout(800)

// Ben's second dart was a 5, not a 19: correct it in the finished visit.
await page.getByRole('button', { name: /Diese Aufnahme korrigieren/ }).first().click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: /^Dart 2, .*Zum Korrigieren tippen$/ }).first().click()
await page.waitForTimeout(300)
await shot('correcting')
await dart('5')
await page.waitForTimeout(500)
const apply = page.getByRole('button', { name: 'Korrektur übernehmen' })
if (await apply.count()) await apply.first().click()
await page.waitForTimeout(800)
await shot('corrected')

// Anna checks out 161: T20 T17 BULL
for (const d of ['T20', 'T17', 'BULL']) await dart(d)
await page.waitForTimeout(1500)
await shot('result')
const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))
writeFileSync(`${OUT}/storage-corrected.json`, JSON.stringify(storage, null, 1))
const match = JSON.parse(storage['dart-scorer.current-match.v1'] ?? 'null')
console.log(JSON.stringify(match?.throws))
console.log(`page errors: ${JSON.stringify(errors)}`)
await browser.close()
