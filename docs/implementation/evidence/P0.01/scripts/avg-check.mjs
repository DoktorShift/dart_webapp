import { chromium } from 'playwright'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true, isMobile: true, serviceWorkers: 'block' })
const page = await ctx.newPage()
await page.goto('http://localhost:3100/')
const btn = (n) => page.getByRole('button', { name: n, exact: true }).first()
await btn('X01 301, 501, 701').click()
await page.getByRole('textbox', { name: 'Spieler 1' }).fill('Anna')
await page.getByRole('textbox', { name: 'Spieler 2' }).fill('Ben')
await page.getByRole('radio', { name: '301' }).click()
await btn('Spiel starten').click()
const seq = [['Triple','T20'],['Triple','T20'],['20'],['20'],['19'],['20'],['Triple','T20'],['Triple','T17']]
for (const s of seq) { for (const n of s) await btn(n).click(); await page.waitForTimeout(150) }
const sb = () => page.getByRole('region', { name: 'Spielstand' }).getByRole('listitem').allInnerTexts()
console.log('before last dart', (await sb()).map(t=>t.replace(/\s+/g,' ')))
await btn('Bull, 50').click()
for (const ms of [100, 600, 1500, 4000]) { await page.waitForTimeout(ms); console.log(`+${ms}ms`, (await sb()).map(t=>t.replace(/\s+/g,' '))) }
await browser.close()
