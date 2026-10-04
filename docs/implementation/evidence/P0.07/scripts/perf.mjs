// P0.07: lab measurement of the guest path on a production build, with fixed conditions so runs
// are comparable over time (docs/implementation/evidence/P0.07/DESIGN.md, "Messverfahren").
//
//   node docs/implementation/evidence/P0.07/scripts/perf.mjs [base URL] [label]
//
// Conditions: Chromium (Playwright), 390 × 844 at DPR 3, touch, German; CPU slowed 4× and the
// network shaped like Lighthouse's mobile preset (150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up);
// cache disabled and service worker blocked, so every load is a cold first visit.
//
// 1. Cold start, 5 runs: FCP, LCP, CLS, JS transferred. Reported as median and worst run.
// 2. Score input, 60 taps on the X01 keypad: Event Timing durations (input to the next paint
//    after the handlers ran), p50/p95/max. Taps under 16 ms are not reported by the browser and
//    count as 16 ms (an upper bound). Separately: tap to the local save of the running game
//    (the write of dart-scorer.current-match.v1), p50/p95/max. There is no sync yet to measure.
// 3. Navigation (if the tab bar has a Profile tab): tab switches and pushes, same measure.
//
// Data: cold starts are first visits (empty storage). Input and navigation run with 1,000 saved
// games in the history, the largest amount the plan's measurements use (DESIGN.md §5).
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3203'
const LABEL = process.argv[3] ?? ''
const CPU = 4
const NETWORK = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }

const browser = await chromium.launch()
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)] }
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] }

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

async function context({ throttleNetwork, seedHistory = false }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE', serviceWorkers: 'block' })
  if (seedHistory) {
    await ctx.addInitScript((history) => {
      if (!localStorage.getItem('dart-scorer.matches.v1')) localStorage.setItem('dart-scorer.matches.v1', history)
    }, JSON.stringify(HISTORY))
  }
  await ctx.addInitScript(() => {
    // Tap → local save of the running game: the time of each pointerdown and of each write.
    window.__taps = []
    window.__saves = []
    addEventListener('pointerdown', () => window.__taps.push(performance.now()), { capture: true })
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      const result = setItem.call(this, key, value)
      if (key === 'dart-scorer.current-match.v1') window.__saves.push(performance.now())
      return result
    }
    window.__events = []
    window.__lcp = 0
    window.__cls = 0
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__events.push({ name: e.name, duration: e.duration, id: e.interactionId }) }).observe({ type: 'event', durationThreshold: 16, buffered: true })
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true })
  })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  if (throttleNetwork) await cdp.send('Network.emulateNetworkConditions', NETWORK)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  const sizes = new Map()
  cdp.on('Network.responseReceived', (e) => { if (e.type === 'Script') sizes.set(e.requestId, 0) })
  cdp.on('Network.loadingFinished', (e) => { if (sizes.has(e.requestId)) sizes.set(e.requestId, e.encodedDataLength) })
  return { ctx, page, scriptBytes: () => [...sizes.values()].reduce((a, b) => a + b, 0) }
}

// Interaction durations for `count` interactions; unreported ones (< 16 ms) count as 16.
async function interactions(page, count) {
  const events = await page.evaluate(() => window.__events)
  const byId = new Map()
  for (const e of events) if (e.id) byId.set(e.id, Math.max(byId.get(e.id) ?? 0, e.duration))
  const measured = [...byId.values()]
  while (measured.length < count) measured.push(16)
  return measured
}

const cold = []
for (let run = 0; run < 5; run++) {
  const { ctx, page, scriptBytes } = await context({ throttleNetwork: true })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const paint = await page.evaluate(() => ({
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    lcp: window.__lcp,
    cls: window.__cls,
  }))
  cold.push({ ...paint, js: scriptBytes() })
  await ctx.close()
}

const { ctx, page } = await context({ throttleNetwork: false, seedHistory: true })
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /^X01/ }).tap()
await page.waitForTimeout(800)
await page.getByRole('textbox', { name: 'Spieler 1' }).fill('Anna')
await page.getByRole('textbox', { name: 'Spieler 2' }).fill('Ben')
await page.getByRole('button', { name: 'Spiel starten', exact: true }).tap()
await page.waitForTimeout(1500)
await page.evaluate(() => { window.__events = []; window.__taps = []; window.__saves = [] })
// Single 1s, 5s and 20s: never a checkout from 501, so the game keeps going for all 60 taps.
const keys = ['1', '5', '20']
for (let i = 0; i < 60; i++) {
  await page.getByRole('button', { name: keys[i % 3], exact: true }).first().tap()
  await page.waitForTimeout(250)
}
const input = await interactions(page, 60)
// For each tap, the first save after it (before the next tap).
const save = await page.evaluate(() => window.__taps.map((t, i) => {
  const next = window.__taps[i + 1] ?? Infinity
  const s = window.__saves.find((x) => x >= t && x < next)
  return s === undefined ? null : s - t
}).filter((x) => x !== null))

let navigation = null
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.removeItem('dart-scorer.current-match.v1'))
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
const profileTab = page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name: 'Profil', exact: true })
if (await profileTab.count()) {
  await page.waitForTimeout(3000)
  await page.evaluate(() => { window.__events = [] })
  let n = 0
  for (let round = 0; round < 5; round++) {
    for (const name of ['Rangliste', 'Clubs', 'Turniere', 'Profil', 'Spielen']) {
      await page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name, exact: true }).tap()
      await page.waitForTimeout(400)
      n++
    }
    await profileTab.tap()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).tap()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Zurück zu Profil' }).tap()
    await page.waitForTimeout(700)
    n += 3
  }
  navigation = await interactions(page, n)
}
await ctx.close()
await browser.close()

const ms = (x) => (x === null ? '–' : `${Math.round(x)} ms`)
console.log(`Guest path, ${LABEL} (${BASE}), CPU ${CPU}× slower`)
console.log(`Cold start (5 runs, 150 ms RTT, 1.6 Mbit/s): FCP median ${ms(median(cold.map((c) => c.fcp)))}, LCP median ${ms(median(cold.map((c) => c.lcp)))} (worst ${ms(Math.max(...cold.map((c) => c.lcp)))}), CLS max ${Math.max(...cold.map((c) => c.cls)).toFixed(3)}, JS transferred ${(median(cold.map((c) => c.js)) / 1024).toFixed(1)} kB`)
console.log(`Score input (60 taps): p50 ${ms(pct(input, 50))}, p95 ${ms(pct(input, 95))}, max ${ms(Math.max(...input))}`)
console.log(`Tap to local save (${save.length} of 60 taps saved): p50 ${ms(pct(save, 50))}, p95 ${ms(pct(save, 95))}, max ${ms(Math.max(...save))}`)
if (navigation) console.log(`Navigation (${navigation.length} taps: tabs, push, back): p50 ${ms(pct(navigation, 50))}, p95 ${ms(pct(navigation, 95))}, max ${ms(Math.max(...navigation))}`)
console.log(JSON.stringify({ label: LABEL, cold, input, save, navigation }))
