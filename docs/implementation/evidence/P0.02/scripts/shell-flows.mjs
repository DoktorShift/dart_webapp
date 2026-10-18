// P0.02: navigation stacks, browser back, app links, the game flow and the invitation scanner,
// checked on the production build. Usage:
//   npm run build && npx next start -p 3203 &
//   node docs/implementation/evidence/P0.02/scripts/shell-flows.mjs <dir with club.y4m, other.y4m>
// The .y4m files are fake camera videos showing a QR code (see make-qr-video.mjs). Without them the
// camera checks are skipped. No real camera is ever opened: camera checks use Chromium's fake device.
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:3203'
const VIDEOS = process.argv[2]
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
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

async function open({ browser, path = '/', locale = 'de-DE', seed = true, init, initArg, viewport = { width: 390, height: 844 }, reducedMotion = 'no-preference', permissions = [] } = {}) {
  const ctx = await browser.newContext({ viewport, locale, hasTouch: true, isMobile: true, serviceWorkers: 'block', reducedMotion, permissions })
  if (seed) await ctx.addInitScript((m) => { if (!localStorage.getItem('dart-scorer.matches.v1')) localStorage.setItem('dart-scorer.matches.v1', m) }, JSON.stringify(MATCHES))
  if (init) await ctx.addInitScript(init, initArg)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + path)
  await page.waitForLoadState('networkidle')
  return { ctx, page, errors }
}

const tabButton = (page, name) => page.getByRole('navigation', { name: /Bereiche|Sections/ }).getByRole('button', { name, exact: true })
const back = (page, to) => page.getByRole('button', { name: `Zurück zu ${to}` })
const depth = (page) => page.evaluate(() => history.state?.blueline?.depth ?? null)
const settle = (page, ms = 500) => page.waitForTimeout(ms)
// The heading of the screen on top: hidden layers are inert and aria-hidden.
const topHeading = async (page) => (await page.locator('[data-tab-panel]:not([hidden]) > div:not([aria-hidden]) [data-screen-title]').last().textContent())?.trim()

const browser = await chromium.launch()

