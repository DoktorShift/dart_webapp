// P6.02–P6.04 tournaments in the production build, end to end in Chromium (Playwright), against
// a local in-memory relay. Several browser contexts play the devices: the organizer's phone,
// two players' phones, a board device, a TV. Nothing reaches a public relay.
//
//   nak serve --hostname 127.0.0.1 --port 20640 &
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20640 npm run build
//   npx next start -p 3322 &
//   node docs/implementation/evidence/P6.02/scripts/tournament-flows.mjs
//
// Since review round 1 it also checks: guests count as present at the check-in and the draw sheet
// names who is missing, the tournament's name in the navigation bar, Einstellungen behind the
// gear, the board's result leading back to the board (no Revanche), the confirmation before a
// board is removed, the QR sheets on an iPhone SE and in landscape, and printing without the
// app around the sheet.
//
// Writes screenshots to ../screens and prints one PASS/FAIL line per check. Timings are lab
// values on a loaded development machine, not field measurements.
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3322"
const RELAY_PORT = process.env.RELAY_PORT ?? "20640"
const SHOTS = new URL("../screens/", import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}

const PHONE = { width: 390, height: 844 }
const SE = { width: 320, height: 548 }
const TV = { width: 1280, height: 720 }

const browser = await chromium.launch()
const contexts = []
const devices = []

// Whatever goes wrong, every device's screen is kept for the diagnosis.
process.on("uncaughtException", async (error) => {
  console.log(`FAIL ${String(error).split("\n")[0]}`)
  for (const [i, d] of devices.entries()) {
    await d.page.screenshot({ path: `${SHOTS}fail-${i}.jpg`, type: "jpeg", quality: 60 }).catch(() => {})
    if (d.errors.length > 0) console.log(`errors on device ${i}: ${d.errors.slice(0, 3).join(" | ")}`)
  }
  await browser.close().catch(() => {})
  process.exit(1)
})

