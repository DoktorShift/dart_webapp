// P4 review round 2, re-verified in the production build in Chromium (Playwright) against two
// local in-memory relays that this script starts itself (nak serve). Several browser contexts
// play the devices. Taps are made at coordinates where a finger would tap (no programmatic
// scrolling), so a control that cannot be reached is found out. Nothing reaches a public relay.
// Lab values on a loaded development machine, not field measurements.
//
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20160,ws://127.0.0.1:20161 npm run build
//   npx next start -p 3315 &
//   node docs/implementation/evidence/P4/scripts/review-round-2.mjs
//
// Writes screenshots to ../screens (r2-*.jpg) and prints one PASS/FAIL line per check.
import { mkdirSync } from "node:fs"
import { spawn } from "node:child_process"
import { connect } from "node:net"
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3315"
const RELAY_PORTS = [20160, 20161]
const NAK = process.env.NAK_BIN ?? "/opt/homebrew/bin/nak"
const SHOTS = new URL("../screens/", import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- Relays ---------------------------------------------------------------------------------------

const relays = new Map()
async function startRelay(port) {
  const child = spawn(NAK, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: "ignore" })
  relays.set(port, child)
  for (let i = 0; i < 100; i++) {
    const open = await new Promise((resolve) => {
      const socket = connect(port, "127.0.0.1")
      socket.once("connect", () => (socket.destroy(), resolve(true)))
      socket.once("error", () => resolve(false))
    })
    if (open) return
    await sleep(50)
  }
  throw new Error(`relay on ${port} did not start`)
}
function stopRelay(port) {
  relays.get(port)?.kill("SIGTERM")
  relays.delete(port)
}

// ---- Devices --------------------------------------------------------------------------------------

const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
// Mia has 50 left with one dart in hand: the Bull wins it.
const nearWin = (id, legsToWin = 1) => ({
  id,
  startedAt: "2026-10-06T19:00:00.000Z",
  acknowledgedLegs: 0,
  status: "playing",
  config: { modeId: "301", modeName: "301", type: "x01", startScore: 301, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin, setsToWin: 1, startRule: "alternate", players: [{ id: "a", name: "Mia" }, { id: "b", name: "Jonas" }] },
  throws: [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)],
})

const PHONE = { width: 390, height: 844 }
const SE = { width: 320, height: 548 }
const SE_LANDSCAPE = { width: 548, height: 320 }
const SE_LANDSCAPE_FULL = { width: 568, height: 320 }

let browser
const contexts = []

