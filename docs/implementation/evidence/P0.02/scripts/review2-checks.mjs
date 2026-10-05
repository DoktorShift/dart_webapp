// P0.02 review round 2: one push/pop motion for stacks, tabs, setup and the game
// (components/nav/motion.ts), focus return (use-focus-return.ts) and the open-tab tap rule, now only
// in the nav reducer. Checked on the production build. Usage:
//   npm run build && npx next start -p 3303 &
//   node docs/implementation/evidence/P0.02/scripts/review2-checks.mjs <out dir>
// The out dir gets screenshots taken in the middle of each animation.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:3303'
const OUT = process.argv[2] ?? 'review2-out'
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const MATCHES = Array.from({ length: 40 }, (_, i) => ({
  id: `seed-${i}`, finishedAt: new Date(Date.UTC(2026, 9, 3, 18, i)).toISOString(), modeId: '501', modeName: '501', modeType: 'x01',
  players: [{ name: 'Lena', won: true, darts: 18, points: 501 }, { name: 'Tom' + i, won: false, darts: 18, points: 400 }],
}))

// In the page: the open tab's screens, bottom to top, with title, horizontal offset as a share of
// the width, opacity and display; the same for the tabs layer (the child of the fixed root holding
// the panels) and for setup on top of it.
function measure() {
  const box = (el) => {
    const style = getComputedStyle(el)
    const x = new DOMMatrix(style.transform === 'none' ? undefined : style.transform).m41
    return { x: Math.round((x / el.getBoundingClientRect().width) * 100) / 100, opacity: Math.round(Number(style.opacity) * 100) / 100, display: style.display }
  }
  window.navLayers = (panel) => {
    const p = document.querySelector(`[data-tab-panel="${panel}"]`)
    const root = document.querySelector('div.fixed.inset-0')
    const tabsLayer = [...root.children].find((c) => c.contains(p))
    const cover = [...root.children].slice([...root.children].indexOf(tabsLayer) + 1).find((c) => c.querySelector('header'))
    return {
      stack: [...p.children].map((l) => ({ title: l.querySelector('[data-screen-title], h1')?.textContent ?? null, ...box(l) })),
      tabs: box(tabsLayer),
      cover: cover ? box(cover) : null,
    }
  }
}

const browser = await chromium.launch()
async function open({ viewport = { width: 390, height: 844 }, reducedMotion = 'no-preference', scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'de-DE', colorScheme: scheme, hasTouch: true, isMobile: viewport.width < 1024, serviceWorkers: 'block', reducedMotion })
  await ctx.addInitScript(([m, theme]) => {
    if (!localStorage.getItem('dart-scorer.matches.v1')) localStorage.setItem('dart-scorer.matches.v1', m)
    localStorage.setItem('theme', theme)
  }, [JSON.stringify(MATCHES), scheme])
  await ctx.addInitScript(measure)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + '/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  return { ctx, page, errors }
}
const wait = (page, ms = 900) => page.waitForTimeout(ms)
const tab = (page, name) => page.getByRole('navigation', { name: 'Bereiche' }).filter({ visible: true }).getByRole('button', { name, exact: true })
const depth = (page) => page.evaluate(() => history.state?.blueline?.depth ?? null)
const layers = (page, panel) => page.evaluate((panel) => window.navLayers(panel), panel)
// Every frame of the next `ms` milliseconds, for animations too short to catch with one look.
const recordLayers = (page, panel, ms) => page.evaluate(([panel, ms]) => new Promise((resolve) => {
  const frames = []
  const start = performance.now()
  const step = () => {
    frames.push(window.navLayers(panel))
    if (performance.now() - start < ms) requestAnimationFrame(step)
    else resolve(frames)
  }
  requestAnimationFrame(step)
}), [panel, ms])
const focused = (page) => page.evaluate(() => ({
  text: document.activeElement?.textContent?.trim().slice(0, 24) ?? '',
  title: document.activeElement?.hasAttribute('data-screen-title') ?? false,
}))
const callNavigator = (page, method, ...args) => page.evaluate(([method, args]) => {
  const el = document.querySelector('[data-tab-panel]')
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  for (let f = el[key]; f; f = f.return) {
    const v = f.memoizedProps?.value
    if (v && typeof v.openSetup === 'function') return v[method](...args), true
  }
  return false
}, [method, args])

