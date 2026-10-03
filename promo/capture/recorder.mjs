// Records the real app frame by frame on a virtual clock, so every animation (framer-motion,
// CSS transitions, timers) lands on exact frame times and the footage plays back at 1:1 speed.
import { chromium } from "playwright"
import fs from "node:fs"
import path from "node:path"

export const APP_URL = process.env.APP_URL ?? "http://localhost:3123"

// Runs in the page before the app. One virtual clock drives everything time-based: timers,
// Date, performance.now and animation frames (60 per second), and CSS transitions and Web
// Animations are paused on creation and seeked to the same clock. The app then renders
// exactly the same frames on every run, at 1:1 speed, however long a screenshot takes.
const CLOCK_SCRIPT = `
(() => {
  let now = 0
  const EPOCH = Date.parse("2026-10-03T19:30:00Z")
  const timers = new Map()
  let nextTimer = 1
  const rafs = new Map()
  let nextRaf = 1
  window.setTimeout = (fn, delay = 0, ...args) => {
    const id = nextTimer++
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), fn, args, every: 0, seq: id })
    return id
  }
  window.setInterval = (fn, delay = 0, ...args) => {
    const id = nextTimer++
    const every = Math.max(1, Number(delay) || 0)
    timers.set(id, { at: now + every, fn, args, every, seq: id })
    return id
  }
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id) }
  window.requestAnimationFrame = (fn) => { const id = nextRaf++; rafs.set(id, fn); return id }
  window.cancelAnimationFrame = (id) => { rafs.delete(id) }
  window.requestIdleCallback = (fn) => window.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 8 }), 1)
  window.cancelIdleCallback = (id) => window.clearTimeout(id)
  performance.now = () => now
  const RealDate = Date
  class VirtualDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(EPOCH + now); else super(...args) }
    static now() { return EPOCH + now }
  }
  window.Date = VirtualDate

  const runTimersUntil = (target) => {
    for (;;) {
      let pick = null
      for (const [id, t] of timers) if (t.at <= target && (!pick || t.at < pick.t.at || (t.at === pick.t.at && t.seq < pick.t.seq))) pick = { id, t }
      if (!pick) break
      now = Math.max(now, pick.t.at)
      if (pick.t.every) pick.t.at += pick.t.every
      else timers.delete(pick.id)
      try { pick.t.fn(...pick.t.args) } catch (e) { console.error(e) }
    }
    now = target
  }
  const runFrame = () => {
    const callbacks = [...rafs.values()]
    rafs.clear()
    for (const cb of callbacks) { try { cb(now) } catch (e) { console.error(e) } }
  }
  // Moves the clock on by ms, firing timers on the way and an animation frame at the end.
  window.__tick = (ms) => { runTimersUntil(now + ms); runFrame() }
  window.__now = () => now

  // Web Animations started by script (framer-motion) count from the virtual moment they were
  // created; CSS transitions from the frame they first appear in.
  const starts = new WeakMap()
  const realAnimate = Element.prototype.animate
  Element.prototype.animate = function (...args) {
    const a = realAnimate.apply(this, args)
    starts.set(a, now)
    try { a.pause(); a.currentTime = 0 } catch {}
    return a
  }
  window.__seek = () => {
    for (const a of document.getAnimations()) {
      let s = starts.get(a)
      if (s === undefined) {
        s = now
        starts.set(a, s)
        try { a.pause() } catch {}
      }
      let end = Infinity
      try { end = a.effect.getComputedTiming().endTime } catch {}
      const local = (now - s) * (a.playbackRate || 1)
      if (Number.isFinite(end) && local >= end) { try { a.finish() } catch {} }
      else { try { a.currentTime = local } catch {} }
    }
  }
})()
`

export class Recorder {
  constructor({ outDir, fps = 30, width = 393, height = 852, scale = 4, quality = 92 }) {
    Object.assign(this, { outDir, fps, width, height, scale, quality })
    this.frameIndex = 0
    this.vt = 0 // virtual ms since the segment started
    this.events = []
  }