async function device(viewport, { current = null, locale = "de-DE", colorScheme = "light", mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport, locale, colorScheme, hasTouch: mobile, isMobile: mobile, serviceWorkers: "block" })
  contexts.push(ctx)
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE })
  await ctx.addInitScript(([c, theme]) => {
    // about:blank (used between two visits) has no storage to seed.
    try {
      localStorage.setItem("theme", theme)
      if (sessionStorage.getItem("seeded")) return
      sessionStorage.setItem("seeded", "1")
      if (c) localStorage.setItem("dart-scorer.current-match.v1", c)
    } catch {}
  }, [current ? JSON.stringify(current) : null, colorScheme])
  const page = await ctx.newPage()
  const errors = []
  const sockets = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  page.on("websocket", (ws) => sockets.push(ws.url()))
  return { ctx, page, errors, sockets }
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}r2-${name}.jpg`, type: "jpeg", quality: 70 })
// Visible text only: the screens under the open one stay mounted and would otherwise match first.
const text = (page, t, opts = {}) =>
  page
    .getByText(t, opts)
    .locator("visible=true")
    .first()
    .waitFor({ timeout: opts.timeout ?? 20_000 })
const gone = (page, t, timeout = 10_000) =>
  page
    .getByText(t)
    .locator("visible=true")
    .first()
    .waitFor({ state: "hidden", timeout })
    .then(() => true, () => false)
const button = (page, name) => page.getByRole("button", { name, exact: true }).locator("visible=true").first()
const copied = async (page) => {
  await page.getByRole("button", { name: /Link kopieren|Copy link/ }).last().click()
  await page.waitForTimeout(300)
  return page.evaluate(() => navigator.clipboard.readText())
}
const options = async (page, entry) => {
  await page.getByRole("button", { name: /Spieloptionen|Game options/ }).click()
  await page.waitForTimeout(700)
  if (entry) await page.getByRole("button", { name: entry }).click()
}
// Opens a live sheet and copies its link; the sheet stays open (a handoff offer lives in it).
const openCode = async (page, entry) => {
  await options(page, entry)
  await text(page, /Link kopieren|Copy link/)
  await page.waitForTimeout(800)
  return copied(page)
}
const closeSheet = async (page) => {
  await button(page, /^(Fertig|Done)$/).click()
  await page.waitForTimeout(400)
}
// Whether the element is entirely inside the viewport, and above `floor` (a sheet's Done button
// sits below its scroll area and hides what has scrolled under it).
const inView = async (page, locator, floor = null) => {
  const box = await locator.boundingBox()
  const size = page.viewportSize()
  const bottom = floor ? ((await floor.boundingBox())?.y ?? size.height) : size.height
  return !!box && box.y >= 0 && box.x >= 0 && box.y + box.height <= bottom && box.x + box.width <= size.width
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
// A finger's tap: at the centre of the element as it lies now, without scrolling it into view.
const tap = async (page, locator) => {
  const box = await locator.boundingBox()
  if (!box) throw new Error("nothing to tap")
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}
const errorsOf = (...devices) => devices.flatMap((d) => d.errors)
const noErrors = (name, ...devices) => check(`no page errors: ${name}`, errorsOf(...devices).length === 0, errorsOf(...devices).slice(0, 2).join(" | "))

// A scenario that fails part-way is reported, with a picture of every device as it was, and the
// next one still runs. ONLY=result,menu runs the scenarios whose names contain one of the words.
const only = process.env.ONLY?.split(",").filter(Boolean)
async function scenario(name, run) {
  if (only && !only.some((word) => name.includes(word))) return
  const before = contexts.length
  try {
    await run()
  } catch (error) {
    check(`${name} ran to its end`, false, String(error).split("\n")[0])
    let i = 0
    for (const ctx of contexts.slice(before)) for (const page of ctx.pages()) await shot(page, `failed-${name.replace(/\W+/g, "-")}-${i++}`).catch(() => {})
  }
  for (const ctx of contexts.splice(before)) await ctx.close().catch(() => {})
}

// Seats two phones at the board's game and returns them.
async function seatBoth(board, url) {
  const mia = await device(PHONE)
  const jonas = await device(PHONE)
  for (const [phone, seat] of [
    [mia, "Mia"],
    [jonas, "Jonas"],
  ]) {
    await phone.page.goto(url)
    await text(phone.page, "Wähle deinen Platz")
    await button(phone.page, seat).click()
    await text(phone.page, `Du spielst als ${seat}`)
  }
  await board.page.getByText("Als Gast verbunden").nth(1).waitFor({ timeout: 20_000 })
  return { mia, jonas }
}
// Mia misses, Jonas scores 1, Mia takes the Bull: a plain win.
async function finishGame(board) {
  await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
  await board.page.waitForTimeout(300)
  await board.page.getByRole("button", { name: "1", exact: true }).first().click()
  await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
  await board.page.waitForTimeout(300)
  await board.page.getByRole("button", { name: "Bull, 50" }).first().click()
}

// ---- 1 The options menu: every entry under a finger on the smallest sizes -----------------------

const menu = (viewport, name) =>
  scenario(`menu ${name}`, async () => {
    const board = await device(viewport, { current: nearWin(`r2-menu-${name}`) })
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    await options(board.page)
    await shot(board.page, `menu-${name}-de-light`)
    check(`${name}: the menu's extra entries stand in their own card under "Mit anderen Geräten"`, (await board.page.getByText("Mit anderen Geräten").locator("visible=true").count()) === 1)
    // Scroll with the finger over the sheet's content (a wheel on the point does what a drag does).
    const target = button(board.page, "Auf anderem Gerät fortsetzen")
    const sheet = board.page.getByRole("dialog").last()
    const box = await sheet.boundingBox()
    await board.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await board.page.mouse.wheel(0, 600)
    await board.page.waitForTimeout(500)
    const reachable = await inView(board.page, target, button(board.page, /^(Fertig|Done)$/))
    await shot(board.page, `menu-${name}-scrolled-de-light`)
    check(`${name}: "Auf anderem Gerät fortsetzen" can be scrolled into reach, above Fertig`, reachable)
    await tap(board.page, target)
    const opened = await text(board.page, /Link kopieren|Copy link/, { timeout: 15_000 }).then(() => true, () => false)
    check(`${name}: a finger's tap on it opens the handoff sheet`, opened)
    await shot(board.page, `handoff-sheet-${name}-de-light`)
    noErrors(`menu ${name}`, board)
  })

