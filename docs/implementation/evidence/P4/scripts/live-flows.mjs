// P4 live games in the production build, end to end in Chromium (Playwright), against a local
// in-memory relay. Several browser contexts play the devices: the board, spectators on a phone and
// a TV, two players' phones and a second board for the handoff. Nothing reaches a public relay.
//
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:47315 npm run build
//   nak serve --hostname 127.0.0.1 --port 47315 &
//   npx next start -p 3315 &
//   node docs/implementation/evidence/P4/scripts/live-flows.mjs
//
// Writes screenshots to ../screens and prints one PASS/FAIL line per check. Timings are lab
// values on a loaded development machine, not field measurements.
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3315"
const RELAY_PORT = process.env.RELAY_PORT ?? "47315"
const SHOTS = new URL("../screens/", import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}

const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
// Mia has 50 left with one dart in hand: the Bull wins it.
const nearWin = (id) => ({
  id,
  startedAt: "2026-10-06T19:00:00.000Z",
  acknowledgedLegs: 0,
  status: "playing",
  config: { modeId: "301", modeName: "301", type: "x01", startScore: 301, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: [{ id: "a", name: "Mia" }, { id: "b", name: "Jonas" }] },
  throws: [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)],
})

const PHONE = { width: 390, height: 844 }
const SE = { width: 320, height: 548 }
const TV = { width: 1280, height: 720 }

const browser = await chromium.launch()
const contexts = []

async function device(viewport, { current = null, locale = "de-DE", colorScheme = "light", mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport, locale, colorScheme, hasTouch: mobile, isMobile: mobile, serviceWorkers: "block" })
  contexts.push(ctx)
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE })
  await ctx.addInitScript(([c, theme]) => {
    localStorage.setItem("theme", theme)
    if (sessionStorage.getItem("seeded")) return
    sessionStorage.setItem("seeded", "1")
    if (c) localStorage.setItem("dart-scorer.current-match.v1", c)
  }, [current ? JSON.stringify(current) : null, colorScheme])
  const page = await ctx.newPage()
  const errors = []
  const sockets = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  page.on("websocket", (ws) => sockets.push(ws.url()))
  return { ctx, page, errors, sockets }
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.jpg`, type: "jpeg", quality: 70 })
const text = (page, t, opts = {}) => page.getByText(t, opts).first().waitFor({ timeout: opts.timeout ?? 20_000 })
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
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

// ---- Guest path and "Zuschauen lassen" ----------------------------------------------------------

const board = await device(PHONE, { current: nearWin("board-game") })
await board.page.goto(BASE)
await text(board.page, "Mia")
await board.page.waitForTimeout(1500)
check("a game that was never live opens no connection", board.sockets.length === 0, `${board.sockets.length} sockets`)
await options(board.page)
await shot(board.page, "board-menu-de-light-iphone")
check("the options menu lists the three live entries", (await board.page.getByRole("button", { name: /Zuschauen lassen|Spieler verbinden|Auf anderem Gerät fortsetzen/ }).count()) === 3)
await board.page.getByRole("button", { name: "Zuschauen lassen" }).click()
await text(board.page, "Link kopieren")
await board.page.waitForTimeout(600)
await shot(board.page, "watch-sheet-de-light-iphone")
const watchUrl = await copied(board.page)
check("the watch link carries the match in the fragment", /\/#watch=W1\./.test(watchUrl), watchUrl.slice(0, 40))
check("going live connects to the local relay only", board.sockets.length > 0 && board.sockets.every((u) => u.includes(`:${RELAY_PORT}`)), board.sockets.join(","))
await button(board.page, "Fertig").click()
await board.page.waitForTimeout(500)

const spectator = await device(PHONE)
await spectator.page.goto(watchUrl)
await text(spectator.page, "Stand von")
await spectator.page.waitForTimeout(800)
await shot(spectator.page, "spectator-de-light-iphone")
check("the spectator sees the board's names and score", (await spectator.page.getByText("Mia").count()) > 0 && (await spectator.page.getByText("50", { exact: true }).count()) > 0)
check("the spectator page has no horizontal scrolling", await noHorizontalScroll(spectator.page))

// A miss ends Mia's visit; Jonas hits a 20. The spectator follows within seconds.
await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
await board.page.waitForTimeout(300)
const tapped = Date.now()
await board.page.getByRole("button", { name: "20", exact: true }).first().click()
await spectator.page.locator("p[aria-live]", { hasText: /Jonas wirft.*Aufnahme.*20/ }).waitFor({ timeout: 20_000 })
check("a visit reaches the spectator", true, `lab: ${Date.now() - tapped} ms from tap to the spectator's screen`)
await spectator.page.waitForTimeout(500)
await shot(spectator.page, "spectator-update-de-light-iphone")

