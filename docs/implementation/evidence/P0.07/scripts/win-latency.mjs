// P0.07: the game-winning dart, with the other tabs open (and, with the app shell, kept mounted
// under the game). Finishing a game writes the result to the history, which the Rangliste and the
// guest profile listen to; this measures whether that slows the step from the last dart to the
// result screen.
//
//   node docs/implementation/evidence/P0.07/scripts/win-latency.mjs [base URL] [label] [runs]
//
// Same conditions as perf.mjs (390 × 844, DPR 3, touch, German, CPU 4× slower, no network
// shaping, 1,000 games in the history). Each run: open Rangliste, Clubs, Turniere and
// Profil › Einstellungen (the tabs a build has), go back to Spielen, resume a 301 game in which
// Anna needs the bull, and throw it with the keyboard ("b"). Reported: the Event Timing duration
// of that key press (input to next paint) and the time from the key press until the result
// dialog is in the page.
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3203'
const LABEL = process.argv[3] ?? ''
const RUNS = Number(process.argv[4] ?? 7)

const HISTORY = Array.from({ length: 1000 }, (_, i) => ({
  id: `perf-${i}`,
  finishedAt: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
  modeId: '501',
  modeName: '501',
  modeType: 'x01',
  players: [
    { name: ['Lena', 'Tom', 'Mia', 'Nils'][i % 4], won: true, darts: 18 + (i % 9), points: 501 },
    { name: ['Jo', 'Sara', 'Ben', 'Anna'][i % 4], won: false, darts: 18 + (i % 9), points: 300 + (i % 150) },
  ],
}))
const dart = (segment, multiplier = 1) => ({ kind: 'dart', dart: { segment, multiplier } })
const NEAR_WIN = {
  id: 'near-win', startedAt: '2026-10-05T18:00:00.000Z', acknowledgedLegs: 0, status: 'paused',
  config: { modeId: '301', modeName: '301', type: 'x01', startScore: 301, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: 'alternate', players: [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }] },
  throws: [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)],
}

const browser = await chromium.launch()
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)] }
const runs = []
for (let run = 0; run < RUNS; run++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE', serviceWorkers: 'block' })
  await ctx.addInitScript(([history, match]) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('dart-scorer.matches.v1', history)
    localStorage.setItem('dart-scorer.current-match.v1', match)
  }, [JSON.stringify(HISTORY), JSON.stringify(NEAR_WIN)])
  await ctx.addInitScript(() => {
    window.__events = []
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__events.push({ name: e.name, duration: e.duration, start: e.startTime }) }).observe({ type: 'event', durationThreshold: 16, buffered: true })
  })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const bar = page.getByRole('navigation', { name: 'Bereiche' })
  // Tabs a build doesn't have are skipped (the comparison builds before the app shell).
  for (const name of ['Rangliste', 'Clubs', 'Turniere', 'Profil', 'Einstellungen']) {
    const button = bar.getByRole('button', { name, exact: true })
    if (!(await button.count())) continue
    await button.tap()
    await page.waitForTimeout(900)
  }
  const settings = page.getByRole('main').getByRole('button', { name: 'Einstellungen', exact: true })
  if (await settings.count()) {
    await settings.first().tap()
    await page.waitForTimeout(1000)
  }
  await bar.getByRole('button', { name: 'Spielen', exact: true }).tap()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: /Weiterspielen/ }).first().tap()
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    window.__events = []
    window.__resultAt = null
    new MutationObserver((_, observer) => {
      if (document.querySelector('[role="dialog"][aria-labelledby="result-title"]')) {
        window.__resultAt = performance.now()
        observer.disconnect()
      }
    }).observe(document.body, { childList: true, subtree: true })
    window.addEventListener('keydown', () => { window.__keyAt = performance.now() }, { capture: true, once: true })
  })
  await page.keyboard.press('b')
  await page.waitForTimeout(2500)
  const r = await page.evaluate(() => ({
    key: Math.max(16, ...window.__events.filter((e) => e.name === 'keydown').map((e) => e.duration)),
    toResult: window.__resultAt && window.__keyAt ? window.__resultAt - window.__keyAt : null,
  }))
  runs.push(r)
  await ctx.close()
}
await browser.close()
const ms = (x) => `${Math.round(x)} ms`
console.log(`Winning dart with all tabs opened before, ${LABEL} (${BASE}), CPU 4× slower, ${RUNS} runs`)
console.log(`Key press to next paint: median ${ms(median(runs.map((r) => r.key)))}, max ${ms(Math.max(...runs.map((r) => r.key)))}`)
console.log(`Key press to result dialog in the page: median ${ms(median(runs.map((r) => r.toResult)))}, max ${ms(Math.max(...runs.map((r) => r.toResult)))}`)
console.log(JSON.stringify({ label: LABEL, runs }))