// ---- 2 The three sheets on a phone in landscape and on an iPhone SE ------------------------------

const sheets = (viewport, name, locale, colorScheme) =>
  scenario(`sheets ${name} ${locale}`, async () => {
    const de = locale === "de-DE"
    const board = await device(viewport, { current: nearWin(`r2-sheets-${name}-${locale}`), locale, colorScheme })
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const entries = de ? ["Zuschauen lassen", "Spieler verbinden", "Auf anderem Gerät fortsetzen"] : ["Let others watch", "Connect players", "Continue on another device"]
    const copy = de ? "Link kopieren" : "Copy link"
    const done = de ? "Fertig" : "Done"
    const suffix = `${name}-${de ? "de" : "en"}-${colorScheme}`
    for (const [i, entry] of entries.entries()) {
      await options(board.page, entry)
      await text(board.page, copy)
      await board.page.waitForTimeout(800)
      await shot(board.page, `${["watch", "players", "handoff"][i]}-sheet-${suffix}`)
      const share = await inView(board.page, board.page.getByRole("button", { name: copy }).last(), button(board.page, done))
      check(`${entry} at ${suffix}: the share button is in view without scrolling`, share && (await noHorizontalScroll(board.page)))
      // On a phone in landscape the seats stand beside the code; in portrait they follow it (the
      // sheet scrolls there, as in round 1).
      if (i === 1 && viewport.height < 500) {
        const seat = board.page.getByRole("dialog").last().getByText("Mia", { exact: true }).locator("visible=true").first()
        check(`${entry} at ${suffix}: the first seat row is in view without scrolling`, await inView(board.page, seat, button(board.page, done)))
      }
      if (i === 0 && viewport === SE) {
        // The watch sheet's words all fit: nothing is cut mid-sentence by the scroll area's edge.
        const clipped = await board.page.evaluate(() => {
          const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1)
          const scroller = dialog?.querySelector(".overflow-y-auto")
          return scroller ? scroller.scrollHeight - scroller.clientHeight : -1
        })
        check(`${entry} at ${suffix}: the sheet shows all its words (nothing to scroll)`, clipped === 0, `${clipped} px hidden`)
      }
      await closeSheet(board.page)
    }
    noErrors(`sheets ${suffix}`, board)
  })

// ---- 3 Handoff: asked side by side, the taker's waiting states, leaving while asking -------------

