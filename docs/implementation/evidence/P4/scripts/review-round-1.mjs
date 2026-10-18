// P4 review round 1, re-verified in the production build in Chromium (Playwright) against two
// local in-memory relays that this script starts itself (nak serve), so one of them can be
// stopped and started again. Several browser contexts play the devices. Nothing reaches a
// public relay. Lab values on a loaded development machine, not field measurements.
//
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20160,ws://127.0.0.1:20161 npm run build
//   npx next start -p 3315 &
//   node docs/implementation/evidence/P4/scripts/review-round-1.mjs
//
// Writes screenshots to ../screens (r1-*.jpg) and prints one PASS/FAIL line per check.
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

const shot = (page, name) => page.screenshot({ path: `${SHOTS}r1-${name}.jpg`, type: "jpeg", quality: 70 })
// Visible text only: the screens under the open one stay mounted, the Play tab's row for a seat
// among them, and would otherwise be matched first.
const text = (page, t, opts = {}) =>
  page
    .getByText(t, opts)
    .locator("visible=true")
    .first()
    .waitFor({ timeout: opts.timeout ?? 20_000 })
const button = (page, name) => page.getByRole("button", { name, exact: true }).first()
const copied = async (page) => {
  await page.getByRole("button", { name: "Link kopieren" }).last().click()
  await page.waitForTimeout(300)
  return page.evaluate(() => navigator.clipboard.readText())
}
const options = async (page, entry) => {
  await page.getByRole("button", { name: "Spieloptionen" }).click()
  await page.waitForTimeout(700)
  if (entry) await page.getByRole("button", { name: entry }).click()
}
// Opens a live sheet and copies its link; the sheet stays open (a handoff offer lives in it).
const openCode = async (page, entry, shotName) => {
  await options(page, entry)
  await text(page, "Link kopieren")
  await page.waitForTimeout(800)
  if (shotName) await shot(page, shotName)
  return copied(page)
}
const closeSheet = async (page) => {
  await button(page, "Fertig").click()
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
const errorsOf = (...devices) => devices.flatMap((d) => d.errors)

// A scenario that fails part-way is reported, with a picture of every device as it was, and the
// next one still runs.
async function scenario(name, run) {
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

// ---- 1 Handoff: closing the sheet before and after "Übergeben" ---------------------------------

const handoff = () =>
  scenario("handoff", async () => {
    const old = await device(PHONE, { current: nearWin("r1-handoff") })
    const taker = await device(PHONE)
    await old.page.goto(BASE)
    await text(old.page, "Mia")
    const url = await openCode(old.page, "Auf anderem Gerät fortsetzen")
    await taker.page.goto(url)
    await text(taker.page, "Das Spiel wird auf diesem Gerät fortgesetzt.")
    await button(taker.page, "Übernehmen").click()
    await text(old.page, "Spiel übergeben?")
    // Dismissed while asked: the other device hears that the game stays.
    await old.page.keyboard.press("Escape")
    await text(taker.page, "Das andere Gerät hat die Übergabe abgelehnt.")
    const gone = await old.page.getByText("Spiel übergeben?").first().waitFor({ state: "hidden", timeout: 5000 }).then(() => true, () => false)
    check("a sheet closed while asked tells the other device the game stays here", gone)
    await shot(taker.page, "takeover-declined-de-light-iphone")

    // Again, and this time Escape right after "Übergeben": the sheet stays until it is done.
    const url2 = await openCode(old.page, "Auf anderem Gerät fortsetzen")
    await taker.page.goto("about:blank")
    await taker.page.goto(url2)
    await text(taker.page, "Das Spiel wird auf diesem Gerät fortgesetzt.")
    await button(taker.page, "Übernehmen").click()
    await text(old.page, "Spiel übergeben?")
    await button(old.page, "Übergeben").click()
    await old.page.keyboard.press("Escape")
    await old.page.waitForTimeout(500)
    const stillOpen = (await old.page.getByText(/Wird übergeben|Das Spiel läuft jetzt auf dem anderen Gerät weiter/).count()) > 0
    const noDone = (await old.page.getByRole("button", { name: "Fertig", exact: true }).count()) === 0
    check("after Übergeben the sheet cannot be dismissed and shows no Fertig", stillOpen && noDone)
    await shot(old.page, "handoff-sending-de-light-iphone")
    await text(old.page, "Das Spiel läuft jetzt auf dem anderen Gerät weiter.", { timeout: 30_000 })
    await taker.page.getByRole("button", { name: "Spieloptionen" }).waitFor({ timeout: 20_000 })
    check("the game goes on on the other device", (await taker.page.getByText("Mia").count()) > 0)
    const kept = await old.page.evaluate(() => localStorage.getItem("dart-scorer.current-match.v1"))
    check("after done the old device no longer keeps the game for resuming", kept === null)
    await shot(old.page, "handoff-done-locked-de-light-iphone")
    await button(old.page, "Spiel hier schließen").click()
    await old.page.waitForTimeout(800)
    await old.page.reload()
    await old.page.waitForTimeout(1500)
    check("a reload after the handover offers no game to continue", (await old.page.getByText("Weiterspielen").count()) === 0 && (await old.page.getByRole("button", { name: "Spieloptionen" }).count()) === 0)
    await shot(old.page, "after-handoff-reload-de-light-iphone")
    check("no page errors in the handoff devices", errorsOf(old, taker).length === 0, errorsOf(old, taker).slice(0, 2).join(" | "))
  })

// ---- 2 One relay of two down: the score still reaches the spectator ---------------------------

const oneRelayDown = () =>
  scenario("one relay down", async () => {
    stopRelay(RELAY_PORTS[1])
    await sleep(500)
    const board = await device(PHONE, { current: nearWin("r1-relay") })
    const spectator = await device(PHONE)
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Zuschauen lassen")
    await closeSheet(board.page)
    const t0 = Date.now()
    await spectator.page.goto(url)
    const got = await text(spectator.page, "Stand von", { timeout: 20_000 }).then(() => true, () => false)
    check("with one relay down the spectator gets the score", got, `lab: ${Date.now() - t0} ms after opening the link`)
    await spectator.page.waitForTimeout(500)
    await shot(spectator.page, "spectator-one-relay-down-de-light-iphone")
    await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
    await board.page.waitForTimeout(300)
    await board.page.getByRole("button", { name: "20", exact: true }).first().click()
    const followed = await spectator.page.locator("p[aria-live]", { hasText: /Jonas wirft.*Aufnahme.*20/ }).waitFor({ timeout: 20_000 }).then(() => true, () => false)
    check("with one relay down a visit still reaches the spectator", followed)
    // The browser itself logs each refused connection to the stopped relay; those are expected.
    const errors = errorsOf(board, spectator).filter((e) => !e.includes(`ws://127.0.0.1:${RELAY_PORTS[1]}/`))
    check("no page errors with one relay down (apart from the browser's own notes on the stopped relay)", errors.length === 0, errors.slice(0, 2).join(" | "))
    await startRelay(RELAY_PORTS[1])
  })

// ---- 3 Seats: freed and taken by someone else; leaving after a reload --------------------------

const seats = () =>
  scenario("seats", async () => {
    const board = await device(PHONE, { current: nearWin("r1-seats", 3) })
    const mia = await device(SE)
    const other = await device(SE, { locale: "en-US", colorScheme: "dark" })
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Spieler verbinden")

    // Mia's phone takes its seat and is put away; meanwhile the board frees the seat and another
    // phone takes it. Back with the code, the phone's memory of the seat must not count.
    await mia.page.goto(url)
    await text(mia.page, "Wähle deinen Platz")
    await button(mia.page, "Mia").click()
    await text(mia.page, "Du spielst als Mia")
    await board.page.getByText("Als Gast verbunden").first().waitFor({ timeout: 20_000 })
    await mia.page.goto("about:blank")
    await board.page.getByRole("button", { name: "Mia trennen" }).click()
    await board.page.getByRole("alertdialog").getByRole("button", { name: "Trennen" }).click()
    await board.page.getByText("Nicht verbunden").first().waitFor({ timeout: 20_000 })
    await other.page.goto(url)
    await text(other.page, "Pick your seat")
    await button(other.page, "Mia").click()
    await text(other.page, "You're playing as Mia")
    await board.page.waitForTimeout(1500)
    await mia.page.goto(url)
    await text(mia.page, "Das Board hat dich von deinem Platz getrennt.", { timeout: 30_000 })
    const taken = await mia.page.getByText("Besetzt").locator("visible=true").count()
    const seatedShown = await mia.page.getByText("Du spielst als Mia").locator("visible=true").count()
    check("back with the code while another phone holds the seat: the seats with the reason, one seat taken, not 'Du spielst als Mia'", taken === 1 && seatedShown === 0)
    await mia.page.waitForTimeout(300)
    await shot(mia.page, "seat-taken-by-other-de-light-se")

    // Freed while the phone looks on: back to the seats at once, with the reason.
    await button(mia.page, "Jonas").click()
    await text(mia.page, "Du spielst als Jonas")
    await board.page.getByText("Als Gast verbunden").nth(1).waitFor({ timeout: 20_000 })
    await board.page.getByRole("button", { name: "Jonas trennen" }).click()
    await board.page.getByRole("alertdialog").getByRole("button", { name: "Trennen" }).click()
    await text(mia.page, "Das Board hat dich von deinem Platz getrennt.", { timeout: 30_000 })
    check("a seat the board frees sends the phone back to the seats, with the reason", (await mia.page.getByText("Wähle deinen Platz").count()) > 0)
    await mia.page.waitForTimeout(300)
    await shot(mia.page, "seat-freed-de-light-se")

    // The other phone (a guest) reloads, comes back with the code and gives the seat back.
    await other.page.reload()
    await other.page.waitForTimeout(1200)
    await other.page.goto("about:blank")
    await other.page.goto(url)
    await text(other.page, "You're playing as Mia")
    await button(other.page, "Pick another seat").click()
    await text(other.page, "Pick your seat")
    await board.page.getByText("Nicht verbunden").first().waitFor({ timeout: 20_000 })
    check("a seat given back after a reload is freed on the board", true)
    await other.page.waitForTimeout(500)
    check("the phone can take another seat afterwards: its old one is free, not 'Taken'", (await other.page.getByText("Taken").locator("visible=true").count()) === 0)
    await shot(other.page, "seat-after-leave-en-dark-se")
    await shot(board.page, "board-after-leave-de-light-iphone")
    await button(other.page, "Jonas").click()
    await text(other.page, "You're playing as Jonas")
    check("the phone sits down again on another seat", true)
    check("no page errors in the seat devices", errorsOf(board, mia, other).length === 0, errorsOf(board, mia, other).slice(0, 2).join(" | "))
  })

// ---- 4 The way back without the code: the Play tab's row ---------------------------------------

const playRow = () =>
  scenario("play row", async () => {
    const guest = await device(PHONE)
    await guest.page.goto(BASE)
    await text(guest.page, "X01")
    await guest.page.waitForTimeout(1500)
    check("a guest's Play tab opens no connection", guest.sockets.length === 0, `${guest.sockets.length} sockets`)

    const board = await device(PHONE, { current: nearWin("r1-row") })
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

    // A reload lands on the start page: the row leads back to the seat.
    await mia.page.goto(BASE)
    await text(mia.page, "Am Board: 301")
    check("after a reload the Play tab shows the seat at the board", true)
    await mia.page.waitForTimeout(500)
    await shot(mia.page, "play-row-de-light-iphone")
    await mia.page.getByRole("button", { name: /Am Board: 301/ }).click()
    await text(mia.page, "Du spielst als Mia")
    check("the row opens the seat without the board's code, without 'Anderen Platz wählen'", (await mia.page.getByRole("button", { name: "Anderen Platz wählen" }).count()) === 0)
    await mia.page.waitForTimeout(500)
    await shot(mia.page, "stored-seat-de-light-iphone")

    // The board finishes the game; the phone confirms from the stored seat.
    await board.page.getByRole("button", { name: "Bull, 50" }).first().click()
    await text(mia.page, "Ergebnis bestätigen", { timeout: 30_000 })
    await button(mia.page, "Ergebnis bestätigen").click()
    await text(mia.page, "Bestätigt. Das Spiel steht jetzt in deinen Spielen.", { timeout: 30_000 })
    await mia.page.goto(BASE)
    await text(mia.page, "Ergebnis bestätigt")
    check("the row shows the confirmed result", true)
    await mia.page.waitForTimeout(500)
    await shot(mia.page, "play-row-confirmed-de-light-iphone")
    check("no page errors on the way back", errorsOf(guest, board, mia).length === 0, errorsOf(guest, board, mia).slice(0, 2).join(" | "))
  })

// ---- 5 The result in landscape with the confirmations row --------------------------------------

const resultLandscape = (viewport, name) =>
  scenario(`result ${name}`, async () => {
    const board = await device(viewport, { current: nearWin(`r1-result-${name}`) })
    const mia = await device(PHONE)
    const jonas = await device(PHONE)
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    const url = await openCode(board.page, "Spieler verbinden")
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
    await closeSheet(board.page)
    // Mia misses, Jonas scores 1, Mia takes the Bull: a plain win (a six-dart leg would add the
    // result's badge line, which takes the same room on its own).
    await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
    await board.page.waitForTimeout(300)
    await board.page.getByRole("button", { name: "1", exact: true }).first().click()
    await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
    await board.page.waitForTimeout(300)
    await board.page.getByRole("button", { name: "Bull, 50" }).first().click()
    await text(mia.page, "Ergebnis bestätigen", { timeout: 30_000 })
    await button(mia.page, "Ergebnis bestätigen").click()
    await text(jonas.page, "Ergebnis bestätigen", { timeout: 30_000 })
    await button(jonas.page, "Widersprechen").click()
    await jonas.page.getByRole("alertdialog").getByRole("button", { name: "Widersprechen" }).click()
    await text(board.page, "1 von 2 bestätigt · 1 Widerspruch", { timeout: 30_000 })
    await board.page.waitForTimeout(800)
    await shot(board.page, `result-landscape-${name}-de-light`)
    let visible = true
    for (const label of ["Teilen", "Statistik", "Aufnahmen", "Rangliste"]) visible = visible && (await inView(board.page, board.page.locator("button:visible", { hasText: label }).first()))
    const row = await inView(board.page, board.page.getByRole("button", { name: /1 von 2 bestätigt/ }).first())
    check(`at ${name} the result's actions and the confirmations stay in view`, visible && row && (await noHorizontalScroll(board.page)))
    check(`no page errors at ${name}`, errorsOf(board, mia, jonas).length === 0, errorsOf(board, mia, jonas).slice(0, 2).join(" | "))
  })

// ---- 6 The live sheets on an iPhone SE: sharing stays in view ----------------------------------

const sheets = () =>
  scenario("sheets", async () => {
    const board = await device(SE, { current: nearWin("r1-sheets") })
    await board.page.goto(BASE)
    await text(board.page, "Mia")
    for (const [entry, name] of [
      ["Zuschauen lassen", "watch-sheet-se-de-light"],
      ["Spieler verbinden", "players-sheet-se-de-light"],
      ["Auf anderem Gerät fortsetzen", "handoff-sheet-se-de-light"],
    ]) {
      await options(board.page, entry)
      await text(board.page, "Link kopieren")
      await board.page.waitForTimeout(800)
      await shot(board.page, name)
      check(`${entry}: the share button is in view on an iPhone SE`, await inView(board.page, board.page.getByRole("button", { name: "Link kopieren" }).last(), button(board.page, "Fertig")))
      await closeSheet(board.page)
    }
    const en = await device(SE, { current: nearWin("r1-sheets-en"), locale: "en-US", colorScheme: "dark" })
    await en.page.goto(BASE)
    await text(en.page, "Mia")
    await en.page.getByRole("button", { name: "Game options" }).click()
    await en.page.waitForTimeout(700)
    await en.page.getByRole("button", { name: "Let others watch" }).click()
    await text(en.page, "Copy link")
    await en.page.waitForTimeout(800)
    await shot(en.page, "watch-sheet-se-en-dark")
    check("Let others watch: the share button is in view on an iPhone SE (English, dark)", await inView(en.page, en.page.getByRole("button", { name: "Copy link" }).last(), button(en.page, "Done")))
    check("no page errors in the sheets", errorsOf(board, en).length === 0, errorsOf(board, en).slice(0, 2).join(" | "))
  })

try {
  for (const port of RELAY_PORTS) await startRelay(port)
  browser = await chromium.launch()
  await handoff()
  await oneRelayDown()
  await seats()
  await playRow()
  await resultLandscape(SE_LANDSCAPE, "548x320")
  await resultLandscape(SE_LANDSCAPE_FULL, "568x320")
  await sheets()
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {})
  await browser?.close()
  for (const port of [...relays.keys()]) stopRelay(port)
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
