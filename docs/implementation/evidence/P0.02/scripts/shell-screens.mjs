// P0.02: screenshots of every new screen in German and English, light and dark, at the reference
// sizes, plus the unchanged game screen; each picture is checked for horizontal overflow, text cut
// off with an ellipsis, controls whose text overflows them and touch targets under 44 × 44 pt.
// Usage (production build on port 3203):
//   node docs/implementation/evidence/P0.02/scripts/shell-screens.mjs <out dir> [locales] [schemes] [sizes]
//   e.g. … /tmp/shots de,en light,dark se,iphone,ipad,ipad-landscape,desktop
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3203'
const OUT = process.argv[2] ?? 'shots'
const LOCALES = (process.argv[3] ?? 'de,en').split(',')
const SCHEMES = (process.argv[4] ?? 'light,dark').split(',')
const SIZES = {
  se: [320, 548],
  iphone: [390, 844],
  ipad: [768, 1024],
  'ipad-landscape': [1024, 768],
  desktop: [1440, 900],
  'se-landscape': [568, 320],
  'iphone-landscape': [844, 390],
}
const SIZE_NAMES = (process.argv[5] ?? 'se,iphone,ipad,ipad-landscape,desktop').split(',')
mkdirSync(OUT, { recursive: true })

const L = {
  de: { tabs: ['Spielen', 'Rangliste', 'Clubs', 'Turniere', 'Profil'], settings: 'Einstellungen', about: 'Über die App', have: 'Ich habe schon ein Profil', clubCreate: 'Club gründen', openInvite: 'Einladung öffnen', scan: 'Code scannen', start: 'Spiel starten', p1: 'Spieler 1', p2: 'Spieler 2', sections: 'Bereiche' },
  en: { tabs: ['Play', 'Leaderboard', 'Clubs', 'Tournaments', 'Profile'], settings: 'Settings', about: 'About', have: 'I already have a profile', clubCreate: 'Start a club', openInvite: 'Open invitation', scan: 'Scan code', start: 'Start game', p1: 'Player 1', p2: 'Player 2', sections: 'Sections' },
}

const MATCHES = Array.from({ length: 14 }, (_, i) => ({
  id: `seed-${i}`,
  finishedAt: new Date(Date.UTC(2026, 9, 3, 18, i)).toISOString(),
  modeId: '501',
  modeName: '501',
  modeType: 'x01',
  players: [
    { name: 'Lena', won: i % 3 !== 0, darts: 18, points: 501 },
    { name: i % 2 ? 'Tom' : 'Maximilian-Alexander', won: i % 3 === 0, darts: 18, points: 400 },
  ],
}))

const tab = (page, l, i) => page.getByRole('navigation', { name: l.sections }).getByRole('button', { name: l.tabs[i], exact: true }).first()
const settle = (page, ms = 650) => page.waitForTimeout(ms)

// name → steps from a fresh start page
const SCREENS = {
  play: async () => {},
  leaderboard: async (page, l) => tab(page, l, 1).click(),
  clubs: async (page, l) => tab(page, l, 2).click(),
  tournaments: async (page, l) => tab(page, l, 3).click(),
  profile: async (page, l) => tab(page, l, 4).click(),
  'profile-scrolled': async (page, l) => {
    await tab(page, l, 4).click()
    await settle(page, 300)
    await page.locator('[data-tab-panel="profile"] [data-scroll-container]').last().evaluate((el) => el.scrollTo(0, el.scrollHeight))
  },
  'profile-sheet': async (page, l) => {
    await tab(page, l, 4).click()
    await page.getByRole('button', { name: l.have }).click()
  },
  settings: async (page, l) => {
    await tab(page, l, 4).click()
    await page.getByRole('button', { name: l.settings, exact: true }).click()
  },
  about: async (page, l) => {
    await tab(page, l, 4).click()
    await page.getByRole('button', { name: l.about, exact: true }).click()
  },
  'club-create': async (page, l) => {
    await tab(page, l, 2).click()
    await page.getByRole('button', { name: l.clubCreate }).click()
  },
  'open-invite': async (page, l) => {
    // Headless Chromium answers "denied" for the camera; a real browser starts at "prompt".
    await page.evaluate(() => { navigator.permissions.query = () => Promise.resolve({ state: 'prompt' }) })
    await tab(page, l, 2).click()
    await page.getByRole('button', { name: l.openInvite }).click()
  },
  'open-invite-denied': async (page, l) => {
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('simulated', 'NotAllowedError')) })
    await tab(page, l, 2).click()
    await page.getByRole('button', { name: l.openInvite }).click()
    await settle(page, 900)
    await page.getByRole('button', { name: l.scan }).click()
  },
  'link-invite': async (page) => {
    await page.evaluate(() => { location.hash = '#club=abc123' })
  },
  game: async (page, l) => {
    await page.getByRole('button', { name: /^X01/ }).click()
    await settle(page, 500)
    await page.getByRole('textbox', { name: l.p1 }).fill('Anna')
    await page.getByRole('textbox', { name: l.p2 }).fill('Maximilian-Alexander')
    await page.getByRole('button', { name: l.start, exact: true }).click()
    await settle(page, 900)
  },
}
const ONLY = process.env.SCREENS ? process.env.SCREENS.split(',') : Object.keys(SCREENS)