const handoffStates = () =>
  scenario("handoff states", async () => {
    const board = await device(SE_LANDSCAPE_FULL, { current: nearWin("r2-handoff-states") })
    const taker = await device(PHONE)
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Auf anderem Gerät fortsetzen")
    await taker.page.goto(url)
    await text(taker.page, "Das Spiel wird auf diesem Gerät fortgesetzt.")
    await button(taker.page, "Übernehmen").click()
    await text(board.page, "Spiel übergeben?")
    await board.page.waitForTimeout(500)
    await shot(board.page, "handoff-asked-land568-de-light")
    const both = (await inView(board.page, button(board.page, "Übergeben"))) && (await inView(board.page, button(board.page, "Ablehnen")))
    check("at 568x320 'Übergeben' and 'Ablehnen' stand beside the check code, both in view", both)
    check("while asked, the sheet (dismissible) shows its grabber", (await board.page.locator('[role="dialog"] .h-2.w-\\[100px\\]').count()) === 1)

    // The taker shows that it is waiting, says so after 20 s, and can leave: the writer's offer is
    // open again under the same code.
    await text(taker.page, "Wartet auf das andere Gerät")
    check("the taker shows an activity indicator with its wait", (await taker.page.locator("svg.motion-safe\\:animate-spin").count()) >= 1)
    await shot(taker.page, "takeover-asking-phone-de-light")
    const t0 = Date.now()
    const hinted = await text(taker.page, "Noch keine Antwort.", { timeout: 30_000 }).then(() => true, () => false)
    check("after the wait the taker says the other device has not answered, with the next step", hinted, `lab: ${Math.round((Date.now() - t0) / 100) / 10} s`)
    check("the check code stays on the taker meanwhile", (await taker.page.getByText("Prüfcode").locator("visible=true").count()) === 1)
    await shot(taker.page, "takeover-unanswered-phone-de-light")
    await button(taker.page, "Abbrechen").click()
    const reopened = await text(board.page, "Link kopieren", { timeout: 10_000 }).then(() => true, () => false)
    check("'Abbrechen' on the taker brings the writer's sheet back to its code", reopened)
    await shot(board.page, "handoff-after-taker-left-land568-de-light")

    // Declined: an empty state with the one next step; asking again works.
    await taker.page.goto("about:blank")
    await taker.page.goto(await copied(board.page))
    await text(taker.page, "Das Spiel wird auf diesem Gerät fortgesetzt.")
    await button(taker.page, "Übernehmen").click()
    await text(board.page, "Spiel übergeben?")
    await button(board.page, "Ablehnen").click()
    await text(taker.page, "Übergabe abgelehnt")
    check("declined: the taker shows an empty state with 'Noch einmal anfragen'", (await button(taker.page, "Noch einmal anfragen").count()) === 1)
    await shot(taker.page, "takeover-declined-phone-de-light")
    await button(taker.page, "Noch einmal anfragen").click()
    const askedAgain = await text(board.page, "Spiel übergeben?", { timeout: 10_000 }).then(() => true, () => false)
    check("'Noch einmal anfragen' asks the writer again", askedAgain)

    // The taker goes away before the package comes: the writer's sheet is locked without a
    // grabber while it waits, then says the other device did not confirm.
    await taker.page.goto("about:blank")
    await taker.page.waitForTimeout(500)
    await button(board.page, "Übergeben").click()
    await text(board.page, "Wird übergeben")
    await board.page.waitForTimeout(300)
    check("while handing over, the locked sheet shows no grabber and no Fertig", (await board.page.locator('[role="dialog"] .h-2.w-\\[100px\\]').count()) === 0 && (await board.page.getByRole("button", { name: "Fertig", exact: true }).count()) === 0)
    await shot(board.page, "handoff-sending-locked-land568-de-light")
    const silent = await text(board.page, "Das andere Gerät hat die Übergabe nicht bestätigt.", { timeout: 40_000 }).then(() => true, () => false)
    check("without the other device's confirmation the game stays here, with 'Neuen Code zeigen'", silent && (await button(board.page, "Neuen Code zeigen").count()) === 1)
    noErrors("handoff states", board, taker)
  })

// ---- 4 Handoff done: the old device leaves the game at once; a link cannot bring it back --------

const handoffDone = () =>
  scenario("handoff done", async () => {
    const old = await device(PHONE, { current: nearWin("r2-handoff-done") })
    const taker = await device(PHONE)
    await old.page.goto(BASE)
    await text(old.page, "Mia")
    const watch = await openCode(old.page, "Zuschauen lassen")
    await closeSheet(old.page)
    const url = await openCode(old.page, "Auf anderem Gerät fortsetzen")
    await taker.page.goto(url)
    await text(taker.page, "Das Spiel wird auf diesem Gerät fortgesetzt.")
    await button(taker.page, "Übernehmen").click()
    await text(old.page, "Spiel übergeben?")
    await button(old.page, "Übergeben").click()
    await text(old.page, "Das Spiel läuft jetzt auf dem anderen Gerät weiter.", { timeout: 30_000 })
    await old.page.waitForTimeout(500)
    check("done: the old device is on the Play tab with the word that the game went on, no tap needed", (await old.page.getByRole("button", { name: "Spieloptionen" }).count()) === 0 && (await old.page.getByText("X01").locator("visible=true").count()) > 0)
    await shot(old.page, "play-tab-after-handoff-phone-de-light")
    await taker.page.getByRole("button", { name: "Spieloptionen" }).waitFor({ timeout: 20_000 })
    check("the game goes on on the other device", (await taker.page.getByText("Mia").count()) > 0)

    // A link arriving now (a scanned watch code) finds no game to pause and save.
    await old.page.evaluate((link) => {
      window.location.hash = new URL(link).hash
    }, watch)
    await old.page.waitForTimeout(1500)
    const kept = await old.page.evaluate(() => localStorage.getItem("dart-scorer.current-match.v1"))
    check("a link opened right after the handover does not save the game again", kept === null)
    await old.page.goto(BASE)
    await old.page.waitForTimeout(1500)
    check("after a reload the old device offers no game to continue", (await old.page.getByText("Weiterspielen").count()) === 0 && (await old.page.getByRole("button", { name: "Spieloptionen" }).count()) === 0)
    check("the word about the handover is gone with the reload (it was for the moment)", (await old.page.getByText("Das Spiel läuft jetzt auf dem anderen Gerät weiter.").count()) === 0)
    noErrors("handoff done", old, taker)
  })

