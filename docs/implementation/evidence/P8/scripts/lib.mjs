// Shared helpers of the P8 browser runs (darts-night.mjs, hig-matrix.mjs): local relays, browser
// contexts as devices that can only reach the app and 127.0.0.1, screenshots at the device's size
// with a layout audit, a step table with lab timings. Patterns from the per-track scripts
// (P5 clubs-flows, P6.02 tournament-flows, P7b payments-review), gathered once.
//
// The app is a production build whose relays are the local ones:
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20350,ws://127.0.0.1:20351 npm run build
//   npx next start -p 3345
import { chromium } from "playwright"
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const BASE = process.env.BASE ?? "http://localhost:3345"
export const NAK = process.env.NAK_BIN ?? "/opt/homebrew/bin/nak"
export const PORTS = (process.env.RELAY_PORTS ?? "20350,20351").split(",").map(Number)
export const RELAYS = PORTS.map((port) => `ws://127.0.0.1:${port}`)
export const OUT = process.env.OUT ?? join(tmpdir(), "blueline-p8")
mkdirSync(OUT, { recursive: true })

export const PHONE = { width: 390, height: 844 }
export const SE = { width: 320, height: 548 }
export const SE_LANDSCAPE = { width: 568, height: 320 }
export const TABLET = { width: 768, height: 1024 }
export const BOARD = { width: 1024, height: 768 }

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- Relays: fresh in-memory "nak serve" on our own ports ------------------------------------
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1")
    socket.once("connect", () => (socket.destroy(), resolve(true)))
    socket.once("error", () => resolve(false))
  })

// Refuses to run on a port someone else holds: a left-over relay would carry an earlier run's data.
export async function startRelays(ports = PORTS) {
  for (const port of ports) if (await portOpen(port)) throw new Error(`port ${port} is taken: stop the old relay first`)
  const children = ports.map((port) => spawn(NAK, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: "ignore" }))
  for (let i = 0; i < 100; i++) {
    if ((await Promise.all(ports.map(portOpen))).every(Boolean)) break
    await sleep(100)
  }
  return {
    async stop() {
      for (const child of children) child.kill("SIGTERM")
      for (let i = 0; i < 50 && (await Promise.all(ports.map(portOpen))).some(Boolean); i++) await sleep(100)
    },
  }
}

export const nakReq = (args, relays = RELAYS) => {
  try {
    return execFileSync(NAK, ["req", ...args, ...relays], { stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

// --- Devices -----------------------------------------------------------------------------------
export const browser = await chromium.launch()
export const devices = []

// A device: its own browser context (fresh storage), German or English, light or dark. Requests
// to anything but the app and 127.0.0.1 are refused and counted (the exchange rate is answered
// with a fixed value, as in the P7b scripts); WebSockets are counted per host.
export async function device(label, { viewport = PHONE, locale = "de", dark = false, mobile = viewport.width < 1100, storageState } = {}) {
  const ctx = await browser.newContext({
    viewport,
    locale: locale === "de" ? "de-DE" : "en-GB",
    colorScheme: dark ? "dark" : "light",
    hasTouch: mobile,
    isMobile: mobile,
    serviceWorkers: "block",
    acceptDownloads: true,
    storageState,
  })
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE })
  await ctx.addInitScript((theme) => localStorage.setItem("theme", theme), dark ? "dark" : "light")
  const made = { label, ctx, viewport, errors: [], sockets: [], foreign: [] }
  await ctx.route(/^https?:\/\//, (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE) || url.startsWith("http://127.0.0.1")) return route.continue()
    if (url.includes("api.coingecko.com")) return route.fulfill({ json: { bitcoin: { eur: 61_500, usd: 67_000, gbp: 53_000, chf: 55_000 } }, headers: { "access-control-allow-origin": "*" } })
    made.foreign.push(url)
    return route.abort()
  })
  made.page = await ctx.newPage()
  made.page.on("pageerror", (e) => made.errors.push(String(e)))
  made.page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_CONNECTION_REFUSED|Failed to load resource|net::ERR_FAILED/.test(m.text()) && made.errors.push(m.text()))
  made.page.on("websocket", (ws) => made.sockets.push(ws.url()))
  devices.push(made)
  return made
}

// Every socket a device opened went to a local relay.
export const onlyLocal = (d) => d.sockets.every((url) => url.startsWith("ws://127.0.0.1:")) && d.foreign.length === 0

