// P0.01 baseline: game screen and home at reference sizes; checks for page scrolling.
import { chromium } from 'playwright'
const OUT = process.argv[2]
const sizes = [
  ['se-safari', 320, 548], ['se-landscape', 568, 320], ['iphone-13', 390, 844], ['iphone-13-landscape', 844, 390],
  ['ipad-portrait', 768, 1024], ['ipad-landscape', 1024, 768], ['desktop', 1440, 900],
]
const browser = await chromium.launch()
const rows = []
for (const [name, w, h] of sizes) {
  for (const players of [2, 6]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'de-DE', hasTouch: w < 1400, isMobile: w < 1400, serviceWorkers: 'block' })
    const page = await ctx.newPage()
    await page.goto('http://localhost:3100/')
    const btn = (n) => page.getByRole('button', { name: n, exact: true }).first()
    const home = await page.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, ih: innerHeight, sw: document.scrollingElement.scrollWidth, iw: innerWidth }))
    if (players === 2) await page.screenshot({ path: `${OUT}/home-${name}.jpg`, type: 'jpeg', quality: 70 })
    await page.getByRole('button', { name: /^X01/ }).first().click()
    for (let i = 3; i <= players; i++) await btn('Spieler hinzufügen').click()
    const names = ['Anna', 'Ben', 'Maximilian-Alexander', 'Dörte', 'Jo', 'Christina']
    for (let i = 1; i <= players; i++) await page.getByRole('textbox', { name: `Spieler ${i}` }).fill(names[i - 1])
    await btn('Spiel starten').click()
    await page.waitForTimeout(600)
    const game = await page.evaluate(() => {
      const se = document.scrollingElement
      const scrollers = [...document.querySelectorAll('*')].filter((el) => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1 }).map((el) => el.tagName + (el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''))
      const ellipsis = [...document.querySelectorAll('*')].filter((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth).length
      return { sh: se.scrollHeight, ih: innerHeight, sw: se.scrollWidth, iw: innerWidth, scrollers, ellipsis }
    })
    await page.screenshot({ path: `${OUT}/game-${players}p-${name}.jpg`, type: 'jpeg', quality: 70 })
    rows.push({ size: `${name} ${w}x${h}`, players, homeScrolls: home.sh > home.ih + 1, homeHScroll: home.sw > home.iw + 1, gameScrolls: game.sh > game.ih + 1, gameHScroll: game.sw > game.iw + 1, innerScrollers: game.scrollers.join(',') || '-', truncated: game.ellipsis })
    await ctx.close()
  }
}
console.table(rows)
await browser.close()