// ---- 5 The result in landscape: one piece as a bar button, two pieces as a count and a sheet -----

// Registers a stand-in piece (as another area would) through the page's own registry: finds the
// registry module and React in the bundle. Only for this check.
const registerStandIn = (page) =>
  page.evaluate(async () => {
    const req = await new Promise((resolve) => self.webpackChunk_N_E.push([[`probe-${Date.now()}`], {}, (r) => resolve(r)]))
    const ids = Object.keys(req.m)
    const source = (id) => req.m[id].toString()
    const registryId = ids.find((id) => source(id).includes('"result.actions"') && source(id).includes('"setup.extras"') && source(id).includes('"profile.rows"'))
    // Several modules know React's element marker (react-dom among them): React is the one that exports createElement.
    const reactId = ids.filter((id) => source(id).includes("react.transitional.element")).find((id) => typeof req(id).createElement === "function")
    if (!registryId || !reactId) return `registry ${registryId ?? "missing"}, react ${reactId ?? "missing"}`
    const registry = req(registryId)
    const register = Object.values(registry).find((f) => typeof f === "function" && f.length === 3 && f.toString().includes(".set("))
    const React = req(reactId)
    if (!register || !React.createElement) return "registerSlotItem or createElement not found"
    register("result.actions", "standin", ({ placement }) =>
      React.createElement(
        "button",
        { type: "button", className: placement === "bar" ? "flex h-11 items-center px-2 text-[0.9375rem] text-primary" : "flex h-11 w-full items-center rounded-xl border border-border bg-card/70 px-3 text-[0.9375rem]" },
        "Deine Ergebnisse mitnehmen",
      ),
    )
    return "ok"
  })

