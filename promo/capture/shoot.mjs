// The app footage: five takes of the real app, each a continuous recording on the virtual
// clock with real taps at fixed source times. The edit (timeline/edit.mjs) picks ranges from
// these takes the way an editor picks from camera footage.
// Usage: node capture/shoot.mjs [take ...]   (default: all takes)
import fs from "node:fs"
import path from "node:path"
import { Recorder } from "./recorder.mjs"
import { NAMES, ROUNDS, darts, config501, throwLog, savedMatch } from "../timeline/game.mjs"

const { S, T } = darts
const ROOT = new URL("../build/takes/", import.meta.url).pathname
const SCALE = Number(process.env.SCALE ?? 4)

// Players from an earlier evening, so setup offers their names as one-tap "recent players".
const HISTORY = [
  {
    id: "past-1", finishedAt: "2026-09-26T21:40:00.000Z", modeId: "501", modeName: "501", modeType: "x01",
    players: ["Leo", "Sam", "Jonas", "Lena", "Ben"].map((name, i) => ({ name, won: i === 3, darts: 48, points: 420 })),
  },
]
const BASE = { "dart-scorer.language.v1": "en", "dart-scorer.matches.v1": HISTORY }

// Keypad helpers: a dart is one tap, or Treble then the number.
const keys = (dart) => (dart.multiplier === 3 ? ["Treble", `T${dart.segment}`] : dart.segment === 25 ? ["Bull, 50"] : [`${dart.segment}`])

// Areas of the screen the edit frames with its virtual camera, recorded at given moments.
const AREAS = {
  scores: '[data-area="scores"]',
  entry: '[data-area="entry"]',
  tiles: '[data-area="scores"] ol',
  visit: '[data-area="scores"] > div:last-child',
}

async function areas(r, label, extra = {}) {
  const boxes = await r.page.evaluate(({ AREAS, extra }) => {
    const out = {}
    for (const [k, sel] of Object.entries({ ...AREAS, ...extra })) {
      const el = document.querySelector(sel)
      if (el) { const b = el.getBoundingClientRect(); out[k] = { x: b.x, y: b.y, w: b.width, h: b.height } }
    }
    const tiles = [...document.querySelectorAll('[data-area="scores"] ol > li')].map((li) => { const b = li.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })
    if (tiles.length) out.tileList = tiles
    return out
  }, { AREAS, extra })
  r.events.push({ type: "areas", label, t: r.time, boxes })
}