// --- Tapping a tab: a switch keeps the stack; the open tab goes to its root, then scrolls up ---
{
  const { ctx, page, errors } = await open({ viewport: { width: 320, height: 548 } })
  await tab(page, 'Profil').click(); await wait(page)
  await page.locator('[data-tab-panel="profile"]').getByRole('button', { name: 'Einstellungen', exact: true }).click(); await wait(page)
  await tab(page, 'Clubs').click(); await wait(page, 400)
  await tab(page, 'Profil').click(); await wait(page, 400)
  let s = await layers(page, 'profile')
  check('switching back to Profil keeps Einstellungen on top', s.stack.at(-1).title === 'Einstellungen' && (await depth(page)) === 1, JSON.stringify(s.stack.map((l) => l.title)))
  await tab(page, 'Profil').click(); await wait(page)
  s = await layers(page, 'profile')
  check('tapping the open tab goes back to its root', s.stack.length === 1 && s.stack[0].title === 'Profil' && (await depth(page)) === 0, JSON.stringify(s.stack.map((l) => l.title)))
  const scroller = page.locator('[data-tab-panel="profile"] [data-scroll-container]').first()
  const before = await scroller.evaluate((el) => (el.scrollTo(0, 200), el.scrollTop)); await wait(page, 300)
  await tab(page, 'Profil').click(); await wait(page, 1200)
  const after = await scroller.evaluate((el) => el.scrollTop)
  check('tapping the open tab at its root scrolls it to the top', before >= 150 && after === 0, `${before} → ${after}`)
  check('no errors (tab taps)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// --- Focus follows navigation: title of a new screen, then back to the control that opened it ---
{
  const { ctx, page, errors } = await open()
  await tab(page, 'Profil').click(); await wait(page)
  await page.locator('[data-tab-panel="profile"]').getByRole('button', { name: 'Einstellungen', exact: true }).focus()
  await page.keyboard.press('Enter'); await wait(page)
  let f = await focused(page)
  check('a pushed screen takes focus on its title', f.title && f.text === 'Einstellungen', JSON.stringify(f))
  await page.getByRole('button', { name: 'Zurück zu Profil' }).focus()
  await page.keyboard.press('Enter'); await wait(page)
  f = await focused(page)
  check('going back returns focus to the row that opened it', !f.title && f.text.startsWith('Einstellungen'), JSON.stringify(f))

  await tab(page, 'Spielen').click(); await wait(page, 400)
  await page.getByRole('button', { name: /^X01/ }).focus()
  await page.keyboard.press('Enter'); await wait(page)
  await page.getByRole('button', { name: 'Spielen', exact: true }).focus()
  await page.keyboard.press('Enter'); await wait(page)
  f = await focused(page)
  check('leaving setup returns focus to the X01 button', f.text.startsWith('X01'), JSON.stringify(f))

  // A pop in a tab that isn't open leaves focus where it is.
  await tab(page, 'Profil').click(); await wait(page)
  await page.locator('[data-tab-panel="profile"]').getByRole('button', { name: 'Einstellungen', exact: true }).click(); await wait(page)
  await tab(page, 'Clubs').click(); await wait(page)
  await page.locator('[data-tab-panel="clubs"]').getByRole('button', { name: 'Club gründen', exact: true }).focus()
  const called = await callNavigator(page, 'popToRoot', 'profile'); await wait(page)
  f = await focused(page)
  check('popping a hidden tab leaves focus in the open one', called && f.text === 'Club gründen', JSON.stringify(f))
  await tab(page, 'Profil').click(); await wait(page)
  const s = await layers(page, 'profile')
  check('the hidden tab was popped to its root', s.stack.length === 1 && s.stack[0].title === 'Profil', JSON.stringify(s.stack.map((l) => l.title)))
  check('no errors (focus)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// --- The same motion everywhere, caught halfway: push, pop, setup over the tabs, and back ---
const between = (v, a, b) => v > a && v < b
// Einstellungen once there and back first, so its code has arrived and the pictures show it.
const warmSettings = async (page) => {
  await page.locator('[data-tab-panel="profile"]').getByRole('button', { name: 'Einstellungen', exact: true }).click(); await wait(page)
  await page.getByRole('button', { name: 'Zurück zu Profil' }).click(); await wait(page)
}
for (const [label, viewport, scheme] of [['320x548', { width: 320, height: 548 }, 'light'], ['1024x768', { width: 1024, height: 768 }, 'dark']]) {
  const { ctx, page, errors } = await open({ viewport, scheme })
  const shot = (name) => page.screenshot({ path: join(OUT, `motion-${name}-de-${scheme}-${label}.jpg`), quality: 80 })
  await tab(page, 'Profil').click(); await wait(page)
  await warmSettings(page)

  await page.locator('[data-tab-panel="profile"]').getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await page.waitForTimeout(110)
  let s = await layers(page, 'profile'); await shot('push')
  check(`${label}: push slides the new screen in from the right over the dimmed one`, between(s.stack[1].x, 0.02, 1) && between(s.stack[0].x, -0.25, -0.01) && between(s.stack[0].opacity, 0.59, 1), JSON.stringify(s.stack))
  await wait(page)
  s = await layers(page, 'profile')
  check(`${label}: after the push the screen below is out of layout`, s.stack[1].x === 0 && s.stack[1].opacity === 1 && s.stack[0].display === 'none', JSON.stringify(s.stack))

  await page.getByRole('button', { name: 'Zurück zu Profil' }).click()
  await page.waitForTimeout(110)
  s = await layers(page, 'profile'); await shot('pop')
  check(`${label}: pop slides the screen out to the right and brings the one below back`, s.stack.length === 2 && between(s.stack[1].x, 0.02, 1) && between(s.stack[0].x, -0.25, 0) && s.stack[0].display !== 'none', JSON.stringify(s.stack))
  await wait(page)

  await tab(page, 'Spielen').click(); await wait(page, 400)
  await page.getByRole('button', { name: /^X01/ }).click()
  await page.waitForTimeout(110)
  s = await layers(page, 'play'); await shot('setup-in')
  check(`${label}: setup slides in over the tabs, which move left and dim`, s.cover && between(s.cover.x, 0.02, 1) && between(s.tabs.x, -0.25, -0.01) && between(s.tabs.opacity, 0.59, 1), JSON.stringify({ tabs: s.tabs, cover: s.cover }))
  await wait(page)
  s = await layers(page, 'play')
  check(`${label}: covered tabs end at -25 % and are taken out of layout`, s.tabs.display === 'none' && s.cover.x === 0, JSON.stringify({ tabs: s.tabs, cover: s.cover }))

  await page.getByRole('button', { name: 'Spielen', exact: true }).click()
  await page.waitForTimeout(110)
  s = await layers(page, 'play'); await shot('setup-out')
  check(`${label}: back from setup slides it out and the tabs back`, s.cover && between(s.cover.x, 0.02, 1) && between(s.tabs.x, -0.25, 0) && s.tabs.display !== 'none', JSON.stringify({ tabs: s.tabs, cover: s.cover }))
  await wait(page)
  s = await layers(page, 'play')
  check(`${label}: tabs back in place`, s.tabs.x === 0 && s.tabs.opacity === 1 && s.cover === null, JSON.stringify({ tabs: s.tabs, cover: s.cover }))
  check(`${label}: no errors (motion)`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// --- Reduce Motion: every push and cover cross-fades in place ---
{
  const { ctx, page, errors } = await open({ viewport: { width: 320, height: 548 }, reducedMotion: 'reduce' })
  await tab(page, 'Profil').click(); await wait(page)
  await warmSettings(page)
  let recording = recordLayers(page, 'profile', 500)
  await page.locator('[data-tab-panel="profile"]').getByRole('button', { name: 'Einstellungen', exact: true }).click()
  let frames = await recording
  const pushed = frames.filter((f) => f.stack.length === 2)
  const fading = pushed.filter((f) => between(f.stack[1].opacity, 0, 1))
  check('Reduce Motion: push fades without moving', fading.length > 0 && pushed.every((f) => f.stack.every((l) => l.display === 'none' || l.x === 0)), `${fading.length} of ${pushed.length} frames mid-fade`)
  await wait(page)
  await tab(page, 'Spielen').click(); await wait(page, 400)
  recording = recordLayers(page, 'play', 500)
  await page.getByRole('button', { name: /^X01/ }).click()
  frames = (await recording).filter((f) => f.cover)
  const crossFading = frames.filter((f) => between(f.cover.opacity, 0, 1) && between(f.tabs.opacity, 0, 1))
  check('Reduce Motion: setup fades in over the fading tabs', crossFading.length > 0 && frames.every((f) => f.cover.x === 0 && (f.tabs.display === 'none' || f.tabs.x === 0)), `${crossFading.length} of ${frames.length} frames mid-fade`)
  check('no errors (Reduce Motion)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