const resultLandscape = (viewport, name) =>
  scenario(`result ${name}`, async () => {
    const board = await device(viewport, { current: nearWin(`r2-result-${name}`) })
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Spieler verbinden")
    const { mia, jonas } = await seatBoth(board, url)
    await closeSheet(board.page)
    await finishGame(board)
    await text(mia.page, "Ergebnis bestätigen", { timeout: 30_000 })
    await button(mia.page, "Ergebnis bestätigen").click()
    await text(jonas.page, "Ergebnis bestätigen", { timeout: 30_000 })
    await button(jonas.page, "Widersprechen").click()
    await jonas.page.getByRole("alertdialog").getByRole("button", { name: "Widersprechen" }).click()
    await text(board.page, "1/2 bestätigt · 1 Widerspruch", { timeout: 30_000 })
    await board.page.waitForTimeout(800)
    await shot(board.page, `result-one-piece-${name}-de-light`)
    const piece = board.page.getByRole("button", { name: /1\/2 bestätigt/ }).first()
    const geometry = await piece.evaluate((el) => {
      const label = el.querySelector("span")
      const lines = label ? Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight)) : 0
      return { height: el.getBoundingClientRect().height, lines, color: getComputedStyle(el).color }
    })
    const primary = await button(board.page, "Fertig").evaluate((el) => getComputedStyle(el).color)
    let visible = true
    for (const label of ["Teilen", "Statistik", "Aufnahmen", "Rangliste"]) visible = visible && (await inView(board.page, board.page.locator("button:visible", { hasText: label }).first()))
    check(`at ${name} one piece is a one-line bar button in the bar's blue, the result's actions all in view`, geometry.lines === 1 && geometry.height <= 44 && geometry.color === primary && visible && (await inView(board.page, piece)) && (await noHorizontalScroll(board.page)), JSON.stringify(geometry))

    // A second piece, as the profile track registers one: the bar shows a count instead.
    const registered = await registerStandIn(board.page)
    check(`at ${name} a stand-in piece could be registered through the bundle's registry`, registered === "ok", registered)
    const more = board.page.getByRole("button", { name: /Mehr zum Ergebnis, 2 Einträge/ })
    const counted = await more.waitFor({ timeout: 5000 }).then(() => true, () => false)
    await board.page.waitForTimeout(300)
    await shot(board.page, `result-two-pieces-${name}-de-light`)
    check(`at ${name} two pieces become one bar button with the count 2; neither piece shows inline`, counted && (await board.page.getByText("1/2 bestätigt").locator("visible=true").count()) === 0 && (await board.page.getByText("Deine Ergebnisse mitnehmen").locator("visible=true").count()) === 0 && (await noHorizontalScroll(board.page)))
    await more.click()
    await text(board.page, "Mehr zum Ergebnis")
    await board.page.waitForTimeout(600)
    await shot(board.page, `result-more-sheet-${name}-de-light`)
    const rows = (await board.page.getByText("1 von 2 bestätigt · 1 Widerspruch").locator("visible=true").count()) === 1 && (await board.page.getByText("Deine Ergebnisse mitnehmen").locator("visible=true").count()) === 1
    check(`at ${name} the sheet lists both pieces as their rows`, rows)
    await board.page.getByRole("button", { name: /1 von 2 bestätigt/ }).click()
    // The seats' sheet (in landscape without its group title): the first seat's connection shows.
    const players = await text(board.page, "Als Gast verbunden", { timeout: 10_000 }).then(() => true, () => false)
    const closed = await gone(board.page, "Mehr zum Ergebnis")
    check(`at ${name} tapping the live row closes the sheet and opens the seats`, players && closed)
    await shot(board.page, `result-players-from-sheet-${name}-de-light`)
    noErrors(`result ${name}`, board, mia, jonas)
  })

// ---- 6 Status symbols on the result, the guest result, the spectator in landscape --------------

const resultStatus = () =>
  scenario("result status", async () => {
    const board = await device(PHONE, { current: nearWin("r2-result-status") })
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Spieler verbinden")
    const { mia, jonas } = await seatBoth(board, url)
    await closeSheet(board.page)
    await finishGame(board)
    await text(board.page, "0 von 2 bestätigt", { timeout: 30_000 })
    const iconClass = () => board.page.getByRole("button", { name: /von 2 bestätigt/ }).first().locator("svg").first().getAttribute("class")
    check("'0 von 2 bestätigt' carries a neutral symbol, not the green check", /text-muted-foreground/.test(await iconClass()) && !/text-success/.test(await iconClass()))
    await shot(board.page, "result-no-verdicts-phone-de-light")
    await text(mia.page, "Ergebnis bestätigen", { timeout: 30_000 })
    await button(mia.page, "Ergebnis bestätigen").click()
    await text(board.page, "1 von 2 bestätigt", { timeout: 30_000 })
    check("'1 von 2 bestätigt' is still neutral", /text-muted-foreground/.test(await iconClass()))
    await text(jonas.page, "Ergebnis bestätigen", { timeout: 30_000 })
    await button(jonas.page, "Ergebnis bestätigen").click()
    await text(board.page, "2 von 2 bestätigt", { timeout: 30_000 })
    check("'2 von 2 bestätigt' shows the green check", /text-success/.test(await iconClass()))
    await shot(board.page, "result-all-confirmed-phone-de-light")
    noErrors("result status", board, mia, jonas)
  })