// --- Reading and tapping -----------------------------------------------------------------------
// Covered screens of the navigation stack stay in the page, off to the side or inert: only what is
// on screen counts. Resolves with the first match on screen, waiting up to `timeout`.
export async function onScreen(locator, timeout = 20_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    for (const candidate of await locator.all()) {
      const ok = await candidate
        .evaluate((el) => {
          if (el.closest('[inert], [aria-hidden="true"], [hidden]')) return false
          const s = getComputedStyle(el)
          if (s.visibility === "hidden" || s.display === "none") return false
          const r = el.getBoundingClientRect()
          // Below the fold counts (a tap scrolls it into view); off to the side does not.
          return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1
        })
        .catch(() => false)
      if (ok) return candidate
    }
    if (Date.now() > deadline) throw new Error(`not on screen within ${timeout} ms: ${locator}`)
    await sleep(200)
  }
}
export const seen = (page, text, opts = {}) => onScreen(page.getByText(text, { exact: opts.exact }), opts.timeout)
export const isOnScreen = (locator) => onScreen(locator, 0).then(() => true, () => false)
export const visibleCount = async (page, text, opts = {}) => ((await isOnScreen(page.getByText(text, opts))) ? 1 : 0)
// A string names the button exactly, or the start of a row's name (a row reads title and
// subtitle: "Sicherungsdatei erstellen Eine Datei und ein Kennwort …").
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
export const buttons = (page, name) =>
  typeof name === "string" ? page.getByRole("button", { name, exact: true }).or(page.getByRole("button", { name: new RegExp(`^${escape(name)}\\s`) })) : page.getByRole("button", { name })
export const button = (page, name, timeout) => onScreen(buttons(page, name), timeout)
export const tap = async (page, name, timeout) => (await button(page, name, timeout)).click()
// The tab bar (phones) or the sidebar (wide screens): whichever is visible.
export const tab = (page, name) => page.locator('nav[aria-label="Bereiche"]:visible, nav[aria-label="Sections"]:visible').first().getByRole("button", { name, exact: true }).click()
export const copiedLink = async (page, name = "Link kopieren") => {
  await tap(page, name)
  await page.waitForTimeout(300)
  return page.evaluate(() => navigator.clipboard.readText())
}
// Links name the published site; the devices open them on the local build.
export const local = (url) => url.replace(/^https?:\/\/[^/]+/, BASE)

// A dart on the keypad: Double or Triple first, then the key ("T20", "D14", "20", "Bull, 50").
export async function dart(page, segment, multiplier = 1) {
  if (multiplier === 3) await page.getByRole("button", { name: /^(Triple|Treble)$/ }).first().click()
  if (multiplier === 2) await page.getByRole("button", { name: "Double", exact: true }).first().click()
  const prefix = multiplier === 3 ? "T" : multiplier === 2 ? "D" : ""
  await page.getByRole("button", { name: new RegExp(`^${prefix}\\s?${segment}$`) }).locator("visible=true").first().click()
  await page.waitForTimeout(200)
}
// 301 in two visits for the first seat: T20 T20 T20, the second seat misses (1 1 1), then
// T20 T11 D14 (a 121 checkout).
export async function firstSeatWins301(page) {
  for (const [s, m] of [[20, 3], [20, 3], [20, 3], [1], [1], [1], [20, 3], [11, 3], [14, 2]]) await dart(page, s, m)
}

// --- Screens -----------------------------------------------------------------------------------
// The layout audit of the per-track scripts: text cut with an ellipsis or clipped, anything
// beyond the viewport's width, touch targets under 44 pt (the sheet's grab handle excepted).
export const audit = (page) =>
  page.evaluate(() => {
    const vw = innerWidth
    const vh = innerHeight
    const shown = (el) => {
      if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false
      const s = getComputedStyle(el)
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
    }
    const all = [...document.querySelectorAll("body *")].filter(shown)
    const describe = (el) => `${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 32)}`
    const hidesOverflow = (el) => ["hidden", "clip"].includes(getComputedStyle(el).overflowX)
    return {
      hscroll: document.scrollingElement.scrollWidth > vw + 1 || [...document.querySelectorAll("[data-scroll-container]")].some((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1),
      ellipsis: all.filter((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1).map(describe).slice(0, 5),
      dots: all.filter((el) => el.children.length === 0 && /…|\.\.\.$/.test(el.textContent ?? "")).map(describe).slice(0, 5),
      clipped: all
        .filter((el) => hidesOverflow(el) && el.clientWidth > 1 && el.clientWidth < vw - 1 && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim() !== "")
        .map((el) => `${describe(el)} ${el.scrollWidth}>${el.clientWidth}`)
        .slice(0, 5),
      small: all
        .filter((el) => el.matches("button, a[href], [role=radio], [role=switch], summary, input:not([type=file])") && !el.closest("[data-vaul-handle]"))
        .map((el) => (el.matches("[role=switch]") && el.closest("label") ? el.closest("label") : el))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 })
        .map((el) => { const r = el.getBoundingClientRect(); return `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}` })
        .slice(0, 8),
    }
  })