async function take(name, fn) {
  const outDir = path.join(ROOT, name)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const r = await new Recorder({ outDir, scale: SCALE }).launch()
  const t0 = Date.now()
  await fn(r)
  await r.close()
  console.log(`${name}: ${r.frameIndex} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

async function tapAt(r, t, label, opts) {
  await r.until(t)
  await r.tap(label, opts)
}

// Enters a visit's darts starting at time t, gap seconds between darts (Treble then number: 0.2 s).
async function visit(r, t, visitDarts, gap) {
  for (const dart of visitDarts) {
    const k = keys(dart)
    await tapAt(r, t, k[0], { label: k[0] })
    if (k[1]) await tapAt(r, t + 0.22, k[1], { label: k[1] })
    t += gap
  }
}

const takes = {
  // Home, setup with one to six players, the game starting, round 1 from Mia to Jonas.
  async onboarding(r) {
    await r.seed({ ...BASE, "dart-scorer.last-players.v1": ["Mia"] })
    await r.open("Around the Clock")
    await areas(r, "home", { board: 'section[aria-label="Practice board"]', tiles: 'section[aria-labelledby="new-game"]' })
    await tapAt(r, 1.6, "X01 301, 501, 701", { label: "X01" })
    await r.until(2.4)
    await areas(r, "setup-1", { players: 'section[aria-labelledby="players-heading"]', list: 'section[aria-labelledby="players-heading"] > div.overflow-hidden' })
    await tapAt(r, 3.2, "Leo")
    await r.until(3.8)
    await areas(r, "setup-2", { players: 'section[aria-labelledby="players-heading"]', list: 'section[aria-labelledby="players-heading"] > div.overflow-hidden' })
    let t = 4.0
    for (const n of ["Sam", "Jonas", "Lena", "Ben"]) { await tapAt(r, t, n); t += 0.4 }
    await r.until(6.0)
    await areas(r, "setup-6", { players: 'section[aria-labelledby="players-heading"]', list: 'section[aria-labelledby="players-heading"] > div.overflow-hidden', start: "div.fixed.inset-x-0.bottom-0" })
    await tapAt(r, 6.2, "Start game")
    await r.until(7.4)
    await areas(r, "game-start")
    // Mia: T20 20 T20, a dart every second, so the edit can cut to the board between them.
    await visit(r, 8.0, ROUNDS[0][0], 1.0)
    await r.until(10.9)
    await areas(r, "leo-up")
    await visit(r, 11.4, ROUNDS[0][1], 0.9) // Leo: 20 T20 5
    await visit(r, 14.4, ROUNDS[0][2], 0.7) // Sam: T19 19 3
    await visit(r, 16.8, ROUNDS[0][3], 0.45) // Jonas: 20 1 20
    await r.until(18.6)
    await areas(r, "lena-up")
  },

  // Round 4 from Lena (140, route T20 T20 D10) and Ben, then Mia's 170 and the result.
  async late(r) {
    const cfg = config501(NAMES)
    const log = throwLog(cfg, [...ROUNDS.slice(0, 3).flat(), ...ROUNDS[3].slice(0, 4)])
    await r.seed({ ...BASE, "dart-scorer.current-match.v1": savedMatch("m-late", cfg, log), "dart-scorer.last-players.v1": NAMES })
    await r.open("Lena to throw")
    await r.until(0.6)
    await areas(r, "lena-140")
    await visit(r, 1.5, ROUNDS[3][4], 1.1) // Lena: T20 T20 10, left on 10
    await r.until(4.2)
    await areas(r, "ben-up")
    await tapAt(r, 4.6, "Rest of the visit missed: 3 darts score 0", { label: "3× Miss" })
    await r.until(5.4)
    await areas(r, "mia-170")
    await visit(r, 7.0, [T(20)], 0)
    await r.until(8.0)
    await areas(r, "mia-110")
    await visit(r, 8.6, [T(20)], 0)
    await r.until(9.6)
    await areas(r, "mia-50")
    await tapAt(r, 10.4, "Bull, 50", { label: "Bull" })
    await r.until(11.6)
    await areas(r, "result", { table: "table", title: "#result-title" })
    await r.until(16.0)
  },

  // One player practising.
  async solo(r) {
    const cfg = config501(["Mia"])
    const log = throwLog(cfg, [[T(20), S(20), S(20)], [T(20), T(20), S(5)]])
    await r.seed({ ...BASE, "dart-scorer.current-match.v1": savedMatch("m-solo", cfg, log) })
    await r.open("Mia to throw")
    await r.until(0.6)
    await areas(r, "solo")
    await visit(r, 1.0, [T(20)], 0)
    await r.until(2.4)
  },

  // Two players, head to head.
  async duo(r) {
    const cfg = config501(["Mia", "Leo"])
    const log = throwLog(cfg, [[T(20), S(20), S(20)], [S(20), T(20), S(5)], [T(20), T(19), S(19)]])
    await r.seed({ ...BASE, "dart-scorer.current-match.v1": savedMatch("m-duo", cfg, log) })
    await r.open("Leo to throw")
    await r.until(0.6)
    await areas(r, "duo")
    await visit(r, 1.0, [T(20)], 0)
    await r.until(2.4)
  },

  // Six players, a round in.
  async six(r) {
    const cfg = config501(NAMES)
    const log = throwLog(cfg, [...ROUNDS[0], ...ROUNDS[1].slice(0, 2)])
    await r.seed({ ...BASE, "dart-scorer.current-match.v1": savedMatch("m-six", cfg, log) })
    await r.open("Sam to throw")
    await r.until(0.6)
    await areas(r, "six")
    await visit(r, 1.0, [T(19)], 0)
    await r.until(2.4)
  },
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(takes)
for (const name of wanted) await take(name, takes[name])