const tv = await device(TV, { mobile: false })
await tv.page.goto(watchUrl)
await text(tv.page, "Stand von")
await tv.page.getByRole("button", { name: "Vollbild" }).click()
await tv.page.waitForTimeout(800)
await shot(tv.page, "spectator-tv-de-light")

await spectator.ctx.setOffline(true)
await text(spectator.page, "Verbindung unterbrochen")
await spectator.page.waitForTimeout(500)
await shot(spectator.page, "spectator-interrupted-de-light-iphone")
check("a lost connection says so, with the time of the last score", (await spectator.page.getByText(/zuletzt aktualisiert/).count()) > 0)
await spectator.ctx.setOffline(false)

// ---- "Spieler verbinden" and the result --------------------------------------------------------

await options(board.page, "Spieler verbinden")
await text(board.page, "Link kopieren")
await board.page.waitForTimeout(600)
await shot(board.page, "players-sheet-de-light-iphone")
const boardUrl = await copied(board.page)
check("the board code is a board link", /\/#board=B1\./.test(boardUrl))

const mia = await device(PHONE)
await mia.page.goto(boardUrl)
await text(mia.page, "Wähle deinen Platz")
await mia.page.waitForTimeout(400)
await shot(mia.page, "phone-seats-de-light-iphone")
await mia.page.getByRole("button", { name: "Mia" }).click()
await text(mia.page, "Du spielst als Mia")
await mia.page.waitForTimeout(1500)
await shot(mia.page, "phone-seated-de-light-iphone")

const jonas = await device(SE, { colorScheme: "dark" })
await jonas.page.goto(boardUrl)
await text(jonas.page, "Wähle deinen Platz")
check("a taken seat shows as taken", (await jonas.page.getByText("Besetzt").count()) === 1)
await shot(jonas.page, "phone-seats-taken-de-dark-se")
await jonas.page.getByRole("button", { name: "Jonas" }).click()
await text(jonas.page, "Du spielst als Jonas")

await board.page.getByText("Als Gast verbunden").nth(1).waitFor({ timeout: 20_000 })
await board.page.waitForTimeout(500)
await shot(board.page, "players-connected-de-light-iphone")
check("the board shows both phones on their seats", (await board.page.getByText("Als Gast verbunden").count()) === 2)
check("no secret key ever reached a phone's storage in the clear", !(await mia.page.evaluate(() => JSON.stringify(localStorage))).match(/nsec|"secret"/))
await button(board.page, "Fertig").click()
await board.page.waitForTimeout(500)

// Jonas misses the rest; Mia checks out with the Bull.
await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
await board.page.waitForTimeout(300)
await board.page.getByRole("button", { name: "Bull, 50" }).first().click()
await board.page.locator("button:visible", { hasText: "Revanche" }).first().waitFor({ timeout: 20_000 })
await text(mia.page, "Ergebnis bestätigen", { timeout: 30_000 })
await mia.page.waitForTimeout(500)
await shot(mia.page, "phone-confirm-de-light-iphone")
await mia.page.getByRole("button", { name: "Ergebnis bestätigen" }).click()
await text(mia.page, "Bestätigt. Das Spiel steht jetzt in deinen Spielen.")
await shot(mia.page, "phone-confirmed-de-light-iphone")
await mia.page.waitForTimeout(1500)
check("a confirmed result lands in the player's own games", (await mia.page.evaluate(() => localStorage.getItem("dart-scorer.matches.v1") ?? "")).includes("Mia"))

await text(jonas.page, "Widersprechen", { timeout: 30_000 })
await jonas.page.getByRole("button", { name: "Widersprechen" }).click()
await jonas.page.getByRole("alertdialog").getByRole("button", { name: "Widersprechen" }).click()
await text(jonas.page, "Du hast dem Ergebnis widersprochen.")
await jonas.page.waitForTimeout(800)
await shot(jonas.page, "phone-disputed-de-dark-se")

await text(board.page, "Ergebnis bestätigt: 1 von 2", { timeout: 30_000 })
await board.page.waitForTimeout(500)
await shot(board.page, "board-result-de-light-iphone")
check("the result shows who confirmed and who disputes", (await board.page.getByText("Widerspruch von Jonas").count()) === 1)
await board.page.setViewportSize({ width: 844, height: 390 })
await board.page.waitForTimeout(800)
await shot(board.page, "board-result-de-light-iphone-landscape")
await board.page.setViewportSize(PHONE)
await board.page.waitForTimeout(500)

// Taken back on the board: the result is withdrawn on the phones, a new one needs a new verdict.
await board.page.getByRole("dialog").getByRole("button", { name: "Letzten Dart rückgängig machen" }).click()
await text(mia.page, "Das Ergebnis wurde zurückgenommen, das Spiel geht weiter.", { timeout: 30_000 })
await shot(mia.page, "phone-withdrawn-de-light-iphone")
await mia.page.waitForTimeout(1500)
check("a withdrawn result leaves the player's own games", !(await mia.page.evaluate(() => localStorage.getItem("dart-scorer.matches.v1") ?? "")).includes("Mia"))
await board.page.getByRole("button", { name: "Bull, 50" }).first().click()
await text(mia.page, "Das Ergebnis wurde korrigiert. Prüfe es bitte noch einmal.", { timeout: 30_000 })
await shot(mia.page, "phone-corrected-de-light-iphone")
await text(board.page, "Ergebnis bestätigt: 0 von 2", { timeout: 30_000 })
check("the board's verdict count starts again with the corrected result", true)

// ---- "Auf anderem Gerät fortsetzen" ------------------------------------------------------------

const first = await device(PHONE, { current: nearWin("handoff-game") })
await first.page.goto(BASE)
await text(first.page, "Mia")
await options(first.page, "Auf anderem Gerät fortsetzen")
await text(first.page, "Link kopieren")
await first.page.waitForTimeout(600)
await shot(first.page, "handoff-sheet-de-light-iphone")
const handoffUrl = await copied(first.page)

const second = await device({ width: 1024, height: 768 }, { mobile: true })
await second.page.goto(handoffUrl)
await text(second.page, "Das Spiel wird auf diesem Gerät fortgesetzt.")
await shot(second.page, "takeover-de-light-ipad")
await second.page.getByRole("button", { name: "Übernehmen" }).click()
await text(second.page, "Prüfcode")
await text(first.page, "Spiel übergeben?")
const codeThere = await second.page.locator("text=Prüfcode").locator("xpath=following-sibling::*[1]").textContent()
const codeHere = await first.page.locator("text=Prüfcode").locator("xpath=following-sibling::*[1]").textContent()
check("both devices show the same check code", !!codeHere && codeHere === codeThere, `${codeHere} / ${codeThere}`)
await shot(second.page, "takeover-code-de-light-ipad")
await shot(first.page, "handoff-asked-de-light-iphone")
await first.page.waitForTimeout(1500)
check("nothing moves before the writing device confirms", (await second.page.getByRole("button", { name: "Spieloptionen" }).count()) === 0)
await first.page.getByRole("button", { name: "Übergeben" }).click()
await text(first.page, "Das Spiel läuft jetzt auf dem anderen Gerät weiter.", { timeout: 30_000 })
await shot(first.page, "handoff-done-de-light-iphone")
await second.page.getByRole("button", { name: "Spieloptionen" }).waitFor({ timeout: 30_000 })
await second.page.waitForTimeout(800)
await shot(second.page, "takeover-game-de-light-ipad")
check("the game goes on on the other device with its throws", (await second.page.getByText("50", { exact: true }).count()) > 0)
await first.page.getByRole("button", { name: "Spiel hier schließen" }).click()
await first.page.waitForTimeout(1200)
check("the first device leaves the game", (await first.page.getByRole("button", { name: "Spieloptionen" }).count()) === 0)

// ---- English, dark, small phone ----------------------------------------------------------------

const en = await device(SE, { locale: "en-US", colorScheme: "dark" })
await en.page.goto(watchUrl)
await text(en.page, "Score as of")
await en.page.waitForTimeout(600)
await shot(en.page, "spectator-en-dark-se")
check("the English spectator view has no horizontal scrolling", await noHorizontalScroll(en.page))
const enBoard = await device(SE, { current: nearWin("en-game"), locale: "en-US", colorScheme: "dark" })
await enBoard.page.goto(BASE)
await text(enBoard.page, "Mia")
await enBoard.page.getByRole("button", { name: "Game options" }).click()
await enBoard.page.waitForTimeout(700)
await enBoard.page.getByRole("button", { name: "Connect players" }).click()
await text(enBoard.page, "Copy link")
await enBoard.page.waitForTimeout(600)
await shot(enBoard.page, "players-sheet-en-dark-se")

const pageErrors = [board, spectator, tv, mia, jonas, first, second, en, enBoard].flatMap((d) => d.errors.filter((e) => !/Failed to load resource/.test(e)))
check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "))
for (const ctx of contexts) await ctx.close()
await browser.close()
console.log(`${results.filter(Boolean).length}/${results.length} checks passed (${contexts.length} devices)`)
process.exit(results.every(Boolean) ? 0 : 1)