const guestResult = () =>
  scenario("guest result", async () => {
    const guest = await device(SE, { current: nearWin("r2-guest") })
    await guest.page.goto(BASE)
    await text(guest.page, "Mia")
    await guest.page.getByRole("button", { name: "Bull, 50" }).first().click()
    await text(guest.page, "Mia gewinnt")
    await guest.page.waitForTimeout(800)
    const wrapper = await guest.page.evaluate(() => {
      const el = document.querySelector("div.mb-2.grid.gap-2")
      return el ? { children: el.children.length, display: getComputedStyle(el).display } : null
    })
    check("a guest's result has no empty pieces wrapper taking room", wrapper === null || (wrapper.children === 0 && wrapper.display === "none"), JSON.stringify(wrapper))
    check("a guest's result opens no connection", guest.sockets.length === 0, `${guest.sockets.length} sockets`)
    await shot(guest.page, "guest-result-se-de-light")
    noErrors("guest result", guest)
  })

const spectatorLandscape = () =>
  scenario("spectator landscape", async () => {
    const board = await device(PHONE, { current: nearWin("r2-spectator") })
    const spectator = await device(SE_LANDSCAPE_FULL)
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Zuschauen lassen")
    await closeSheet(board.page)
    await spectator.page.goto(url)
    await text(spectator.page, "Stand von", { timeout: 20_000 })
    await spectator.page.waitForTimeout(800)
    await shot(spectator.page, "spectator-land568-de-light")
    // The screen's own scroll area (the nearest scrolling ancestor of the current-visit line) has
    // nothing hidden below its edge.
    // The screen's scroll area (components/nav/screen-frame.tsx) holds the sticky bar and then the
    // content's frame, which ends in a padding; what counts is content below the edge, and the
    // current-visit line being in view.
    const visitLine = spectator.page.getByText(/Mia wirft|Jonas wirft/).locator("visible=true").first().locator("xpath=ancestor::p[1]")
    const hidden = await visitLine.evaluate((el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue
        const frame = node.lastElementChild
        return node.scrollHeight - node.clientHeight - (frame ? parseFloat(getComputedStyle(frame).paddingBottom) : 0)
      }
      return document.documentElement.scrollHeight - window.innerHeight
    })
    const visit = await inView(spectator.page, visitLine)
    check("at 568x320 the spectator sees the board and the current visit without scrolling", hidden <= 1 && visit, `${Math.round(hidden)} px of content below the edge`)
    noErrors("spectator landscape", board, spectator)
  })

// ---- 7 The phone: a silent board shows activity, a confirmed seat is kept, a correction found ----

const phoneStates = () =>
  scenario("phone states", async () => {
    const board = await device(PHONE, { current: nearWin("r2-phone") })
    const mia = await device(SE, { locale: "en-US", colorScheme: "dark" })
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Spieler verbinden")
    // The board goes away: its code is answered by nobody.
    await board.page.goto("about:blank")
    await mia.page.goto(url)
    await text(mia.page, "Connecting to the board")
    check("while the board is asked, the phone shows activity with the words", (await mia.page.locator("svg.motion-safe\\:animate-spin").count()) >= 1)
    await shot(mia.page, "board-looking-se-en-dark")
    const t0 = Date.now()
    const silent = await text(mia.page, "The board isn't answering", { timeout: 20_000 }).then(() => true, () => false)
    check("a silent board is reported within about ten seconds", silent && Date.now() - t0 < 14_000, `lab: ${Math.round((Date.now() - t0) / 100) / 10} s`)

    // Back at a board: Mia confirms the result and the board frees her seat. The result she
    // confirmed is unchanged: the game stays in her games, the row says so.
    const board2 = await device(PHONE, { current: nearWin("r2-phone-2") })
    await board2.page.goto(BASE)
    await text(board2.page, "Mia")
    const url2 = await openCode(board2.page, "Spieler verbinden")
    await mia.page.goto(url2)
    await text(mia.page, "Pick your seat")
    await button(mia.page, "Mia").click()
    await text(mia.page, "You're playing as Mia")
    await board2.page.getByText("Als Gast verbunden").first().waitFor({ timeout: 20_000 })
    await closeSheet(board2.page)
    await finishGame(board2)
    await text(mia.page, "Confirm result", { timeout: 30_000 })
    await button(mia.page, "Confirm result").click()
    await text(mia.page, "Confirmed. The game is now in your games.", { timeout: 30_000 })
    await text(board2.page, "1 von 1 bestätigt", { timeout: 30_000 })
    // Records of one second are ordered by id: the seat goes a moment later, as it would in life.
    await board2.page.waitForTimeout(2000)
    await board2.page.getByRole("button", { name: /1 von 1 bestätigt/ }).click()
    await board2.page.getByRole("button", { name: "Mia trennen" }).click()
    await board2.page.getByRole("alertdialog").getByRole("button", { name: "Trennen" }).click()
    await board2.page.getByText("Nicht verbunden").first().waitFor({ timeout: 20_000 })
    await mia.page.waitForTimeout(2500)
    const archived = await mia.page.evaluate(() => {
      const raw = localStorage.getItem("dart-scorer.matches.v1")
      return raw ? JSON.parse(raw).some((m) => m.id === "r2-phone-2" || m.players?.some?.((p) => p.name === "Mia")) : false
    })
    check("after the board frees the seat, the game Mia confirmed stays among her games", archived)
    // The phone, still at the board's code, is sent back to the seats with the reason (as in
    // round 1); the result it confirmed is not withdrawn by that.
    const lostSeat = await text(mia.page, "The board disconnected you from your seat.", { timeout: 20_000 }).then(() => true, () => false)
    check("the phone says the board disconnected it, with the next step", lostSeat)
    await shot(mia.page, "seat-freed-after-confirm-se-en-dark")
    noErrors("phone states", board, mia, board2)
  })