export const auditProblems = (a) => [a.hscroll && "horizontal scroll", a.ellipsis.length && `ellipsis: ${a.ellipsis.join(", ")}`, a.dots.length && `"…": ${a.dots.join(", ")}`, a.clipped.length && `clipped: ${a.clipped.join(", ")}`, a.small.length && `small: ${a.small.join(", ")}`].filter(Boolean)

export const audits = []
// A JPEG (quality 70) at the device's size, with its audit kept for the report.
export async function shot(d, name) {
  await d.page.waitForTimeout(350)
  const file = `${name}.jpg`
  await d.page.screenshot({ path: join(OUT, file), type: "jpeg", quality: 70 })
  const a = await audit(d.page).catch(() => null)
  if (a) audits.push({ file, device: d.label, size: `${d.page.viewportSize().width}x${d.page.viewportSize().height}`, problems: auditProblems(a) })
  return file
}

// --- Steps with timings ------------------------------------------------------------------------
export const steps = []
export const notes = []
let failed = false
// Runs one step of a continuous flow: its checks are what a player sees. A failed step stops the
// flow (what follows builds on it); every device's screen is kept for the diagnosis.
export async function step(name, fn) {
  if (failed) {
    steps.push({ name, ok: null, ms: 0, checks: [], note: "not run" })
    return
  }
  const checks = []
  const expect = (what, ok, detail = "") => {
    checks.push({ what, ok: !!ok, detail })
    console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${detail ? ` (${detail})` : ""}`)
  }
  // An observation that is a finding about the app, not a failure of the flow: it is reported
  // (NOTE) without stopping the evening.
  expect.note = (what, ok, detail = "") => {
    if (!ok) notes.push({ step: name, what, detail })
    console.log(`  ${ok ? "PASS" : "NOTE"} ${what}${detail ? ` (${detail})` : ""}`)
  }
  console.log(`\n# ${name}`)
  const t0 = Date.now()
  try {
    await fn(expect)
    steps.push({ name, ok: checks.every((c) => c.ok), ms: Date.now() - t0, checks })
  } catch (error) {
    failed = true
    const note = String(error?.message ?? error).split("\n")[0].slice(0, 200)
    console.log(`  FAIL ${note}`)
    for (const d of devices) await d.page.screenshot({ path: join(OUT, `fail-${d.label}.jpg`), type: "jpeg", quality: 60 }).catch(() => {})
    steps.push({ name, ok: false, ms: Date.now() - t0, checks, note })
  }
}

export function table() {
  const rows = steps.map((s, i) => {
    const passed = s.checks.filter((c) => c.ok).length
    const state = s.ok === null ? "skip" : s.ok ? "pass" : "FAIL"
    const remarks = notes.filter((n) => n.step === s.name).length
    return `| ${i + 1} | ${s.name}${s.note ? ` (${s.note})` : ""} | ${state} | ${passed}/${s.checks.length} | ${remarks} | ${(s.ms / 1000).toFixed(1)} s |`
  })
  const total = steps.reduce((sum, s) => sum + s.ms, 0)
  return ["| # | Step | Result | Checks | Notes | Time (lab) |", "| --- | --- | --- | --- | --- | --- |", ...rows, `| | Whole evening | ${allPassed() ? "pass" : "FAIL"} | ${steps.reduce((n, s) => n + s.checks.filter((c) => c.ok).length, 0)}/${steps.reduce((n, s) => n + s.checks.length, 0)} | ${notes.length} | ${(total / 1000).toFixed(1)} s |`].join("\n")
}

export const allPassed = () => steps.length > 0 && steps.every((s) => s.ok === true)

export async function closeAll() {
  for (const d of devices) await d.ctx.close().catch(() => {})
  await browser.close().catch(() => {})
}
