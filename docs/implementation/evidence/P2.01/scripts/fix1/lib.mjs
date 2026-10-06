// Shared helpers for the browser checks of review round 1 (profile track): a production build
// with NEXT_PUBLIC_BLUELINE_RELAYS = the first two of three local "nak serve" relays, served on
// BASE; the third relay stands for "a relay outside the app's defaults".
//   nak serve --port 18971 & nak serve --port 18972 & nak serve --port 18973 &
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:18971,ws://127.0.0.1:18972 npm run build && npx next start -p 3311
//   node docs/implementation/evidence/P2.01/scripts/fix1/v2-overwrite.mjs   (and v3 … v8; BASE, OUT, RELAY_PORTS optional)
import { chromium } from "playwright"
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"

export const BASE = process.env.BASE ?? "http://localhost:3311"
export const OUT = process.env.OUT ?? "/tmp/blueline-profile-fix1-shots"
mkdirSync(OUT, { recursive: true })
export const NAK = process.env.NAK ?? "/opt/homebrew/bin/nak"
const PORTS = (process.env.RELAY_PORTS ?? "18971,18972,18973").split(",")
export const RELAYS = PORTS.slice(0, 2).map((port) => `ws://127.0.0.1:${port}`)
export const OTHER = `ws://127.0.0.1:${PORTS[2]}`

export const nak = (args, opts = {}) => execFileSync(NAK, args, { stdio: ["pipe", "pipe", "ignore"], ...opts }).toString().trim()
export const req = (args, relays = RELAYS) => {
  try {
    return nak(["req", ...args, ...relays], { timeout: 8000 }).split("\n").filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

export const results = []
export const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}

export const browser = await chromium.launch()

export async function open({ seed = null, viewport = { width: 320, height: 548 }, lang = "de", dark = false, context = null } = {}) {
  const ctx =
    context ??
    (await browser.newContext({
      viewport,
      locale: lang === "de" ? "de-DE" : "en-US",
      hasTouch: true,
      isMobile: viewport.width < 900,
      serviceWorkers: "block",
      colorScheme: dark ? "dark" : "light",
    }))
  if (!context)
    await ctx.addInitScript(
      ({ c, theme }) => {
        localStorage.setItem("theme", theme)
        if (sessionStorage.getItem("seeded")) return
        sessionStorage.setItem("seeded", "1")
        if (c) localStorage.setItem("dart-scorer.current-match.v1", c)
      },
      { c: seed ? JSON.stringify(seed) : null, theme: dark ? "dark" : "light" },
    )
  const page = await ctx.newPage()
  const errors = []
  const sockets = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  page.on("websocket", (ws) => sockets.push(ws.url()))
  return { ctx, page, errors, sockets }
}

export const wait = (page, ms = 700) => page.waitForTimeout(ms)
export const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` })

export const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
export const game = (names, throws, status = "paused", startScore = 301) => ({
  id: `g-${Math.random().toString(36).slice(2)}`,
  startedAt: "2026-10-05T18:00:00.000Z",
  acknowledgedLegs: 0,
  status,
  config: { modeId: String(startScore), modeName: String(startScore), type: "x01", startScore, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: names.map((name, i) => ({ id: `s${i}`, name })) },
  throws,
})
// 301: Anna 180, Ben 3, Anna 60+11 -> leaves 50: bull finishes.
export const nearWin = (names = ["Anna", "Ben"]) => game(names, [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)])

export const tab = (page, name) => page.getByRole("navigation", { name: /^(Bereiche|Sections)$/ }).last().getByRole("button", { name, exact: true }).click()

export async function finishSeeded(page) {
  await page.goto(BASE)
  await page.getByRole("button", { name: /Weiterspielen|Continue/ }).first().click()
  await wait(page, 900)
  await page.keyboard.press("b")
  await wait(page, 1500)
}

export const idb = (page, store, key) =>
  page.evaluate(
    ({ store, key }) =>
      new Promise((resolve) => {
        const request = indexedDB.open("blueline")
        request.onsuccess = () => {
          const tx = request.result.transaction(store)
          const s = tx.objectStore(store)
          const get = key ? s.get(key) : s.getAll()
          get.onsuccess = () => resolve(JSON.parse(JSON.stringify(get.result ?? null)))
        }
      }),
    { store, key },
  )

export const scrollAll = (page, y = 5000) => page.evaluate((y) => [...document.querySelectorAll("[data-scroll-container]")].filter((el) => el.offsetParent).forEach((el) => el.scrollTo(0, y)), y)

export const layout = (page) =>
  page.evaluate(() => {
    const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed"
    const ellipsis = [...document.querySelectorAll("body *")].filter((el) => visible(el) && getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.slice(0, 40))
    const wide = document.scrollingElement.scrollWidth > innerWidth + 1
    const overflow = [...document.querySelectorAll("body *")]
      .filter((el) => visible(el))
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed"
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`)
    const small = [...document.querySelectorAll("button, a, [role=radio], [role=switch], input")]
      .filter((el) => visible(el))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5))
      .slice(0, 8)
      .map(({ el, r }) => `${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    return { ellipsis, wide, overflow, small }
  })

// A nak bunker for a key, on the given relay; resolves with its bunker:// link.
export async function startBunker(spawn, secret, relay, home) {
  const bunker = spawn(NAK, ["bunker", "--sec", secret, relay], { env: { ...process.env, HOME: home }, stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  const uri = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log)), 20000)
    const on = (c) => {
      log += c
      const m = /bunker:\s*(bunker:\/\/\S+)/.exec(log)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    }
    bunker.stdout.on("data", on)
    bunker.stderr.on("data", on)
  })
  return { bunker, uri }
}

export async function done() {
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
}