const correctionFound = () =>
  scenario("correction found", async () => {
    const board = await device(PHONE, { current: nearWin("r2-correction") })
    const mia = await device(PHONE)
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Spieler verbinden")
    await mia.page.goto(url)
    await text(mia.page, "Wähle deinen Platz")
    await button(mia.page, "Mia").click()
    await text(mia.page, "Du spielst als Mia")
    await board.page.getByText("Als Gast verbunden").first().waitFor({ timeout: 20_000 })
    await closeSheet(board.page)
    await finishGame(board)
    await text(mia.page, "Ergebnis bestätigen", { timeout: 30_000 })
    await button(mia.page, "Ergebnis bestätigen").click()
    await text(mia.page, "Bestätigt. Das Spiel steht jetzt in deinen Spielen.", { timeout: 30_000 })
    await text(board.page, "1 von 1 bestätigt", { timeout: 30_000 })
    // The phone is put away on the Play tab; the board corrects the game meanwhile.
    await mia.page.goto(BASE)
    await text(mia.page, "Ergebnis bestätigt")
    await mia.page.goto("about:blank")
    // Undo the winning dart; two empty visits later Mia wins again: the same winner from other
    // throws is a corrected result, which the confirmation no longer fits.
    // The result's own Undo (the last one: the game screen's lies under the result).
    await board.page.getByRole("button", { name: "Letzten Dart rückgängig machen", exact: true }).locator("visible=true").last().click()
    await board.page.waitForTimeout(500)
    await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
    await board.page.waitForTimeout(300)
    await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
    await board.page.waitForTimeout(300)
    await board.page.getByRole("button", { name: "Bull, 50" }).first().click()
    await text(board.page, "0 von 1 bestätigt", { timeout: 30_000 })
    await board.page.waitForTimeout(1500)
    // Opened again, the Play tab looks at the match once and finds the correction.
    await mia.page.goto(BASE)
    const asked = await text(mia.page, "Ergebnis bestätigen", { timeout: 20_000 }).then(() => true, () => false)
    check("a confirmed seat's row finds a correction made while the app was away and asks again", asked)
    await shot(mia.page, "play-row-corrected-phone-de-light")
    noErrors("correction found", board, mia)
  })

try {
  for (const port of RELAY_PORTS) await startRelay(port)
  browser = await chromium.launch()
  await menu(SE, "se")
  await menu(SE_LANDSCAPE_FULL, "land568")
  await sheets(SE_LANDSCAPE_FULL, "land568", "de-DE", "light")
  await sheets(SE_LANDSCAPE, "land548", "en-US", "dark")
  await sheets(SE, "se", "de-DE", "light")
  await handoffStates()
  await handoffDone()
  await resultLandscape(SE_LANDSCAPE, "548x320")
  await resultLandscape(SE_LANDSCAPE_FULL, "568x320")
  await resultStatus()
  await guestResult()
  await spectatorLandscape()
  await phoneStates()
  await correctionFound()
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {})
  await browser?.close()
  for (const port of [...relays.keys()]) stopRelay(port)
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
