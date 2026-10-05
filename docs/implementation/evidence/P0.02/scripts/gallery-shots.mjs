// P0.02: screenshots of the shared building blocks (gallery/page.tsx) in light and dark, small and
// large, with the same layout audit as shell-screens.mjs. The gallery is not part of the app:
//   cp docs/implementation/evidence/P0.02/gallery/page.tsx app/dev-gallery/page.tsx
//   npm run build && npx next start -p 3203 &
//   node docs/implementation/evidence/P0.02/scripts/gallery-shots.mjs <out dir>
//   rm -r app/dev-gallery   (and build again)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3203'
const OUT = process.argv[2] ?? 'gallery'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  for (const [name, width, height] of [['se', 320, 548], ['iphone', 390, 844], ['desktop', 1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: 'de-DE', deviceScaleFactor: 2, hasTouch: width < 1400, isMobile: width < 1400, serviceWorkers: 'block' })
    await ctx.addInitScript((theme) => {
      localStorage.setItem('theme', theme)
      // Headless Chromium answers "denied"; show the scanner's first state as a new visitor sees it.
      navigator.permissions.query = () => Promise.resolve({ state: 'prompt' })
    }, scheme)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${BASE}/dev-gallery`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    // The app scrolls inside its own containers; let the page grow for a full-length picture.
    await page.addStyleTag({ content: 'html, body, [data-gallery] { height: auto !important; overflow: visible !important }' })
    await page.screenshot({ path: `${OUT}/gallery-${scheme}-${name}.png`, fullPage: true })
    const overflow = await page.evaluate(() => {
      const vw = innerWidth
      const all = Array.from(document.querySelectorAll('body *'))
      return {
        offscreen: all.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) }).length,
        ellipsis: all.filter((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1).length,
      }
    })
    console.log(`${scheme} ${name}: offscreen ${overflow.offscreen}, ellipsis ${overflow.ellipsis}, errors ${errors.length}`)
    await ctx.close()
  }
}
await browser.close()
