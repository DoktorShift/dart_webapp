// P0.02 review round 1: checks for the review findings and the extension points added with them.
//   node docs/implementation/evidence/P0.02/scripts/review1-checks.mjs <out dir>
// Three production builds: MAIN = this branch (nothing registered), BASE = the reviewed commit
// c61a108 (git archive, same node_modules), EXT = this branch plus sample-extensions.tsx (see there).
// Checks: tabs keep pushed screens, scroll positions and typed drafts under setup and a game;
// setup and the game return to the tab they were opened from; texts; empty states on phones in
// landscape; pixel identity with the reviewed commit while nothing is registered; and the slot
// lists and game menu items end to end.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAIN = process.env.MAIN ?? 'http://localhost:3303'
const BASE = process.env.BASE ?? 'http://localhost:3304'
const EXT = process.env.EXT ?? 'http://localhost:3305'
const OUT = process.argv[2] ?? 'review1-out'
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const MATCHES = Array.from({ length: 40 }, (_, i) => ({
  id: `seed-${i}`, finishedAt: new Date(Date.UTC(2026, 9, 3, 18, i)).toISOString(), modeId: '501', modeName: '501', modeType: 'x01',
  players: [{ name: 'Lena' + (i % 9), won: true, darts: 18, points: 501 }, { name: 'Tom' + i, won: false, darts: 18, points: 400 }],
}))
const dart = (segment, multiplier = 1) => ({ kind: 'dart', dart: { segment, multiplier } })
// 301 double out, Anna needs the bull (50) to win.
const NEAR_WIN = {
  id: 'near-win', startedAt: '2026-10-05T18:00:00.000Z', acknowledgedLegs: 0, status: 'paused',
  config: { modeId: '301', modeName: '301', type: 'x01', startScore: 301, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: 'alternate', players: [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }] },
  throws: [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)],
}

const browser = await chromium.launch()

async function open(base, { viewport = { width: 320, height: 548 }, locale = 'de-DE', seed = MATCHES, current = null, path = '/', colorScheme = 'light', reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport, locale, hasTouch: true, isMobile: true, serviceWorkers: 'block', colorScheme, reducedMotion })
  await ctx.addInitScript(([m, c, theme]) => {
    localStorage.setItem('theme', theme)
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    if (m) localStorage.setItem('dart-scorer.matches.v1', m)
    if (c) localStorage.setItem('dart-scorer.current-match.v1', c)
  }, [seed ? JSON.stringify(seed) : null, current ? JSON.stringify(current) : null, colorScheme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(base + path)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  return { ctx, page, errors }
}
const wait = (page, ms = 700) => page.waitForTimeout(ms)
const tabs = (page) => page.getByRole('navigation', { name: /Bereiche|Sections/ }).last()
const tab = (page, name) => tabs(page).getByRole('button', { name, exact: true })
const activeTab = (page) => page.evaluate(() => [...document.querySelectorAll('nav button[aria-current="page"]')].map((b) => b.textContent.trim()).filter(Boolean)[0])
const topHeading = (page, panel) => page.evaluate((panel) => {
  const p = document.querySelector(`[data-tab-panel="${panel}"]`)
  const layers = p ? [...p.children] : []
  return layers.at(-1)?.querySelector('[data-screen-title], h1')?.textContent ?? null
}, panel)
const scrollerTop = (page, panel) => page.evaluate((panel) => {
  const p = document.querySelector(`[data-tab-panel="${panel}"]`)
  const top = p ? [...p.children].at(-1) : null
  if (!top) return null
  const el = [top, ...top.querySelectorAll('*')].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)
  return el ? Math.round(el.scrollTop) : null
}, panel)
const scrollPanel = (page, panel, y) => page.evaluate(([panel, y]) => {
  const p = document.querySelector(`[data-tab-panel="${panel}"]`)
  const top = [...p.children].at(-1)
  const el = [top, ...top.querySelectorAll('*')].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)
  el.scrollTo(0, y)
}, [panel, y])
async function startX01(page) {
  await page.getByRole('button', { name: /^X01/ }).click(); await wait(page, 900)
  await page.getByRole('textbox', { name: 'Spieler 1' }).fill('Anna')
  await page.getByRole('textbox', { name: 'Spieler 2' }).fill('Ben')
}
async function leaveSaving(page) {
  await page.getByRole('button', { name: 'Spiel verlassen' }).click(); await wait(page, 600)
  await page.getByRole('button', { name: 'Speichern und verlassen' }).click(); await wait(page, 900)
}