// Layout problems in what is visible: overflow, ellipsis, overflowing controls, small targets.
const audit = () => {
  const vw = innerWidth
  const shown = (el) => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight
  }
  const all = Array.from(document.querySelectorAll('body *')).filter(shown)
  const describe = (el) => `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}`
  const pageScroll = document.scrollingElement.scrollWidth > vw + 1
  const offscreen = all.filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 }).map(describe)
  const ellipsis = all.filter((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1).map(describe)
  const controls = all.filter((el) => el.matches('button, a[href], [role="radio"]'))
  const overflowing = controls.filter((el) => el.scrollWidth > el.clientWidth + 1).map(describe)
  const small = all
    // A switch inside a <label> row is operated through the whole row (SwitchRow), so the row counts.
    .filter((el) => el.matches('button, a[href], input, [role="radio"], summary') && !el.closest('[data-vaul-drawer] [data-vaul-handle]'))
    .map((el) => (el.matches('[role="switch"]') && el.closest('label') ? el.closest('label') : el))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 })
    .map((el) => { const r = el.getBoundingClientRect(); return `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}` })
  const scrollsVertically = document.scrollingElement.scrollHeight > innerHeight + 1
  return { pageScroll, scrollsVertically, offscreen: offscreen.slice(0, 5), ellipsis, overflowing, small }
}

const browser = await chromium.launch()
const report = []
for (const locale of LOCALES) {
  const l = L[locale]
  for (const scheme of SCHEMES) {
    for (const sizeName of SIZE_NAMES) {
      const [width, height] = SIZES[sizeName]
      const ctx = await browser.newContext({
        viewport: { width, height },
        locale: locale === 'de' ? 'de-DE' : 'en-US',
        colorScheme: scheme,
        hasTouch: width < 1400,
        isMobile: width < 1400,
        deviceScaleFactor: 2,
        serviceWorkers: 'block',
      })
      await ctx.addInitScript(([m, theme]) => {
        if (!localStorage.getItem('dart-scorer.matches.v1')) localStorage.setItem('dart-scorer.matches.v1', m)
        localStorage.setItem('theme', theme)
      }, [JSON.stringify(MATCHES), scheme])
      const page = await ctx.newPage()
      for (const name of ONLY) {
        // A fresh document each time: loading "/" again on a pushed screen counts as a reload, and
        // the app then steps the browser history back to its roots, which interrupts the load.
        await page.goto('about:blank')
        await page.goto(BASE + '/')
        await page.evaluate(() => localStorage.removeItem('dart-scorer.current-match.v1'))
        await page.goto(BASE + '/')
        await page.waitForLoadState('networkidle')
        try {
          await SCREENS[name](page, l)
        } catch (error) {
          report.push({ shot: `${name}-${locale}-${scheme}-${sizeName}`, error: String(error).split('\n')[0] })
          continue
        }
        await settle(page)
        const file = `${name}-${locale}-${scheme}-${sizeName}.png`
        await page.screenshot({ path: `${OUT}/${file}` })
        const a = await page.evaluate(audit)
        report.push({ shot: file, ...a })
      }
      await ctx.close()
    }
  }
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
const problems = report.filter((r) => r.error || r.pageScroll || r.offscreen?.length || r.ellipsis?.length || r.overflowing?.length || r.small?.length)
console.log(`${report.length} screenshots, ${problems.length} with findings`)
for (const p of problems) console.log(JSON.stringify(p))