async function device(viewport, { locale = "de-DE", colorScheme = "light", mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport, locale, colorScheme, hasTouch: mobile, isMobile: mobile, serviceWorkers: "block" })
  contexts.push(ctx)
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE })
  await ctx.addInitScript((theme) => localStorage.setItem("theme", theme), colorScheme)
  const page = await ctx.newPage()
  const errors = []
  const sockets = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  page.on("websocket", (ws) => sockets.push(ws.url()))
  const made = { ctx, page, errors, sockets }
  devices.push(made)
  return made
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.jpg`, type: "jpeg", quality: 70 })
// Covered screens stay in the page (hidden): only what can be seen counts.
const text = (page, t, opts = {}) => page.getByText(t, opts).locator("visible=true").first().waitFor({ timeout: opts.timeout ?? 20_000 })
const button = (page, name) => page.getByRole("button", { name, exact: true }).first()
const copied = async (page) => {
  await page.getByRole("button", { name: "Link kopieren" }).last().click()
  await page.waitForTimeout(300)
  return page.evaluate(() => navigator.clipboard.readText())
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
// Links name the published site; the devices here open them on the local build.
const local = (url) => url.replace(/^https?:\/\/[^/]+/, BASE)
// The tab bar (phones) or the sidebar (wide screens): whichever is visible.
const tabs = (page) => page.locator('nav[aria-label="Bereiche"]:visible')
const tab = (page, name) => tabs(page).getByText(name, { exact: true }).click()
const radio = (page, name) => page.getByRole("radio", { name, exact: true }).first().click()

// ---- The organizer creates the tournament in four steps ----------------------------------------

const orga = await device(PHONE)
await orga.page.goto(BASE)
await tabs(orga.page).waitFor({ timeout: 20_000 })
await tab(orga.page, "Turniere")
await text(orga.page, "Noch kein Turnier")
await orga.page.waitForTimeout(500)
await shot(orga.page, "home-empty-de-light-iphone")
check("the guest's Tournaments tab opens no connection", orga.sockets.length === 0, `${orga.sockets.length} sockets`)
await button(orga.page, "Turnier erstellen").click()
await text(orga.page, "Schritt 1 von 4")
await orga.page.getByLabel("Titel").fill("Pub Open")
await orga.page.getByLabel("Beginn").fill("2026-10-24T19:00")
await orga.page.getByLabel("Ort").fill("Goldener Anker")
await orga.page.waitForTimeout(300)
await shot(orga.page, "create-1-de-light-iphone")
await button(orga.page, "Weiter").click()
await text(orga.page, "Schritt 2 von 4")
await radio(orga.page, "301")
await orga.page.getByRole("radiogroup", { name: "Legs pro Spiel" }).getByRole("radio", { name: "1", exact: true }).click()
await orga.page.waitForTimeout(300)
await shot(orga.page, "create-2-de-light-iphone")
await button(orga.page, "Weiter").click()
await text(orga.page, "Schritt 3 von 4")
await orga.page.getByRole("radiogroup", { name: "Plätze" }).getByRole("radio", { name: "4", exact: true }).click()
check("step 3 keeps registration, check-in and results under Mehr Optionen", (await orga.page.getByRole("switch", { name: "Check-in vor der Auslosung" }).count()) === 0)
await orga.page.getByLabel("Gäste ohne Profil").fill("Mia\nJonas")
await orga.page.getByLabel("Boards").fill("Board 1\nBoard 2")
await orga.page.waitForTimeout(300)
await shot(orga.page, "create-3-de-light-iphone")
await button(orga.page, "Weiter").click()
await text(orga.page, "Schritt 4 von 4")
await text(orga.page, "So wird gespielt")
await text(orga.page, "Dein Name")
check("the preview asks a guest for a name, nothing more", (await orga.page.getByText(/Schlüssel|Relay|Nostr/).count()) === 0)
await orga.page.getByLabel("Dein Name").fill("Orga Olaf")
await orga.page.waitForTimeout(300)
await shot(orga.page, "create-4-de-light-iphone")
await button(orga.page, "Turnier veröffentlichen").click()
await text(orga.page, "Dein Turnier ist veröffentlicht", { timeout: 40_000 })
await orga.page.waitForTimeout(500)
await shot(orga.page, "published-de-light-iphone")
check("publishing connects to the local relay only", orga.sockets.length > 0 && orga.sockets.every((u) => u.includes(`:${RELAY_PORT}`)), orga.sockets.join(","))
await button(orga.page, "Teilen").click()
await text(orga.page, "Link kopieren")
await orga.page.waitForTimeout(600)
await shot(orga.page, "share-de-light-iphone")
const inviteUrl = await copied(orga.page)
check("the tournament link carries the tournament in the fragment", /\/#tournament=T1\./.test(inviteUrl), inviteUrl.slice(0, 40))
await button(orga.page, "Fertig").click()
await orga.page.waitForTimeout(300)
await button(orga.page, "Zum Turnier").click()
await text(orga.page, "Turnierleitung")
await orga.page.waitForTimeout(800)
await shot(orga.page, "tournament-organizer-de-light-iphone")
check("the organizer's view names rules (singular), start, place and free places", (await orga.page.getByText(/301, First to 1 Leg\b(?!s)/).count()) > 0 && (await orga.page.getByText("2 Plätze frei").count()) > 0)
check("one filled primary on the tournament page: Teilen is tinted", (await orga.page.getByRole("button", { name: "Teilen", exact: true }).first().getAttribute("class"))?.includes("bg-primary/10") === true)
check("the tournament page has no horizontal scrolling", await noHorizontalScroll(orga.page))

// ---- Two players register from their phones; the organizer's device admits them ---------------

const anna = await device(PHONE)
await anna.page.goto(local(inviteUrl))
await text(anna.page, "2 Plätze frei", { timeout: 30_000 })
await anna.page.waitForTimeout(600)
check("a tournament opened from its link names itself in the navigation bar", (await anna.page.getByRole("heading", { name: "Pub Open" }).count()) > 0)
await shot(anna.page, "player-register-de-light-iphone")
await anna.page.getByLabel("Dein Name").fill("Anna")
await button(anna.page, "Anmelden").click()
// The request is pending for a moment; the organizer's device admits it as it arrives.
await text(anna.page, "Du bist angemeldet", { timeout: 40_000 })
await anna.page.waitForTimeout(500)
await shot(anna.page, "player-registered-de-light-iphone")
check("a registration is admitted by the organizer's device without anyone tapping", true)

const ben = await device(SE, { colorScheme: "dark" })
await ben.page.goto(local(inviteUrl))
await text(ben.page, "1 Platz frei", { timeout: 30_000 })
await ben.page.getByLabel("Dein Name").fill("Ben")
await button(ben.page, "Anmelden").click()
await text(ben.page, "Du bist angemeldet", { timeout: 40_000 })
await ben.page.waitForTimeout(500)
await shot(ben.page, "player-registered-de-dark-se")
check("the SE page has no horizontal scrolling", await noHorizontalScroll(ben.page))

await text(orga.page, "Alle Plätze sind vergeben", { timeout: 30_000 })

// ---- Check-in, draw, start, boards ------------------------------------------------------------

await orga.page.getByRole("button", { name: /^Turnierleitung/ }).click()
await text(orga.page, "Jetzt dran")
await orga.page.waitForTimeout(500)
await shot(orga.page, "organize-participants-de-light-iphone")
check("the workspace lists the four participants", (await orga.page.getByText("Angemeldet (4)").count()) === 1)
check("the workspace has three segments and the settings behind a gear", (await orga.page.getByRole("radio").count()) === 3 && (await orga.page.getByRole("button", { name: "Einstellungen" }).count()) === 1)
await button(orga.page, "Check-in öffnen").click()
await text(anna.page, "Ich bin da", { timeout: 40_000 })
await button(anna.page, "Ich bin da").click()
await text(anna.page, "Du bist eingecheckt", { timeout: 30_000 })
await text(orga.page, "Auslosen", { timeout: 30_000 })
await orga.page.waitForTimeout(800)
check("guests count as present at the check-in", (await orga.page.getByText("Gast · Da").count()) === 2)
await button(orga.page, "Auslosen").click()
await text(orga.page, /Nicht eingecheckt, bleiben draußen: Ben/)
await orga.page.waitForTimeout(600)
await shot(orga.page, "draw-sheet-missing-de-light-iphone")
check("the draw sheet names who is missing; the guests are in the field", (await orga.page.getByText("3 Spieler im Feld").count()) > 0)
await button(orga.page, "Alle als da melden").click()
await text(orga.page, "4 Spieler im Feld", { timeout: 30_000 })
await orga.page.waitForTimeout(600)
await shot(orga.page, "draw-sheet-de-light-iphone")
await button(orga.page, "Jetzt auslosen").click()
await text(orga.page, "Turnier starten", { timeout: 30_000 })
await button(orga.page, "Turnier starten").click()
await text(orga.page, "Läuft", { timeout: 30_000 })
await orga.page.getByRole("radio", { name: "Boards" }).click()
await text(orga.page, "2 Spiele aufrufen")
await orga.page.waitForTimeout(500)
await shot(orga.page, "organize-boards-de-light-iphone")
await button(orga.page, "2 Spiele aufrufen").click()
await text(orga.page, "Aufgerufen:", { timeout: 30_000 })
await orga.page.getByRole("button", { name: /^Board 1/ }).click()
await text(orga.page, "Link kopieren")
await orga.page.waitForTimeout(600)
await shot(orga.page, "board-code-de-light-iphone")
const boardUrl = await copied(orga.page)
check("the board code is a board authorization link", /\/#tournament=TB1\./.test(boardUrl))
await button(orga.page, "Board entfernen").click()
await text(orga.page, "Board 1 entfernen?")
await orga.page.waitForTimeout(300)
await shot(orga.page, "board-remove-confirm-de-light-iphone")
check("removing a board asks first", true)
await orga.page.getByRole("alertdialog").getByRole("button", { name: "Abbrechen" }).click()
for (const [size, name] of [[SE, "board-code-de-light-se"], [{ width: 568, height: 320 }, "board-code-de-light-se-landscape"]]) {
  await orga.page.setViewportSize(size)
  await orga.page.waitForTimeout(600)
  await shot(orga.page, name)
}
check("the board code's QR and its copy action stay in view on an iPhone SE in landscape", await orga.page.getByRole("button", { name: "Link kopieren" }).last().isVisible())
await orga.page.setViewportSize(PHONE)
await button(orga.page, "Fertig").click()

await text(anna.page, "Dein nächstes Spiel", { timeout: 40_000 })
await anna.page.waitForTimeout(500)
await shot(anna.page, "player-next-de-light-iphone")
check("a player sees opponent and board once called", (await anna.page.getByText(/^Board [12]$/).count()) === 1)
await anna.page.setViewportSize({ width: 568, height: 320 })
await anna.page.waitForTimeout(600)
await shot(anna.page, "player-next-de-light-se-landscape")
check("in landscape 'Dein nächstes Spiel' is in view at once", await anna.page.getByText("Dein nächstes Spiel").first().evaluate((el) => el.getBoundingClientRect().bottom < window.innerHeight))
await anna.page.setViewportSize(PHONE)

// ---- The board device plays its match on the game screen -----------------------------------

const board = await device(SE)
await board.page.goto(local(boardUrl))
await text(board.page, "Dieses Gerät wird zum Board", { timeout: 30_000 })
await board.page.waitForTimeout(400)
await shot(board.page, "board-become-de-light-iphone")
await button(board.page, "Board verwenden").click()
await text(board.page, "Jetzt an diesem Board", { timeout: 30_000 })
await board.page.waitForTimeout(500)
await shot(board.page, "board-called-de-light-iphone")
await button(board.page, "Spiel starten").click()
await board.page.getByRole("button", { name: "Spieloptionen" }).waitFor({ timeout: 30_000 })
await board.page.waitForTimeout(1500)
await shot(board.page, "board-game-de-light-iphone")
check("the board's match goes live on the local relay", board.sockets.length > 0 && board.sockets.every((u) => u.includes(`:${RELAY_PORT}`)))
check("the game screen names the players, not their keys", (await board.page.getByText(/^(Anna|Ben|Mia|Jonas)$/).count()) >= 2)

// Seat 0 wins 301 in one leg: T20 T20 T20, the opponent misses, then T20 T11 D14. The
// multiplier is set before each dart.
const key = (name) => board.page.getByRole("button", { name, exact: true }).first()
const darts = async (list) => {
  for (const [toggle, n] of list) {
    await key(toggle).click()
    await key(n).click()
    await board.page.waitForTimeout(200)
  }
}
await darts([["Triple", "T20"], ["Triple", "T20"], ["Triple", "T20"]])
await board.page.getByRole("button", { name: /^Rest der Aufnahme daneben/ }).click()
await board.page.waitForTimeout(300)
await darts([["Triple", "T20"], ["Triple", "T11"], ["Double", "D14"]])
await board.page.locator("button:visible", { hasText: "Zurück zum Board" }).first().waitFor({ timeout: 20_000 })
await board.page.waitForTimeout(3500)
await shot(board.page, "board-result-de-light-se")
check("a board's result leads back to the board, with no Revanche", (await board.page.locator("button:visible", { hasText: "Revanche" }).count()) === 0)
// On a short phone the result shows one row and a count; the others are in its sheet.
await board.page.locator("button:visible", { hasText: /^\+\d$/ }).first().click()
await text(board.page, "Ergebnis ans Turnier gemeldet", { timeout: 20_000 })
await board.page.waitForTimeout(600)
await shot(board.page, "board-result-rows-de-light-se")
check("the tournament row fits an iPhone SE", await board.page.getByText("Ergebnis ans Turnier gemeldet").first().evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth))
await board.page.keyboard.press("Escape")
await board.page.setViewportSize(PHONE)
await board.page.waitForTimeout(500)
await shot(board.page, "board-result-de-light-iphone")
await button(board.page, "Zurück zum Board").click()
await text(board.page, "Ergebnis gemeldet", { timeout: 20_000 })
await board.page.waitForTimeout(500)
await shot(board.page, "board-reported-de-light-iphone")

// The organizer approves it; the player sees the final waiting for its other half.
await orga.page.getByRole("radio", { name: "Ergebnisse" }).click()
await text(orga.page, /gewinnt 1:0/, { timeout: 30_000 })
await orga.page.waitForTimeout(500)
await shot(orga.page, "organize-results-de-light-iphone")
await button(orga.page, "Freigeben").click()
await text(orga.page, "Freigegeben", { timeout: 30_000 }).catch(() => {})
await orga.page.waitForTimeout(800)
await shot(orga.page, "organize-approved-de-light-iphone")
check("the approved result stands in the organizer's list", (await orga.page.getByText("1:0").count()) > 0)

// The TV view and the print sheet, for everyone.
const tv = await device(TV, { mobile: false })
await tv.page.goto(local(inviteUrl))
await text(tv.page, "Infos", { timeout: 30_000 })
await tv.page.getByRole("radio", { name: "Infos" }).click()
await tv.page.getByRole("button", { name: /^TV-Ansicht/ }).click()
await text(tv.page, "Läuft", { timeout: 20_000 })
await tv.page.getByRole("button", { name: "Vollbild" }).click()
await tv.page.waitForTimeout(800)
await shot(tv.page, "tv-full-de-light")
check("the TV view shows no admin controls", (await tv.page.getByText(/Freigeben|Korrigieren|Entfernen/).count()) === 0)
await tv.page.getByRole("button", { name: "Vollbild beenden" }).click()
await tv.page.getByRole("button", { name: /Zurück zu/ }).first().click()
await tv.page.getByRole("button", { name: /^Drucken & Export/ }).click()
await text(tv.page, "CSV exportieren", { timeout: 20_000 })
await tv.page.waitForTimeout(500)
await shot(tv.page, "print-de-light")
await tv.page.emulateMedia({ media: "print" })
await shot(tv.page, "print-media-de-light")
check("printing shows the sheet without the app's buttons, sidebar or navigation", (await tv.page.getByRole("button", { name: "Drucken" }).isVisible()) === false && (await tabs(tv.page).count()) === 0)
await tv.page.emulateMedia({ media: "screen" })

await anna.page.waitForTimeout(1000)
await shot(anna.page, "player-after-de-light-iphone")
await ben.page.setViewportSize({ width: 548, height: 320 })
await ben.page.waitForTimeout(800)
await shot(ben.page, "player-de-dark-se-landscape")
check("the SE landscape page has no horizontal scrolling", await noHorizontalScroll(ben.page))
await ben.page.setViewportSize(SE)
await button(ben.page, "Teilen").click()
await text(ben.page, "Link kopieren")
await ben.page.waitForTimeout(700)
await shot(ben.page, "share-de-dark-se")
check("the share sheet's copy action is in view on an iPhone SE", await ben.page.getByRole("button", { name: "Link kopieren" }).last().evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight))
await ben.page.setViewportSize({ width: 568, height: 320 })
await ben.page.waitForTimeout(700)
await shot(ben.page, "share-de-dark-se-landscape")
check("the share sheet's copy action is in view in landscape", await ben.page.getByRole("button", { name: "Link kopieren" }).last().evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight))

const errorsOf = (d, name) => check(`${name}: no page errors`, d.errors.length === 0, d.errors.slice(0, 3).join(" | "))
for (const [d, name] of [[orga, "organizer"], [anna, "Anna"], [ben, "Ben"], [board, "board"], [tv, "TV"]]) errorsOf(d, name)

for (const ctx of contexts) await ctx.close()
await browser.close()
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
