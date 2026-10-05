// P0.02 after merging nostr-expansion (c91ecc7): Profil › Einstellungen › Daten, a game with the
// save alert, and the Clubs empty state on a phone in landscape, DE/EN, light/dark. Also checks
// that Einstellungen keeps its place in the Profil tab across that game.
//   node docs/implementation/evidence/P0.02/scripts/merge-checks.mjs <out dir>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:3303'
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })
const L = {
  de: { sections: 'Bereiche', tabs: ['Spielen', 'Clubs', 'Profil'], settings: 'Einstellungen', data: 'Daten', start: 'Spiel starten', p: 'Spieler', leave: 'Spiel verlassen', save: 'Speichern und verlassen', alert: 'Dein Spiel konnte nicht gespeichert werden.', clubs: 'Noch kein Club', create: 'Club gründen', open: 'Einladung öffnen' },
  en: { sections: 'Sections', tabs: ['Play', 'Clubs', 'Profile'], settings: 'Settings', data: 'Data', start: 'Start game', p: 'Player', leave: 'Leave game', save: 'Save and leave', alert: 'Your game couldn’t be saved.', clubs: 'No clubs yet', create: 'Start a club', open: 'Open invitation' },
}
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}
const browser = await chromium.launch()

async function open(locale, theme, viewport) {
  const ctx = await browser.newContext({ viewport, locale: locale === 'de' ? 'de-DE' : 'en-US', hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000, serviceWorkers: 'block' })
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  return { ctx, page, errors }
}
const tab = (page, l, name) => page.getByRole('navigation', { name: l.sections }).filter({ visible: true }).getByRole('button', { name, exact: true })
const settingsTop = (page) => page.evaluate(() => {
  const panel = document.querySelector('[data-tab-panel="profile"]')
  const top = [...panel.children].at(-1)
  return { title: top.querySelector('[data-screen-title]')?.textContent, scroll: Math.round(top.querySelector('[data-scroll-container]')?.scrollTop ?? -1) }
})

for (const locale of ['de', 'en']) {
  const l = L[locale]
  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ width: 320, height: 548 }, { width: 1024, height: 768 }]) {
      const tag = `${locale}-${theme}-${viewport.width}x${viewport.height}`
      const { ctx, page, errors } = await open(locale, theme, viewport)
      await tab(page, l, l.tabs[2]).click(); await page.waitForTimeout(1000)
      await page.locator('[data-tab-panel="profile"]').getByRole('button', { name: l.settings, exact: true }).click(); await page.waitForTimeout(1200)
      const heading = page.locator('[data-tab-panel="profile"]').getByRole('heading', { name: l.data, exact: true })
      await heading.scrollIntoViewIfNeeded(); await page.waitForTimeout(500)
      check(`${tag}: Profil › Einstellungen shows the Daten section`, await heading.isVisible())
      await page.screenshot({ path: join(OUT, `settings-data-${tag}.png`) })
      const before = await settingsTop(page)

      await tab(page, l, l.tabs[0]).click(); await page.waitForTimeout(700)
      await page.getByRole('button', { name: /^X01/ }).click(); await page.waitForTimeout(900)
      await page.getByRole('textbox', { name: `${l.p} 1` }).fill('Anna')
      await page.getByRole('textbox', { name: `${l.p} 2` }).fill('Ben')
      await page.getByRole('button', { name: l.start, exact: true }).click(); await page.waitForTimeout(1200)
      // Storage refuses the running game from now on: the alert must say so.
      await page.evaluate(() => {
        const setItem = Storage.prototype.setItem
        window.__restore = () => { Storage.prototype.setItem = setItem }
        Storage.prototype.setItem = function (key, value) {
          if (key === 'dart-scorer.current-match.v1') throw new DOMException('full', 'QuotaExceededError')
          return setItem.call(this, key, value)
        }
      })
      await page.getByRole('button', { name: '20', exact: true }).first().click(); await page.waitForTimeout(1200)
      const alert = page.getByText(l.alert)
      check(`${tag}: a failed save shows the alert over the game`, (await alert.count()) > 0 && (await alert.first().isVisible()))
      await page.screenshot({ path: join(OUT, `game-save-alert-${tag}.png`) })
      await page.evaluate(() => window.__restore())
      await page.getByRole('button', { name: '5', exact: true }).first().click(); await page.waitForTimeout(800)
      await page.getByRole('button', { name: l.leave }).click(); await page.waitForTimeout(700)
      await page.getByRole('button', { name: l.save }).click(); await page.waitForTimeout(1000)
      await tab(page, l, l.tabs[2]).click(); await page.waitForTimeout(1000)
      const after = await settingsTop(page)
      check(`${tag}: after the game Profil still shows Einstellungen at the Daten section`, after.title === before.title && Math.abs(after.scroll - before.scroll) <= 2, `${JSON.stringify(before)} → ${JSON.stringify(after)}`)
      check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
    const { ctx, page } = await open(locale, theme, { width: 568, height: 320 })
    await tab(page, l, l.tabs[1]).click(); await page.waitForTimeout(1200)
    const barTop = await page.getByRole('navigation', { name: l.sections }).filter({ visible: true }).evaluate((n) => n.getBoundingClientRect().top)
    const scope = page.locator('[data-tab-panel="clubs"]')
    const p = await scope.getByRole('button', { name: l.create, exact: true }).boundingBox()
    const s = await scope.getByRole('button', { name: l.open, exact: true }).boundingBox()
    check(`${locale}-${theme}-568x320: Clubs empty state above the tab bar`, p && s && p.y + p.height <= barTop && s.y + s.height <= barTop, `bar ${barTop}, buttons ${Math.round(p.y + p.height)} / ${Math.round(s.y + s.height)}`)
    await page.screenshot({ path: join(OUT, `clubs-${locale}-${theme}-568x320.png`) })
    await ctx.close()
  }
}
await browser.close()
const failed = results.filter((r) => !r).length
console.log(`${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