// ---------- Finding 1: tabs keep their state under setup and the game ----------
{
  const { ctx, page, errors } = await open(MAIN)
  await tab(page, 'Profil').click(); await wait(page, 900)
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click(); await wait(page, 900)
  await scrollPanel(page, 'profile', 300); await wait(page, 300)
  const before = { profile: await scrollerTop(page, 'profile') }
  await tab(page, 'Rangliste').click(); await wait(page, 800)
  await scrollPanel(page, 'leaderboard', 400); await wait(page, 300)
  before.leaderboard = await scrollerTop(page, 'leaderboard')
  await tab(page, 'Clubs').click(); await wait(page, 900)
  await page.getByRole('button', { name: 'Einladung öffnen' }).click(); await wait(page, 1200)
  await page.getByRole('textbox', { name: 'Link einfügen' }).fill('entwurf-123')
  await tab(page, 'Spielen').click(); await wait(page, 700)
  await startX01(page)
  await page.getByRole('button', { name: 'Spiel starten', exact: true }).click(); await wait(page, 1000)
  const tabsHidden = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Bereiche"]')
    return nav ? nav.getBoundingClientRect().height === 0 : true
  })
  check('tab bar is hidden during the game', tabsHidden)
  // A few throws: the hidden tabs must not get in the way.
  for (const k of ['20', '5', '1']) { await page.getByRole('button', { name: k, exact: true }).first().click(); await wait(page, 150) }
  await leaveSaving(page)
  check('save and leave returns to Spielen', (await activeTab(page)) === 'Spielen', await activeTab(page))
  await tab(page, 'Profil').click(); await wait(page, 900)
  const profileTop = await topHeading(page, 'profile')
  const profileScroll = await scrollerTop(page, 'profile')
  check('after a game, Profil still shows Einstellungen', profileTop === 'Einstellungen', profileTop)
  check('after a game, Einstellungen keeps its scroll position', Math.abs(profileScroll - before.profile) <= 2, `${before.profile} → ${profileScroll}`)
  await tab(page, 'Rangliste').click(); await wait(page, 900)
  const lbScroll = await scrollerTop(page, 'leaderboard')
  check('after a game, Rangliste keeps its scroll position', Math.abs(lbScroll - before.leaderboard) <= 2, `${before.leaderboard} → ${lbScroll}`)
  await tab(page, 'Clubs').click(); await wait(page, 900)
  const clubsTop = await topHeading(page, 'clubs')
  const draft = await page.getByRole('textbox', { name: 'Link einfügen' }).inputValue().catch(() => null)
  check('after a game, Clubs still shows Einladung öffnen with the typed draft', clubsTop === 'Einladung öffnen' && draft === 'entwurf-123', `${clubsTop} / ${draft}`)
  await page.screenshot({ path: join(OUT, 'after-game-clubs-draft-de-se.png') })
  check('no console errors (finding 1 flow)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// Finished game: result, Fertig, then the tabs as they were; the leaderboard has the new result.
{
  const { ctx, page, errors } = await open(MAIN, { current: NEAR_WIN, viewport: { width: 390, height: 844 } })
  await tab(page, 'Rangliste').click(); await wait(page, 800)
  await scrollPanel(page, 'leaderboard', 250); await wait(page, 300)
  await tab(page, 'Spielen').click(); await wait(page, 700)
  await page.getByRole('button', { name: /Weiterspielen/ }).first().click(); await wait(page, 1000)
  await page.keyboard.press('b'); await wait(page, 1500)
  const resultShown = await page.getByRole('dialog', { name: /Anna gewinnt/ }).count()
  check('the winning dart shows the result', resultShown === 1)
  await page.screenshot({ path: join(OUT, 'result-main-de-iphone.png') })
  await page.getByRole('button', { name: 'Fertig', exact: true }).click(); await wait(page, 1000)
  check('Fertig returns to Spielen', (await activeTab(page)) === 'Spielen', await activeTab(page))
  await tab(page, 'Rangliste').click(); await wait(page, 900)
  const lbScroll = await scrollerTop(page, 'leaderboard')
  const hasAnna = await page.locator('[data-tab-panel="leaderboard"]').getByText('Anna', { exact: true }).count()
  check('the kept leaderboard keeps its scroll position and shows the new result', Math.abs(lbScroll - 250) <= 2 && hasAnna > 0, `scroll ${lbScroll}, Anna ${hasAnna}`)
  check('no console errors (result flow)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// Focus and default return: setup opened from Play goes back to Play, focus on the X01 button.
{
  const { ctx, page, errors } = await open(MAIN)
  await page.getByRole('button', { name: /^X01/ }).focus()
  await page.keyboard.press('Enter'); await wait(page, 900)
  const back = page.getByRole('button', { name: 'Spielen', exact: true }).first()
  check('setup from Play: back says Spielen', (await back.count()) === 1)
  await back.click(); await wait(page, 900)
  check('setup back returns to Spielen', (await activeTab(page)) === 'Spielen')
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 12) ?? '')
  check('focus returns to the X01 button', focused.startsWith('X01'), focused)
  await page.getByRole('button', { name: /^X01/ }).click(); await wait(page, 900)
  await page.goBack(); await wait(page, 900)
  check('browser back from setup returns to Spielen', (await activeTab(page)) === 'Spielen')
  check('no console errors (setup return)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// Empty leaderboard "Spiel starten" keeps 1.0.0 behaviour: back to Spielen.
{
  const { ctx, page, errors } = await open(MAIN, { seed: null })
  await tab(page, 'Rangliste').click(); await wait(page, 800)
  await page.getByRole('button', { name: 'Spiel starten', exact: true }).click(); await wait(page, 900)
  const back = page.getByRole('button', { name: 'Spielen', exact: true }).first()
  check('setup from the empty leaderboard: back says Spielen (as 1.0.0)', (await back.count()) === 1)
  await back.click(); await wait(page, 900)
  check('setup from the empty leaderboard returns to Spielen (as 1.0.0)', (await activeTab(page)) === 'Spielen', await activeTab(page))
  check('no console errors (leaderboard start)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- The bar of a root screen doesn't flash its title when the screen shows again ----------
{
  const { ctx, page, errors } = await open(MAIN)
  const barTitle = () => page.evaluate(() => {
    const t = document.querySelector('[data-tab-panel="profile"] header .col-start-2')
    return t ? Number(getComputedStyle(t).opacity) : null
  })
  const watch = () => page.evaluate(() => {
    window.__bar = []
    const tick = () => {
      const panel = document.querySelector('[data-tab-panel="profile"]')
      const t = panel?.querySelector('header .col-start-2')
      if (panel && !panel.hidden && t && panel.offsetParent !== null) window.__bar.push(Number(getComputedStyle(t).opacity))
      if (window.__bar.length < 40) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await tab(page, 'Profil').click(); await wait(page, 1000)
  await tab(page, 'Spielen').click(); await wait(page, 600)
  await watch()
  await tab(page, 'Profil').click(); await wait(page, 1000)
  const afterSwitch = await page.evaluate(() => Math.max(...window.__bar))
  await tab(page, 'Spielen').click(); await wait(page, 600)
  await page.getByRole('button', { name: /^X01/ }).click(); await wait(page, 900)
  await page.getByRole('button', { name: 'Spielen', exact: true }).first().click(); await wait(page, 900)
  await watch()
  await tab(page, 'Profil').click(); await wait(page, 1000)
  const afterSetup = await page.evaluate(() => Math.max(...window.__bar))
  check('a root shown again keeps its bar clear (no title flash after a tab switch or setup)', afterSwitch === 0 && afterSetup === 0, `max opacity ${afterSwitch} / ${afterSetup}`)
  await page.locator('[data-tab-panel="profile"] [data-scroll-container]').last().evaluate((el) => el.scrollTo(0, el.scrollHeight)); await wait(page, 600)
  const scrolled = await barTitle()
  await tab(page, 'Spielen').click(); await wait(page, 600)
  await tab(page, 'Profil').click(); await wait(page, 800)
  const scrolledBack = await barTitle()
  check('scrolled away, the title sits in the bar, also after a tab switch', scrolled === 1 && scrolledBack === 1, `${scrolled} / ${scrolledBack}`)
  check('no console errors (bar title)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- Finding 4 and 6: texts ----------
for (const [locale, title, back] of [['de-DE', 'Spielerprofil', 'Profil'], ['en-US', 'Player profile', 'Profile']]) {
  const { ctx, page } = await open(MAIN, { locale, path: '/#p=abc' })
  await wait(page, 600)
  const heading = await topHeading(page, 'profile')
  const backLabel = await page.locator('[data-tab-panel="profile"] header button').last().textContent()
  check(`#p= link (${locale}): title ${title}, back ${back}`, heading === title && backLabel.trim() === back, `${heading} / ${backLabel}`)
  await page.screenshot({ path: join(OUT, `p-link-${locale.slice(0, 2)}-se.png`) })
  await ctx.close()
}
{
  const { ctx, page } = await open(MAIN, { locale: 'en-US' })
  await tab(page, 'Clubs').click(); await wait(page, 900)
  await page.getByRole('button', { name: 'Start a club' }).click(); await wait(page, 1000)
  const text = await page.locator('[data-tab-panel="clubs"]').getByText('This is coming in a future version.').count()
  check('EN placeholder text reads "This is coming in a future version."', text === 1)
  await ctx.close()
}

// ---------- Finding 2: empty states on phones in landscape ----------
for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }, { width: 320, height: 548 }]) {
  for (const locale of ['de-DE', 'en-US']) {
    for (const colorScheme of ['light', 'dark']) {
      const { ctx, page } = await open(MAIN, { viewport, locale, colorScheme })
      for (const [tabName, primary, secondary, panel] of locale === 'de-DE'
        ? [['Clubs', 'Club gründen', 'Einladung öffnen', 'clubs'], ['Turniere', 'Turnier erstellen', 'Einladung öffnen', 'tournaments']]
        : [['Clubs', 'Start a club', 'Open invitation', 'clubs'], ['Tournaments', 'Create tournament', 'Open invitation', 'tournaments']]) {
        await tab(page, tabName).click(); await wait(page, 1000)
        const barTop = await tabs(page).evaluate((n) => n.getBoundingClientRect().top)
        const scope = page.locator(`[data-tab-panel="${panel}"]`)
        const p = await scope.getByRole('button', { name: primary, exact: true }).boundingBox()
        const s = await scope.getByRole('button', { name: secondary, exact: true }).boundingBox()
        const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
        const fits = p && s && p.y + p.height <= barTop + 0.5 && s.y + s.height <= barTop + 0.5 && p.height >= 44 && s.height >= 44
        check(`${tabName} empty state fits above the tab bar at ${viewport.width}x${viewport.height} ${locale} ${colorScheme}`, fits && !hscroll, `bar ${Math.round(barTop)}, primary bottom ${Math.round(p.y + p.height)}, secondary bottom ${Math.round(s.y + s.height)}`)
        await page.screenshot({ path: join(OUT, `${panel}-${locale.slice(0, 2)}-${colorScheme}-${viewport.width}x${viewport.height}.png`) })
      }
      await ctx.close()
    }
  }
}

// ---------- Zero visual change without registrations: this branch vs. the reviewed commit ----------
async function shots(base) {
  const out = {}
  const { ctx, page } = await open(base, { viewport: { width: 390, height: 844 }, current: NEAR_WIN, reducedMotion: 'reduce' })
  await page.getByRole('button', { name: /^X01/ }).click(); await wait(page, 900)
  out.setup = await page.screenshot({ fullPage: false })
  await page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('div')].filter((e) => e.offsetParent !== null && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)
    scrollers.at(0)?.scrollTo(0, 99999)
  }); await wait(page, 400)
  out.setupEnd = await page.screenshot()
  await page.getByRole('button', { name: 'Spielen', exact: true }).first().click(); await wait(page, 900)
  await page.getByRole('button', { name: /Weiterspielen/ }).first().click(); await wait(page, 1000)
  out.game = await page.screenshot()
  await page.getByRole('button', { name: 'Spieloptionen' }).click(); await wait(page, 900)
  out.options = await page.screenshot()
  await page.getByRole('button', { name: 'Fertig', exact: true }).click(); await wait(page, 700)
  await page.keyboard.press('b'); await wait(page, 1600)
  out.result = await page.screenshot()
  await ctx.close()
  return out
}
{
  const a = await shots(MAIN)
  const b = await shots(BASE)
  for (const key of Object.keys(a)) {
    writeFileSync(join(OUT, `same-${key}-main.png`), a[key])
    writeFileSync(join(OUT, `same-${key}-base.png`), b[key])
    check(`without registrations, ${key} is pixel-identical to the reviewed commit`, Buffer.compare(a[key], b[key]) === 0)
  }
}

// ---------- Extension points (scratch build with sample registrations) ----------
{
  const { ctx, page, errors } = await open(EXT, { viewport: { width: 390, height: 844 } })
  await tab(page, 'Clubs').click(); await wait(page, 900)
  await page.getByRole('button', { name: 'Club gründen' }).click(); await wait(page, 1000)
  const back = page.getByRole('button', { name: 'Clubs', exact: true }).first()
  check('openSetup from Clubs: setup back says Clubs', (await back.count()) === 1)
  await page.screenshot({ path: join(OUT, 'ext-setup-top-de-iphone.png') })
  await back.click(); await wait(page, 900)
  check('setup back returns to Clubs', (await activeTab(page)) === 'Clubs' && (await topHeading(page, 'clubs')) === 'Clubs')
  await page.getByRole('button', { name: 'Club gründen' }).click(); await wait(page, 1000)
  await page.goBack(); await wait(page, 900)
  check('browser back from setup returns to Clubs', (await activeTab(page)) === 'Clubs')
  await page.getByRole('button', { name: 'Club gründen' }).click(); await wait(page, 1000)
  await page.getByRole('textbox', { name: 'Spieler 1' }).fill('Anna')
  await page.getByRole('textbox', { name: 'Spieler 2' }).fill('Ben')
  const extra = page.getByText('Testbereich')
  await extra.scrollIntoViewIfNeeded()
  check('setup.extras piece is shown at the end of the options', (await extra.count()) === 1)
  check('a throwing setup.extras piece is left out, setup still works', (await page.getByRole('button', { name: 'Spiel starten', exact: true }).count()) === 1)
  await page.getByText('Testoption').click(); await wait(page, 300)
  check('setup.extras onChange sets the value', (await page.getByText(/Wert: true/).count()) === 1)
  await page.screenshot({ path: join(OUT, 'ext-setup-extras-de-iphone.png') })
  await page.getByRole('button', { name: 'Spiel starten', exact: true }).click(); await wait(page, 1000)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dart-scorer.current-match.v1')))
  check('the started game carries config.extras', JSON.stringify(saved?.config?.extras) === '{"test":true}', JSON.stringify(saved?.config?.extras))
  await page.getByRole('button', { name: '20', exact: true }).first().click(); await wait(page, 300)
  await page.getByRole('button', { name: 'Spieloptionen' }).click(); await wait(page, 900)
  const entry = page.getByRole('button', { name: 'Testeintrag' })
  check('game menu item is listed in the options menu', (await entry.count()) === 1)
  await page.screenshot({ path: join(OUT, 'ext-game-menu-de-iphone.png') })
  await entry.click(); await wait(page, 700)
  const menu = await page.evaluate(() => window.__menu)
  const sheetOpen = await page.getByRole('button', { name: 'Testeintrag' }).count()
  check('selecting it closes the menu and passes the running game', sheetOpen === 0 && menu === `${saved.id}|1|{"test":true}`, menu)
  await leaveSaving(page)
  check('leaving a game started from Clubs returns to Clubs', (await activeTab(page)) === 'Clubs', await activeTab(page))
  check('no console errors besides the deliberate throwing piece', errors.filter((e) => !/boom piece/.test(e)).length === 0, errors.filter((e) => !/boom piece/.test(e)).join(' | '))
  await ctx.close()
}
for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 548 }]) {
  const { ctx, page } = await open(EXT, { viewport, current: NEAR_WIN })
  await page.getByRole('button', { name: /Weiterspielen/ }).first().click(); await wait(page, 1000)
  await page.keyboard.press('b'); await wait(page, 1600)
  const cards = page.getByTestId('test-card')
  const count = await cards.count()
  const visible = count === 1 && (await cards.first().isVisible())
  const text = count ? await cards.first().textContent() : ''
  const order = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="test-card"]')
    const button = document.querySelector('[data-testid="test-button"]')
    return card && button ? Boolean(card.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) : false
  })
  const buttons = await page.getByTestId('test-button').count()
  const rematch = await page.getByRole('button', { name: 'Revanche' }).filter({ visible: true }).boundingBox().catch(() => null)
  const cardBox = visible ? await cards.first().boundingBox() : null
  check(`result.actions at ${viewport.width}x${viewport.height}: once, visible, in order, above Revanche`, visible && buttons === 1 && order && rematch && cardBox && cardBox.y < rematch.y && /Anna gewinnt, 2 Spieler, 9 Würfe/.test(text), `${count} card(s), ${buttons} button(s), "${text}"`)
  await page.screenshot({ path: join(OUT, `ext-result-${viewport.width}x${viewport.height}.png`) })
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
process.exit(failed.length ? 1 : 0)