// --- Tabs and the navigation stack ---------------------------------------------------------
{
  const { ctx, page, errors } = await open({ browser })
  const names = ['Spielen', 'Rangliste', 'Clubs', 'Turniere', 'Profil']
  const present = await Promise.all(names.map((n) => tabButton(page, n).isVisible()))
  check('five tabs in the tab bar', present.every(Boolean), names.join(', '))
  check('Spielen is the open tab', (await tabButton(page, 'Spielen').getAttribute('aria-current')) === 'page')
  check('start entry is marked depth 0', (await depth(page)) === 0)

  await tabButton(page, 'Profil').click()
  await page.getByText('Gast', { exact: true }).waitFor()
  check('Profil shows the guest header', await page.getByRole('heading', { name: 'Gast' }).isVisible())
  const stats = page.getByLabel('Auf diesem Gerät')
  // The numbers follow the header once the history has been read.
  await stats.waitFor({ timeout: 5000 }).catch(() => {})
  check('guest numbers come from the match history', await stats.getByText('14', { exact: true }).isVisible())
  check('most wins names the leader', (await stats.getByText('Lena', { exact: true }).isVisible()) && (await stats.getByText('9', { exact: true }).isVisible()))
  check('no history entry for switching tabs', (await depth(page)) === 0)

  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await settle(page)
  check('Einstellungen pushes with a back button to Profil', await back(page, 'Profil').isVisible())
  check('pushed screen title', (await topHeading(page)) === 'Einstellungen')
  check('push adds one history entry', (await depth(page)) === 1)

  await back(page, 'Profil').click()
  await settle(page)
  check('back button pops to Profil', (await topHeading(page)) === 'Profil')
  check('pop steps the history back', (await depth(page)) === 0)

  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await settle(page)
  await page.goBack()
  await settle(page)
  check('browser back pops the stack', (await topHeading(page)) === 'Profil' && page.url().startsWith(BASE))

  await page.getByRole('button', { name: 'Über die App' }).click()
  await settle(page)
  check('Über die App opens inside the Profil tab', (await topHeading(page)) === 'Über die App' && (await back(page, 'Profil').isVisible()))
  await page.locator('[data-tab-panel="profile"] [data-scroll-container]').last().evaluate((el) => el.scrollTo(0, 600))
  await settle(page, 200)
  await tabButton(page, 'Clubs').click()
  await settle(page, 200)
  check('history follows the open tab (Clubs at its root)', (await depth(page)) === 0)
  await tabButton(page, 'Profil').click()
  await settle(page, 300)
  const kept = await page.locator('[data-tab-panel="profile"] [data-scroll-container]').last().evaluate((el) => el.scrollTop)
  check('each tab keeps its stack and scroll position', (await topHeading(page)) === 'Über die App' && Math.abs(kept - 600) < 4, `scrollTop ${kept}`)
  check('switching back restores its history entry', (await depth(page)) === 1)
  await tabButton(page, 'Profil').click()
  await settle(page)
  check('tapping the open tab goes to its root', (await topHeading(page)) === 'Profil' && (await depth(page)) === 0)

  await tabButton(page, 'Rangliste').click()
  await settle(page, 200)
  const board = page.locator('[data-tab-panel="leaderboard"] .overflow-y-auto').first()
  // Somewhere in the middle of what can be scrolled.
  const target = await board.evaluate((el) => { el.scrollTo(0, Math.round((el.scrollHeight - el.clientHeight) / 2)); return el.scrollTop })
  await settle(page, 150)
  await tabButton(page, 'Spielen').click()
  await tabButton(page, 'Rangliste').click()
  await settle(page, 200)
  const boardTop = await board.evaluate((el) => el.scrollTop)
  check('Rangliste keeps its scroll position across tabs', target > 0 && Math.abs(boardTop - target) < 4, `scrollTop ${boardTop} of ${target}`)

  check('no console errors (navigation)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// --- App links ------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open({ browser, path: '/#club=abc123' })
  await settle(page)
  check('a club link opens the Clubs tab', (await tabButton(page, 'Clubs').getAttribute('aria-current')) === 'page')
  check('… on its invitation screen', (await topHeading(page)) === 'Einladung' && (await page.getByText('Diesen Link kann diese Version noch nicht öffnen.').isVisible()))
  check('… and the link leaves the address bar', (await page.evaluate(() => location.hash)) === '')
  await page.goBack()
  await settle(page)
  check('browser back from a link goes to the tab root', (await topHeading(page)) === 'Clubs' && page.url().startsWith(BASE))

  await page.evaluate(() => { location.hash = '#tournament=t9' })
  await settle(page, 700)
  check('a link while the app is open (hashchange)', (await topHeading(page)) === 'Turnier' && (await page.evaluate(() => location.hash)) === '')
  await page.goBack()
  await settle(page, 600)
  check('… and browser back pops it', (await topHeading(page)) === 'Turniere', String(await topHeading(page)))

  await page.evaluate(() => { location.hash = '#foo=bar' })
  await settle(page, 600)
  check('unknown fragments are ignored', (await topHeading(page)) === 'Turniere')
  await page.evaluate(() => { location.hash = '#signer-return=xyz' })
  await settle(page, 600)
  check('a signer answer nobody waits for is dropped from the address', (await page.evaluate(() => location.hash)) === '' && (await topHeading(page)) === 'Turniere')
  check('no console errors (links)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// --- Setup and the game stay as they were -----------------------------------------------------
{
  const { ctx, page, errors } = await open({ browser })
  await page.getByRole('button', { name: /^X01/ }).click()
  await settle(page)
  check('setup hides the tab bar', !(await tabButton(page, 'Spielen').isVisible()))
  check('setup has one history entry', (await depth(page)) === 1)
  await page.goBack()
  await settle(page)
  check('browser back leaves setup to Spielen', await tabButton(page, 'Spielen').isVisible())

  await page.getByRole('button', { name: /^X01/ }).click()
  await settle(page)
  await page.getByRole('textbox', { name: 'Spieler 1' }).fill('Anna')
  await page.getByRole('textbox', { name: 'Spieler 2' }).fill('Ben')
  await page.getByRole('button', { name: 'Spiel starten', exact: true }).click()
  await settle(page, 1200)
  check('the game hides the tab bar', !(await tabButton(page, 'Spielen').isVisible()))
  check('the game has no history entry of its own', (await depth(page)) === 0)
  await page.getByRole('button', { name: '20', exact: true }).first().click()
  await settle(page, 300)
  const scrollable = await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 1)
  check('the game screen does not scroll', !scrollable)

  await page.evaluate(() => { location.hash = '#club=fromgame' })
  await settle(page, 900)
  check('a link during a game opens it', (await topHeading(page)) === 'Einladung')
  await tabButton(page, 'Spielen').click()
  await settle(page)
  const resume = page.getByRole('button', { name: 'Weiterspielen' })
  check('… and the game waits on Spielen', await resume.isVisible())
  await resume.click()
  await settle(page, 900)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dart-scorer.current-match.v1') ?? 'null'))
  check('… with every dart kept', saved?.status === 'playing' && saved?.throws?.length === 1, `throws ${saved?.throws?.length}`)
  check('no console errors (game)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// --- Opening an invitation by pasting ---------------------------------------------------------
{
  const { ctx, page, errors } = await open({ browser })
  await tabButton(page, 'Clubs').click()
  await page.getByRole('button', { name: 'Einladung öffnen' }).click()
  await settle(page, 800)
  check('Einladung öffnen pushes the scanner screen', (await topHeading(page)) === 'Einladung öffnen')
  const field = page.getByRole('textbox', { name: 'Link einfügen' })
  check('the paste field is always there', await field.isVisible())
  await field.fill('https://example.com/#club=x')
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click()
  check('a foreign link is refused in place', await page.getByRole('alert').filter({ hasText: 'kein BlueLine-Link' }).isVisible())
  await field.fill('https://blueline21.netlify.app/#tournament=t1')
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click()
  check('a tournament link is not taken as a club invitation', await page.getByRole('alert').filter({ hasText: 'keine Club-Einladung' }).isVisible())
  await field.fill(`${BASE}/#club=pasted`)
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click()
  await settle(page, 700)
  check('a club link replaces the scanner', (await topHeading(page)) === 'Einladung' && (await back(page, 'Clubs').isVisible()))
  check('no console errors (paste)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// --- Scanner states without a camera (simulated browser answers) -------------------------------
for (const [name, code, expected] of [
  ['denied', 'NotAllowedError', 'Kein Zugriff auf die Kamera'],
  ['no camera', 'NotFoundError', 'Keine Kamera gefunden'],
  ['busy camera', 'NotReadableError', 'Die Kamera ließ sich nicht starten'],
]) {
  const { ctx, page } = await open({
    browser,
    init: (c) => {
      // Headless Chromium answers "denied" for the camera permission; a real browser that never
      // asked starts at "prompt", where the scanner waits for "Code scannen".
      navigator.permissions.query = () => Promise.resolve({ state: 'prompt' })
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('simulated', c))
    },
    initArg: code,
  })
  await tabButton(page, 'Clubs').click()
  await page.getByRole('button', { name: 'Einladung öffnen' }).click()
  await settle(page, 800)
  await page.getByRole('button', { name: 'Code scannen' }).click()
  await settle(page, 500)
  check(`scanner state: ${name}`, await page.getByText(expected).isVisible())
  check(`scanner ${name}: paste field still offered`, await page.getByRole('textbox', { name: 'Link einfügen' }).isVisible())
  await ctx.close()
}

// --- Scanning a real QR code from a fake camera -------------------------------------------------
if (VIDEOS && existsSync(join(VIDEOS, 'club.y4m'))) {
  for (const decoder of ['BarcodeDetector', 'jsQR']) {
    for (const [video, expectOpen] of [['club.y4m', true], ['other.y4m', false]]) {
      const fake = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${join(VIDEOS, video)}`] })
      const { ctx, page, errors } = await open({
        browser: fake,
        permissions: ['camera'],
        init: decoder === 'jsQR' ? () => { delete window.BarcodeDetector } : undefined,
      })
      const native = await page.evaluate(() => 'BarcodeDetector' in window)
      await tabButton(page, 'Clubs').click()
      await page.getByRole('button', { name: 'Einladung öffnen' }).click()
      await settle(page, 600)
      // Allowed camera: scanning starts without a tap.
      let opened = false
      for (let i = 0; i < 30 && !opened; i++) {
        await settle(page, 300)
        opened = (await topHeading(page)) === 'Einladung'
      }
      if (expectOpen) check(`camera scan opens the invitation (${decoder}${decoder === 'BarcodeDetector' && !native ? ' unavailable, jsQR used' : ''})`, opened)
      else check(`camera scan refuses a foreign code (${decoder})`, !opened && (await page.getByRole('alert').filter({ hasText: 'kein BlueLine-Link' }).isVisible()))
      if (!expectOpen) {
        const cameraLive = () => page.evaluate(() => Array.from(document.querySelectorAll('video')).some((v) => v.srcObject && v.srcObject.getTracks().some((t) => t.readyState === 'live')))
        check(`camera is on while scanning (${decoder})`, await cameraLive())
        await tabButton(page, 'Profil').click()
        await settle(page, 600)
        check(`another tab turns the camera off (${decoder})`, !(await cameraLive()))
        await tabButton(page, 'Clubs').click()
        let again = false
        for (let i = 0; i < 10 && !again; i++) {
          await settle(page, 300)
          again = await cameraLive()
        }
        check(`coming back to the scanner turns it on again (${decoder})`, again)
        await back(page, 'Clubs').click()
        await settle(page, 600)
        const live = await page.evaluate(() => Array.from(document.querySelectorAll('video')).some((v) => v.srcObject && v.srcObject.getTracks().some((t) => t.readyState === 'live')))
        check(`leaving the scanner turns the camera off (${decoder})`, !live)
      }
      check(`no console errors (camera ${decoder} ${video})`, errors.length === 0, errors.join(' | '))
      await ctx.close()
      await fake.close()
    }
  }
} else {
  console.log('SKIP camera scan checks (no fake camera videos given)')
}

// --- Offline: Clubs, Tournaments, Profile, Settings and About are fetched while idle and work without a connection ---
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true, isMobile: true, serviceWorkers: 'allow' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // Second load under the service worker's control, then time for the idle prefetch (≤ 8 s).
  await page.reload()
  await page.waitForLoadState('networkidle')
  await settle(page, 9000)
  await ctx.setOffline(true)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await settle(page, 1500)
  await tabButton(page, 'Profil').click()
  await settle(page, 800)
  const profileOk = await page.getByRole('heading', { name: 'Gast' }).isVisible()
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await settle(page, 800)
  const settingsOk = (await topHeading(page)) === 'Einstellungen' && (await page.getByRole('heading', { name: 'Im Spiel' }).isVisible())
  await back(page, 'Profil').click()
  await settle(page, 600)
  await page.getByRole('button', { name: 'Über die App' }).click()
  await settle(page, 800)
  const aboutOk = (await topHeading(page)) === 'Über die App' && (await page.getByRole('heading', { name: 'BlueLine Darts' }).isVisible())
  check('offline after one visit: Profil, Einstellungen and Über die App open', profileOk && settingsOk && aboutOk, `profile ${profileOk}, settings ${settingsOk}, about ${aboutOk}`)
  await tabButton(page, 'Clubs').click()
  await settle(page, 800)
  const clubsOk = await page.getByRole('heading', { name: 'Noch kein Club' }).isVisible()
  await tabButton(page, 'Turniere').click()
  await settle(page, 800)
  const tournamentsOk = await page.getByRole('heading', { name: 'Noch kein Turnier' }).isVisible()
  check('offline after one visit: the Clubs and Turniere empty states open', clubsOk && tournamentsOk, `clubs ${clubsOk}, tournaments ${tournamentsOk}`)
  check('no page errors (offline)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// --- Headers, Reduce Motion, English -----------------------------------------------------------
{
  const response = await fetch(BASE + '/')
  check('Permissions-Policy allows the camera for this site only', (response.headers.get('permissions-policy') ?? '').includes('camera=(self)'), response.headers.get('permissions-policy'))

  const { ctx, page } = await open({ browser, reducedMotion: 'reduce' })
  await tabButton(page, 'Profil').click()
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.waitForTimeout(40)
  const transform = await page.locator('[data-tab-panel="profile"] > div').last().evaluate((el) => getComputedStyle(el).transform)
  check('Reduce Motion: pushes fade instead of sliding', transform === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(transform), transform)
  await ctx.close()

  const en = await open({ browser, locale: 'en-US' })
  const enTabs = await Promise.all(['Play', 'Leaderboard', 'Clubs', 'Tournaments', 'Profile'].map((n) => tabButton(en.page, n).isVisible()))
  check('English tab bar', enTabs.every(Boolean))
  await tabButton(en.page, 'Profile').click()
  await en.page.getByRole('button', { name: 'I already have a profile' }).click()
  await settle(en.page, 600)
  check('English sheet for an existing profile', await en.page.getByRole('dialog').getByText('From my other device').isVisible())
  await en.page.getByRole('dialog').getByRole('button', { name: /From my backup/ }).click()
  await settle(en.page, 700)
  check('sheet choice opens its screen in the Profile tab', (await topHeading(en.page)) === 'From my backup')
  await en.ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
if (failed.length) process.exitCode = 1