  async launch() {
    this.browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--hide-scrollbars"] })
    this.context = await this.browser.newContext({
      viewport: { width: this.width, height: this.height },
      deviceScaleFactor: this.scale,
      isMobile: true,
      hasTouch: true,
      locale: "en-GB",
      colorScheme: "dark",
      reducedMotion: "no-preference",
      serviceWorkers: "block",
    })
    this.page = await this.context.newPage()
    this.cdp = await this.context.newCDPSession(this.page)
    await this.page.addInitScript(CLOCK_SCRIPT)
    return this
  }

  // Writes saved data on a page that doesn't run the app, so nothing overwrites it.
  async seed(entries) {
    await this.page.goto(`${APP_URL}/robots.txt`)
    await this.page.evaluate((entries) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v))
    }, entries)
  }

  // Opens the app with the clock stopped, then waits until it has hydrated in English.
  async open(readyText, path = "/") {
    await this.page.goto(`${APP_URL}${path}`, { waitUntil: "load" })
    await this.page.getByText(readyText, { exact: false }).first().waitFor({ state: "visible", timeout: 20000 })
    await this.page.evaluate(() => document.fonts.ready)
    await this.settle()
    await this.page.evaluate(() => window.__seek())
  }

  // Lets React and the scheduler (MessageChannel, real time) finish their work.
  async settle() {
    await this.page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0
          const ch = new MessageChannel()
          ch.port1.onmessage = () => (++n < 3 ? ch.port2.postMessage(0) : resolve())
          ch.port2.postMessage(0)
        }),
    )
  }

  // One output frame: animation frames at 60 Hz, React flushed after each, then CSS animations seeked.
  async step() {
    const ticks = Math.max(1, Math.round(60 / this.fps))
    const dt = 1000 / this.fps / ticks
    for (let i = 0; i < ticks; i++) {
      await this.page.evaluate((dt) => window.__tick(dt), dt)
      await this.settle()
    }
    this.vt += 1000 / this.fps
    await this.page.evaluate(() => window.__seek())
    // Finished animations resolve their promises now (an exiting screen is removed on time).
    await this.settle()
  }

  async shoot() {
    const file = path.join(this.outDir, `${String(this.frameIndex).padStart(5, "0")}.jpg`)
    // The clip's scale renders at the device pixel ratio (without it Chrome returns CSS pixels).
    const clip = { x: 0, y: 0, width: this.width, height: this.height, scale: this.scale }
    const { data } = await this.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: this.quality, clip })
    fs.writeFileSync(file, Buffer.from(data, "base64"))
    this.frameIndex++
  }

  get time() {
    return this.frameIndex / this.fps
  }

  // Records frames until the segment clock reaches t (seconds).
  async until(t) {
    while (this.frameIndex / this.fps < t - 1e-6) {
      await this.shoot()
      await this.step()
    }
  }

  async box(target) {
    const loc = typeof target === "string" ? this.page.getByRole("button", { name: target, exact: true }).first() : target
    const b = await loc.boundingBox()
    if (!b) throw new Error(`No box for ${target}`)
    return b
  }

  // A finger tap: touch down (the key shows its pressed state), held for a few frames, then up.
  async tap(target, { hold = 0.1, label } = {}) {
    const b = await this.box(target)
    const x = b.x + b.width / 2
    const y = b.y + b.height / 2
    const down = this.time
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1 }] })
    await this.settle()
    await this.page.evaluate(() => window.__seek())
    await this.until(down + hold)
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await this.settle()
    await this.page.evaluate(() => window.__seek())
    this.events.push({ type: "tap", label: label ?? (typeof target === "string" ? target : "target"), t: down, up: this.time, x, y })
  }

  async close() {
    fs.writeFileSync(path.join(this.outDir, "events.json"), JSON.stringify({ fps: this.fps, width: this.width, height: this.height, scale: this.scale, frames: this.frameIndex, events: this.events }, null, 2))
    await this.browser.close()
  }
}
