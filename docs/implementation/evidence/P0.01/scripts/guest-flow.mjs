// P0.01 baseline: play a guest game on the local production build and record UI + storage.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })
const log = []
const note = (m) => { log.push(m); console.log(m) }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const shot = async (name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 80 })
const storage = async (label) => {
  const s = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))
  const sizes = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.length]))
  note(`storage after ${label}: ${JSON.stringify(sizes)}`)
  return s
}
const btn = (name, exact = true) => page.getByRole('button', { name, exact }).first()
const dart = async (d) => {
  if (d.startsWith('T')) { await btn('Triple').click(); await btn(d).click() }
  else if (d.startsWith('D')) { await btn('Double').click(); await btn(d).click() }
  else if (d === 'BULL') await btn('Bull, 50').click()
  else await btn(d).click()
  await page.waitForTimeout(150)
}
const scores = async () => (await page.getByRole('region', { name: 'Spielstand' }).getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))

await page.goto('http://localhost:3100/')
await page.waitForLoadState('networkidle')
await shot('01-home')
await storage('first open')

await btn('X01 301, 501, 701').click()
await page.getByRole('textbox', { name: 'Spieler 1' }).fill('Anna')
await page.getByRole('textbox', { name: 'Spieler 2' }).fill('Ben')
await page.getByRole('radio', { name: '301' }).click()
await shot('02-setup-x01')
await btn('Spiel starten').click()
await page.waitForTimeout(500)
await shot('03-game-start')
await storage('start')

// Anna: T20 T20 20 = 140
for (const d of ['T20', 'T20', '20']) await dart(d)
await page.waitForTimeout(800)
note(`after Anna visit 1: ${JSON.stringify(await scores())}`)
await storage('Anna visit 1')

// Ben: 20, wrong 5, undo, 19, 20 = 59
await dart('20'); await dart('5')
await storage('Ben 2 darts (one wrong)')
await btn('Letzten Dart rückgängig machen').click()
await page.waitForTimeout(200)
note(`undo enabled after undo: ${await btn('Letzten Dart rückgängig machen').isEnabled()}`)
await dart('19')
await shot('04-game-correcting')
await dart('20')
await page.waitForTimeout(800)
note(`after Ben visit 1 with correction: ${JSON.stringify(await scores())}`)
const midGame = await storage('Ben visit 1')

// Reload in the middle of the game: does it resume?
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(500)
await shot('05-after-reload')
const afterReload = await page.locator('body').ariaSnapshot()
note(`after reload, game screen visible: ${afterReload.includes('Punkteingabe')}`)
if (!afterReload.includes('Punkteingabe')) note(afterReload.slice(0, 1500))
note(`scores after reload: ${afterReload.includes('Punkteingabe') ? JSON.stringify(await scores()) : 'n/a'}`)

// Anna checks out 161: T20 T17 BULL
for (const d of ['T20', 'T17', 'BULL']) await dart(d)
await page.waitForTimeout(1500)
await shot('06-result')
const result = await page.locator('body').ariaSnapshot()
note(`result screen:\n${result.slice(0, 2500)}`)
const finished = await storage('finish')

writeFileSync(`${OUT}/storage-mid-game.json`, JSON.stringify(midGame, null, 1))
writeFileSync(`${OUT}/storage-finished.json`, JSON.stringify(finished, null, 1))
writeFileSync(`${OUT}/result-aria.txt`, result)
note(`page errors: ${JSON.stringify(errors)}`)
writeFileSync(`${OUT}/flow-log.txt`, log.join('\n'))
await browser.close()
