// P8.01 "Gesamter Spielabend": one continuous evening in the production build, in Chromium
// (Playwright), with several browser contexts as the devices of the people in the pub. Nothing
// reaches a public relay, wallet or service: the relays are two fresh "nak serve" on 127.0.0.1,
// the wallets are NIP-47 simulators (tests/support/fake-wallet.ts), every other request is refused
// and counted.
//
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20350,ws://127.0.0.1:20351 npm run build
//   npx next start -p 3345 &
//   node docs/implementation/evidence/P8/scripts/darts-night.mjs     (BASE, OUT, RELAY_PORTS optional)
//
// The evening: Anna plays a 301 as a guest (no profile, no connection) and takes her results into
// a new profile from the result screen; pairs her second phone by typing its code; backs the
// profile up to a file and opens it on a third device (English). She founds a club and invites Ben
// by link; Ben joins as a guest and has a profile from then on. Anna starts a club game from the
// club and lets Carla watch it live; the result is recorded for the club and Ben confirms it on his
// phone. Anna runs a small tournament (4 players: Anna, Ben, Carla and the guest Mia; single KO)
// with a tablet as Board 1: check-in, draw, calls, the board reports, Anna approves, finishes and
// the badges go out; Ben's badge shows on his profile card. Last, a stake of 500 sats: Ben wins,
// Anna pays it with her (simulated) wallet to the code Ben's phone shows, once, even when tapped
// twice. Then Ben, a member, invites Carl by the spoken code (Anna confirms him), and Anna sends
// Carla an invitation straight to her profile.
//
// Prints one PASS/FAIL line per check and the step table with lab timings (a loaded development
// machine, local relays: not field values). Screenshots (JPEG) at each device's size go to OUT.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { startFakeWallet } from "../../../../../tests/support/fake-wallet.ts"
import {
  BASE, BOARD, OUT, PHONE, RELAYS, SE, allPassed, notes, audits, button, buttons, closeAll, isOnScreen, tap, copiedLink, dart, device, devices, firstSeatWins301, local, nakReq, onlyLocal, seen, shot, startRelays, step, table, tab, visibleCount,
} from "./lib.mjs"

const relays = await startRelays()
const wallets = []
let shuttingDown = false
async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const wallet of wallets) wallet.stop()
  await closeAll()
  await relays.stop()
  process.exit(code)
}
process.on("uncaughtException", async (error) => {
  console.error(error)
  await shutdown(2)
})
process.on("SIGINT", () => shutdown(130))

const profilePanel = (page) => page.locator('[data-tab-panel="profile"]')
// Back to the tabs: a reload brings a finished game's result screen back (no tab bar there);
// "Fertig" leaves it.
const home = async (page) => {
  await page.goto(BASE)
  await page.waitForTimeout(600)
  if (await isOnScreen(buttons(page, "Fertig"))) await tap(page, "Fertig")
}
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ")
const panelText = async (page) => (await profilePanel(page).innerText()).replace(/\s+/g, " ")

// The devices of the evening.
const anna = await device("anna-phone", { viewport: PHONE })
let annaTwo, annaThree, ben, carla, board
let backupPath = ""
let password = ""
let clubLink = ""
let tournamentLink = ""
const taps = {}

// ---- 1. A guest plays a 301 as before ------------------------------------------------------------
await step("Gast spielt 301 ohne Profil und ohne Netz", async (expect) => {
  const { page } = anna
  const t0 = Date.now()
  await page.goto(BASE)
  await button(page, /^X01/, 20_000)
  const ready = Date.now() - t0
  await shot(anna, "01-play-tab-guest")
  expect("the Play tab is ready to start a game", true, `lab: ${ready} ms to the X01 button`)
  await tap(page, /^X01/)
  await page.locator("main input").first().waitFor()
  const inputs = page.locator("main input")
  await inputs.nth(0).fill("Anna")
  await inputs.nth(1).fill("Ben")
  await page.getByRole("radio", { name: "301", exact: true }).first().click()
  await shot(anna, "02-setup-guest")
  await tap(page, "Spiel starten")
  await page.getByRole("button", { name: "Spieloptionen" }).waitFor({ timeout: 15_000 })
  taps.guestGame = "X01 → Spiel starten (2 taps with the names typed; 3 with 301 chosen)"
  await shot(anna, "03-game-guest")
  await firstSeatWins301(page)
  await seen(page, "Anna gewinnt")
  await shot(anna, "04-result-guest")
  expect("the result says 'Anna gewinnt'", true)
  expect("the result offers 'Deine Ergebnisse mitnehmen'", (await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).count()) === 1)
  expect("the guest's game opened no connection at all", anna.sockets.length === 0 && anna.foreign.length === 0, `${anna.sockets.length} sockets`)
})

// ---- 2. Into a profile from the result screen -------------------------------------------------
await step("Ergebnisse vom Ergebnisbildschirm in ein neues Profil", async (expect) => {
  const { page } = anna
  await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).click()
  await page.getByRole("radio", { name: "Anna" }).click()
  expect("the name is prefilled from the seat", (await page.getByLabel("Anzeigename").inputValue()) === "Anna")
  await shot(anna, "05-keep-sheet")
  await tap(page, "Profil anlegen")
  await seen(page, "Dein Profil ist angelegt", { timeout: 30_000 })
  expect("'Dein Profil ist angelegt' on the result", true)
  await tap(page, "Fertig")
  await page.waitForTimeout(600)
  await tab(page, "Profil")
  await profilePanel(page).getByText("Anna").first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await shot(anna, "06-profile-new")
  const t = await panelText(page)
  expect("the Profile tab shows Anna with her one game", /Anna/.test(t) && /1 Spiel|Spiele\s*1|1\s*Spiele/.test(t), t.slice(0, 160))
  expect("the profile asks to be backed up", t.includes("Noch nicht gesichert"))
  expect("only Anna's seat came along: one game, one win, on the sports card", /Siege\s*100\s*%\s*1 von 1/.test(t) && /X01 gegen andere/.test(t), t.match(/Siege[^X]*/)?.[0] ?? "")
})

// ---- 3. A second own device, by the typed code -----------------------------------------------
await step("Zweites eigenes Gerät koppeln (Code getippt)", async (expect) => {
  annaTwo = await device("anna-second", { viewport: SE, dark: true })
  const b = annaTwo.page
  await b.goto(BASE)
  await tab(b, "Profil")
  await tap(b, "Ich habe schon ein Profil")
  await tap(b, /Von meinem anderen Gerät/)
  await seen(b, "Oder gib dort diesen Code ein:", { timeout: 25_000 })
  await shot(annaTwo, "07-new-device-code")
  const code = (await text(b)).match(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/)?.[0]
  expect("the new device shows a code to type", !!code, code)
  const a = anna.page
  await profilePanel(a).getByRole("button", { name: /^Geräte/ }).click()
  await seen(a, "Dieses Gerät", { timeout: 25_000 })
  await tap(a, /^Eigenes Gerät hinzufügen/)
  await a.getByLabel("Code oder Link eingeben").fill(code.toLowerCase())
  await tap(a, "Öffnen")
  await seen(a, "Zugriff geben", { timeout: 30_000 })
  await seen(b, "Gerät gefunden", { timeout: 30_000 })
  const checkA = (await text(a)).match(/\d{4} \d{4}/)?.[0]
  const checkB = (await text(b)).match(/\d{4} \d{4}/)?.[0]
  expect("both devices show the same check code", !!checkA && checkA === checkB, `${checkA} / ${checkB}`)
  await shot(anna, "08-pair-give-access")
  await tap(b, "Ja, verbinden")
  await tap(a, "Zugriff geben")
  await seen(b, /ist dabei\./, { timeout: 30_000 })
  await shot(annaTwo, "09-paired-arrived")
  expect("the second phone says the profile is here", true)
  await tap(b, "Fertig")
  await profilePanel(b).getByText("Anna").first().waitFor({ timeout: 25_000 })
  expect("the second phone's Profile tab shows Anna", (await panelText(b)).includes("Anna"))
  await tap(a, "Fertig")
  await a.waitForTimeout(400)
  await tap(a, /Zurück zu Profil/)
  await a.waitForTimeout(500)
})

// ---- 4. Backup to a file ------------------------------------------------------------------------
await step("Profil in eine Sicherungsdatei sichern", async (expect) => {
  const { page } = anna
  await profilePanel(page).getByRole("button", { name: /^Sicherung/ }).click()
  await seen(page, "Dein Profil ist noch nicht gesichert.", { timeout: 15_000 })
  await tap(page, "Sicherungsdatei erstellen")
  const dialog = page.getByRole("dialog")
  await dialog.getByText("Dein Kennwort").waitFor({ timeout: 30_000 })
  password = (await dialog.innerText()).match(/[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}/)?.[0] ?? ""
  expect("a generated password is shown once", !!password)
  await shot(anna, "10-backup-password")
  // Into the password manager (the clipboard), then the file.
  await dialog.getByRole("button", { name: "Kennwort kopieren" }).click()
  expect("'Kennwort kopieren' copies it", (await page.evaluate(() => navigator.clipboard.readText())) === password)
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Datei speichern" }).click()])
  backupPath = join(OUT, download.suggestedFilename())
  await download.saveAs(backupPath)
  await dialog.getByText("Datei gespeichert").waitFor({ timeout: 15_000 })
  await dialog.getByRole("button", { name: "Fertig" }).click()
  await seen(page, "Dein Profil ist gesichert.")
  expect("the file is an encrypted backup without the name in clear", /^ncryptsec1/.test(JSON.parse(readFileSync(backupPath, "utf8")).ncryptsec ?? "") && !readFileSync(backupPath, "utf8").includes("Anna"))
  await tap(page, /Zurück zu Profil/)
  await page.waitForTimeout(600)
  expect("the Profile tab no longer asks for a backup", !(await panelText(page)).includes("Noch nicht gesichert"))
})

// ---- 5. Restore on a third device (English) ----------------------------------------------------
await step("Sicherung auf einem dritten Gerät öffnen (Englisch, dunkel)", async (expect) => {
  annaThree = await device("anna-third-en", { viewport: PHONE, locale: "en", dark: true })
  const { page } = annaThree
  await page.goto(BASE)
  await tab(page, "Profile")
  await tap(page, "I already have a profile")
  await tap(page, /From my backup/)
  await button(page, "Choose file", 25_000)
  await page.locator('input[type="file"]').setInputFiles(backupPath)
  await page.getByLabel("Password").fill(password)
  await shot(annaThree, "11-restore-en")
  await tap(page, "Open profile")
  await seen(page, /is here\./, { timeout: 30_000 })
  await shot(annaThree, "12-restored-en")
  expect("'Anna is here.' on the third device", (await text(page)).includes("is here."))
  await tap(page, "Done")
  await profilePanel(page).getByText("Anna").first().waitFor({ timeout: 25_000 })
  expect("the Profile tab shows Anna in English", (await panelText(page)).includes("Anna"))
})

// ---- 6. A club, and an invitation by link -------------------------------------------------------
await step("Club gründen und Ben per Link einladen", async (expect) => {
  const { page } = anna
  await tab(page, "Clubs")
  await tap(page, "Club gründen")
  await page.getByLabel("Name des Clubs").fill("Dartfreunde Nord")
  const nameField = page.getByLabel("Dein Name")
  expect("with a profile there is no name to type again", (await nameField.count()) === 0 || !(await nameField.isVisible()))
  await shot(anna, "13-club-create")
  await tap(page, "Club gründen")
  // The invite sheet opens by itself over "Dein Club steht", with the code already on it: no
  // form, no second tap.
  await button(page, "Link kopieren", 30_000)
  expect("the founded club opens its invitation by itself", await isOnScreen(page.getByText("Mitglieder einladen")))
  await shot(anna, "14-club-invite")
  clubLink = await copiedLink(page)
  expect("the invitation is a link", /#club=C1\./.test(clubLink), clubLink.slice(0, 40))
  expect("the code is there without an invitation form (no 'Einladung erstellen')", (await page.getByRole("button", { name: "Einladung erstellen" }).count()) === 0)
  await tap(page, "Fertig")
  await button(page, "Spiel starten", 15_000)
  expect("the club opens with 'Spiel starten' as its first action", true)
  taps.clubInvite = "Club gründen → (the code is on screen) → Link kopieren (1 tap after founding)"
})

// ---- 7. Ben joins as a guest and has a profile from then on ------------------------------------
await step("Ben tritt per Link als Gast bei und hat danach ein Profil", async (expect) => {
  ben = await device("ben-phone", { viewport: PHONE })
  const { page } = ben
  await page.goto(local(clubLink))
  await seen(page, "Einladung von Anna", { timeout: 30_000 })
  await shot(ben, "15-invitation-preview")
  await page.getByLabel("Dein Name").fill("Ben")
  await tap(page, "Beitreten")
  await seen(page, /Du bist dabei/, { timeout: 30_000 })
  expect("'Du bist dabei' after one name and one tap", true)
  await shot(ben, "16-joined")
  await tab(page, "Profil")
  await profilePanel(page).getByText("Ben").first().waitFor({ timeout: 20_000 })
  expect("Ben's Profile tab shows his new profile", !(await panelText(page)).includes("Profil anlegen"))
  await button(anna.page, /Spieler\s*2$/, 30_000)
  expect("Anna's club shows two members without a refresh", true)
})

// ---- 8. A club game from the club, watched live -------------------------------------------------
await step("Clubspiel aus dem Club, live mit Zuschauerin", async (expect) => {
  const { page } = anna
  await tap(page, "Spiel starten")
  await tap(page, "Ben")
  await tap(page, "Weiter zur Einrichtung")
  await button(page, "Spiel starten", 15_000)
  const seats = await page.evaluate(() => [...document.querySelectorAll("main input")].map((i) => i.value).filter(Boolean))
  expect("setup opens with the club's seats", seats.includes("Anna") && seats.includes("Ben"), seats.join(", "))
  await page.getByRole("radio", { name: "301", exact: true }).first().click()
  await tap(page, "Spiel starten")
  await page.getByRole("button", { name: "Spieloptionen" }).waitFor({ timeout: 15_000 })
  await page.getByRole("button", { name: "Spieloptionen" }).click()
  await tap(page, "Zuschauen lassen")
  await button(page, "Link kopieren", 20_000)
  await shot(anna, "17-watch-sheet")
  const watch = await copiedLink(page)
  expect("the watch link is a link", /#watch=W1\./.test(watch))
  await tap(page, "Fertig")
  carla = await device("carla-phone", { viewport: SE })
  await carla.page.goto(local(watch))
  await seen(carla.page, "Stand von", { timeout: 30_000 })
  for (const [s, m] of [[20, 3], [20, 3], [20, 3]]) await dart(page, s, m)
  const tapped = Date.now()
  await seen(carla.page, "121", { exact: true })
  expect("Carla sees Anna's 180 (121 left)", true, `lab: ${Date.now() - tapped} ms from the last dart to her screen`)
  await shot(carla, "18-spectator")
  for (const [s, m] of [[1], [1], [1], [20, 3], [11, 3], [14, 2]]) await dart(page, s, m)
  await seen(page, /Für Dartfreunde Nord eingetragen/, { timeout: 30_000 })
  await shot(anna, "19-club-result")
  expect("the result says 'Für Dartfreunde Nord eingetragen'", true)
  await seen(carla.page, "Anna gewinnt", { timeout: 20_000 }).catch(() => {})
  expect("the spectator sees the game end", (await visibleCount(carla.page, /Anna gewinnt|Spiel beendet/)) > 0)
})

// ---- 9. Ben confirms the result -----------------------------------------------------------------
await step("Ben bestätigt das Clubergebnis auf seinem Telefon", async (expect) => {
  const { page } = ben
  await page.reload()
  await tab(page, "Clubs")
  const task = await button(page, /Ergebnis bestätigen: Anna – Ben/, 30_000)
  await shot(ben, "20-club-task")
  await task.click()
  await tap(page, "Stimmt")
  await seen(page, "Bestätigt.", { timeout: 30_000 })
  expect("'Bestätigt.' after two taps from the Clubs tab", true)
  await tap(page, "Fertig")
  taps.confirmClubResult = "Clubs → task row → Stimmt (2 taps in the Clubs tab)"
  // What Ben finds in his own profile afterwards.
  await tab(page, "Profil")
  await page.waitForTimeout(2000)
  const own = await panelText(page)
  expect.note("Ben's confirmed club game shows in his own profile (games, statistics)", !own.includes("Noch kein Spiel gegen andere"), own.slice(0, 120))
  await tab(page, "Clubs")
})

// ---- 10. A small tournament ---------------------------------------------------------------------
await step("Turnier anlegen: 4 Plätze, ein Gast, Board 1", async (expect) => {
  const { page } = anna
  await tap(page, "Fertig", 2000).catch(() => {})
  await tab(page, "Turniere")
  await tap(page, "Turnier erstellen")
  await seen(page, "Schritt 1 von 4")
  await page.getByLabel("Titel").fill("Pub Open")
  await page.getByLabel("Ort").fill("Goldener Anker")
  await tap(page, "Weiter")
  await seen(page, "Schritt 2 von 4")
  await page.getByRole("radio", { name: "301", exact: true }).first().click()
  await page.getByRole("radiogroup", { name: "Legs pro Spiel" }).getByRole("radio", { name: "1", exact: true }).click()
  await tap(page, "Weiter")
  await seen(page, "Schritt 3 von 4")
  await page.getByRole("radiogroup", { name: "Plätze" }).getByRole("radio", { name: "4", exact: true }).click()
  await page.getByLabel("Gäste ohne Profil").fill("Mia")
  await page.getByLabel("Boards").fill("Board 1")
  await tap(page, "Weiter")
  await seen(page, "Schritt 4 von 4")
  await shot(anna, "21-tournament-preview")
  await tap(page, "Turnier veröffentlichen")
  // The share sheet opens by itself over "Dein Turnier ist veröffentlicht", with the code.
  await button(page, "Link kopieren", 40_000)
  expect("the published tournament opens its code by itself", await isOnScreen(page.getByText("Turnier teilen")))
  tournamentLink = await copiedLink(page)
  expect("the tournament link", /#tournament=T1\./.test(tournamentLink))
  await tap(page, "Fertig")
  await tap(page, "Zum Turnier")
  await button(page, "Leiten", 15_000)
  expect("the organizer's way in is 'Leiten' in the bar", true)
  await tap(page, "Selbst mitspielen")
  await seen(page, "Du bist angemeldet", { timeout: 30_000 })
  expect("Anna plays along", true)
})

await step("Ben und Carla melden sich an", async (expect) => {
  await ben.page.goto(local(tournamentLink))
  await seen(ben.page, /Plätze? frei/, { timeout: 30_000 })
  await shot(ben, "22-tournament-register")
  await tap(ben.page, "Anmelden")
  await seen(ben.page, "Du bist angemeldet", { timeout: 40_000 })
  await carla.page.goto(local(tournamentLink))
  await carla.page.getByLabel("Dein Name").fill("Carla")
  await tap(carla.page, "Anmelden")
  await seen(carla.page, "Du bist angemeldet", { timeout: 40_000 })
  expect("both are admitted without anyone tapping on Anna's phone", true)
  await tap(anna.page, "Leiten")
  await seen(anna.page, "Angemeldet (4)", { timeout: 30_000 })
  await shot(anna, "23-organize-players")
  expect("Anna's workspace lists four players: Anna, Ben, Carla and the guest Mia", true)
})

await step("Check-in und Auslosung", async (expect) => {
  const { page } = anna
  await seen(page, "Jetzt dran")
  await tap(page, "Check-in öffnen")
  for (const d of [ben, carla]) {
    await seen(d.page, "Ich bin da", { timeout: 40_000 })
    await tap(d.page, "Ich bin da")
    await seen(d.page, "Du bist eingecheckt", { timeout: 30_000 })
  }
  await shot(carla, "24-checked-in")
  await tap(page, "Auslosen")
  // Anna, the organizer, checks herself in from the draw sheet.
  if (await isOnScreen(buttons(page, "Alle als da melden"))) await tap(page, "Alle als da melden")
  await seen(page, "4 Spieler im Feld", { timeout: 30_000 })
  await shot(anna, "24-draw-sheet")
  await tap(page, "Jetzt auslosen")
  await tap(page, "Turnier starten")
  await seen(page, "Läuft", { timeout: 30_000 })
  expect("the tournament runs with four players", true)
})

// One match on the board: called by Anna, played on the tablet, approved by Anna.
async function playOnBoard(expect, n) {
  const { page } = anna
  await page.getByRole("radio", { name: "Boards", exact: true }).click()
  // "Jetzt dran" names the next call: "Anna – Ben an Board 1 aufrufen".
  await tap(page, / aufrufen$/)
  await seen(page, "Aufgerufen:", { timeout: 30_000 })
  const b = board.page
  await seen(b, "Jetzt an diesem Board", { timeout: 30_000 })
  const pairing = (await text(b)).match(/Jetzt an diesem Board\s*(.*?)\s*Spiel starten/)?.[1] ?? ""
  if (n === 1) await shot(board, "26-board-called")
  await tap(b, "Spiel starten")
  await b.getByRole("button", { name: "Spieloptionen" }).waitFor({ timeout: 30_000 })
  if (n === 1) {
    // Ben's phone, on the tournament page: the strip "Gerade an den Boards" shows the match as
    // it is played, with the legs.
    await ben.page.goto(local(tournamentLink))
    await seen(ben.page, "Gerade an den Boards", { timeout: 30_000 })
    for (const [s, m] of [[20, 3], [20, 3], [20, 3]]) await dart(b, s, m)
    await ben.page.waitForTimeout(1500)
    await shot(ben, "29-tournament-live")
    expect("a player's phone shows what is on the boards right now", true)
    for (const [s, m] of [[1], [1], [1], [20, 3], [11, 3], [14, 2]]) await dart(b, s, m)
  } else await firstSeatWins301(b)
  const back = b.locator("button:visible", { hasText: "Zurück zum Board" }).first()
  await back.waitFor({ timeout: 20_000 })
  if (n === 1) {
    await shot(board, "27-board-result")
    expect("the board's result says it goes to the tournament", await isOnScreen(b.getByText(/Ergebnis (wird|ans Turnier) gemeldet/)))
  }
  await back.click()
  await seen(b, "Ergebnis gemeldet", { timeout: 30_000 })
  await page.getByRole("radio", { name: "Ergebnisse", exact: true }).click()
  await button(page, "Freigeben", 30_000)
  if (n === 1) await shot(anna, "28-approve")
  await tap(page, "Freigeben")
  await page.waitForTimeout(1500)
  expect(`match ${n} reported by the board and approved`, true, pairing)
}

await step("Board-Gerät: Aufruf, Spiel, Meldung, Freigabe (2 Halbfinals)", async (expect) => {
  const { page } = anna
  await page.getByRole("radio", { name: "Boards", exact: true }).click()
  await tap(page, /^Board 1/)
  const boardUrl = await copiedLink(page)
  await tap(page, "Fertig")
  board = await device("board-tablet", { viewport: BOARD })
  await board.page.goto(local(boardUrl))
  await seen(board.page, "Dieses Gerät wird zum Board", { timeout: 30_000 })
  await shot(board, "25-board-become")
  await tap(board.page, "Board verwenden")
  await playOnBoard(expect, 1)
  await playOnBoard(expect, 2)
})

await step("Finale, Turnier beenden mit Auszeichnungen", async (expect) => {
  await playOnBoard(expect, 3)
  const { page } = anna
  await tap(page, "Turnier beenden")
  const alert = page.getByRole("alertdialog")
  await alert.waitFor({ timeout: 15_000 })
  const said = await alert.innerText()
  await shot(anna, "29-finish")
  expect("finishing says who gets a badge", /bekommen? eine Auszeichnung/.test(said), said.replace(/\s+/g, " ").slice(0, 120))
  await alert.getByRole("button", { name: "Turnier beenden" }).click()
  await seen(page, "Beendet", { exact: true, timeout: 30_000 })
  await seen(ben.page, "Turnier beendet", { timeout: 40_000 })
  await shot(ben, "30-tournament-finished-player")
  const over = await text(ben.page)
  expect("Ben's tournament page says it is over and names the winner", /Turniersieger: /.test(over))
  expect.note("Ben's place reads plainly (no 'Platz: Platz')", !/Dein Platz: Platz/.test(over), over.match(/Dein Platz: [^.]*?\d/)?.[0] ?? "")
  await page.waitForTimeout(3000)
  expect("Anna's workspace has no badges left to give", !(await isOnScreen(page.getByText("Auszeichnungen vergeben"))))
})

// ---- 11. The badge on the profile card -----------------------------------------------------------
await step("Auszeichnung erscheint auf Bens Profilkarte", async (expect) => {
  const { page } = ben
  // The finished tournament, opened again later (the app loaded anew): it says where Ben's badge is
  // and puts it on his card with one tap.
  await page.goto(BASE)
  await page.goto(local(tournamentLink))
  const show = await button(page, "Im Profil zeigen", 30_000)
  const said = await text(page)
  await shot(ben, "31-tournament-badge")
  expect("the tournament page says where Ben's badge is", /Deine Auszeichnung „(Dabei|Turniersieg|Finalist)“ liegt unter Profil › Auszeichnungen/.test(said), said.match(/Deine Auszeichnung[^.]*\./)?.[0] ?? "")
  expect.note("the promise sentence is gone once the badge is given", !/sobald die Leitung sie vergibt/.test(said))
  await show.click()
  await seen(page, /steht auf deiner Profilkarte/, { timeout: 20_000 })
  taps.badgeToCard = "Turnier → Im Profil zeigen (1 tap)"
  await page.goto(BASE)
  await tab(page, "Profil")
  await page.waitForTimeout(2500)
  const chip = profilePanel(page).getByRole("button", { name: /^(Dabei|Turniersieg|Finalist)/ })
  await chip.first().waitFor({ timeout: 20_000 })
  await shot(ben, "32-profile-card-badge")
  expect("the profile card shows the tournament badge", (await chip.count()) >= 1, (await chip.allTextContents()).join(", "))
  const card = await panelText(page)
  expect.note("after three games tonight Ben's profile counts games", !card.includes("Noch kein Spiel gegen andere"), card.slice(0, 100))
})

// ---- 11b. The evening in the Rangliste ----------------------------------------------------------
await step("Rangliste heute Abend: Hier gespielt, Clubs, Turniere auf Annas Telefon", async (expect) => {
  const { page } = anna
  await home(page)
  await tab(page, "Rangliste")
  const panel = page.locator('[data-tab-panel="leaderboard"]')
  await seen(page, /Spiele gegen andere auf diesem Gerät/, { timeout: 20_000 })
  // Two games against Ben tonight: within "Heute" that ranks both (2 games), over all time not yet.
  await panel.getByRole("button", { name: /^Zeitraum: / }).click()
  await page.getByRole("menuitemradio", { name: "Heute" }).click()
  await page.waitForTimeout(600)
  const today = await panel.innerText()
  // seen() scrolled the sentence into view; the picture shows the list from its top.
  await page.evaluate(() => document.querySelectorAll("*").forEach((el) => { if (el.scrollTop > 0) el.scrollTop = 0 }))
  await shot(anna, "33-ranks-today")
  expect("the list says what it counts: this device, today, games and players", /heute: \d+ Spiele?, \d+ Spieler\./.test(today), today.match(/auf diesem Gerät[^.]*\./)?.[0] ?? today.slice(0, 120))
  expect("Anna and Ben stand in tonight's list, Anna marked as you", today.includes("Anna") && today.includes("Ben") && /\bDu\b/.test(today))
  expect("a rank is a win rate with its games, not a point total", /\d+\s%/.test(today) && /\d Spiele?\s·\s\d Sieg/.test(today), today.match(/Anna.{0,60}/)?.[0] ?? "")
  await panel.getByRole("radio", { name: "Clubs" }).click()
  await seen(page, /Dartfreunde Nord/, { timeout: 20_000 })
  const clubs = await panel.innerText()
  await shot(anna, "34-ranks-clubs")
  // The evening's club has no season yet: the card says so and offers no table into nothing.
  expect("the Clubs area shows the club with its season state", /Dartfreunde Nord/.test(clubs) && (/Ganze Tabelle/.test(clubs) || /Keine laufende Saison/.test(clubs)), clubs.slice(0, 120))
  await panel.getByRole("radio", { name: "Turniere" }).click()
  await seen(page, /Pub Open/, { timeout: 20_000 })
  const tournaments = await panel.innerText()
  await shot(anna, "35-ranks-tournaments")
  expect("the Turniere area lists tonight's tournament with Anna's place", /Pub Open/.test(tournaments) && /\d\. Platz|Sieg|Platz/.test(tournaments), tournaments.slice(0, 160))
  await panel.getByRole("radio", { name: "Hier gespielt" }).click()
})

// ---- 12. A stake, paid once ---------------------------------------------------------------------
await step("Einsatz 500 sats: Anna zahlt Ben mit der Wallet, genau einmal", async (expect) => {
  const payer = await startFakeWallet({ relay: RELAYS[0], balanceMsat: 50_000_000 })
  const payee = await startFakeWallet({ relay: RELAYS[0], notifications: true })
  wallets.push(payer, payee)
  // Ben connects his wallet and shows a payment code.
  const b = ben.page
  await tab(b, "Profil")
  await profilePanel(b).getByRole("button", { name: /^Zahlungen/ }).click()
  await tap(b, "Wallet verbinden")
  const field = b.getByLabel("Verbindung einfügen").last()
  await field.fill(payee.uri)
  await field.press("Enter")
  // Pasted by hand, the connection is taken at once (a wallet app's answer would ask first).
  if (await button(b, "Verbinden", 3000).then(() => true, () => false)) await tap(b, "Verbinden")
  await seen(b, "Verbunden", { exact: true, timeout: 20_000 })
  await tap(b, "Fertig")
  // Anna's game with the stake: Ben wins.
  const a = anna.page
  await a.goto(BASE)
  await tab(a, "Spielen")
  await tap(a, /^X01/)
  const inputs = a.locator("main input")
  await inputs.nth(0).fill("Anna")
  await inputs.nth(1).fill("Ben")
  await a.getByRole("radio", { name: "301", exact: true }).first().click()
  await a.getByRole("button", { name: /^Einsatz/ }).click()
  await a.getByRole("radio", { name: "500" }).click()
  await a.getByRole("dialog").getByRole("button", { name: "Übernehmen" }).click()
  await tap(a, "Spiel starten")
  await a.getByRole("button", { name: "Spieloptionen" }).waitFor({ timeout: 15_000 })
  for (const [s, m] of [[1], [1], [1], [20, 3], [20, 3], [20, 3], [1], [1], [1], [20, 3], [17, 3], [5, 2]]) await dart(a, s, m)
  const row = await button(a, "500 sats an Ben zahlen")
  await shot(anna, "33-result-stake")
  const marks = await row.evaluate((el) => {
    const signet = el.querySelector("span.inline-flex")
    const label = [...el.querySelectorAll("span")].find((s) => /^500 sats/.test(s.textContent ?? ""))
    return signet && label ? { signetRight: Math.round(Math.max(...[...signet.querySelectorAll("img")].map((i) => i.getBoundingClientRect().right))), labelLeft: Math.round(label.getBoundingClientRect().left) } : null
  })
  expect.note("the stake row's Bitcoin and NWC marks stay clear of its words", marks && marks.signetRight <= marks.labelLeft, JSON.stringify(marks))
  // Ben's code.
  await b.getByRole("button", { name: "Geld empfangen" }).click()
  const amount = b.getByRole("dialog").getByRole("radio", { name: "500", exact: true })
  if (await amount.count()) await amount.click()
  else await b.getByRole("dialog").getByRole("textbox").first().fill("500")
  await b.getByRole("dialog").getByRole("button", { name: "Zahlungscode erstellen" }).click()
  await seen(b, "Warte auf Zahlung", { timeout: 20_000 })
  await shot(ben, "34-receive-code")
  const code = await copiedLink(b, "Code kopieren")
  expect("Ben's phone shows a payment code", /^(lightning:)?ln/i.test(code), code.slice(0, 16))
  // Anna pays it.
  await row.click()
  const sheet = a.getByRole("dialog")
  // Anna's profile is a seat of this game: the sheet knows she pays and goes straight to it.
  expect("the stake sheet says who pays whom", (await sheet.innerText()).includes("Anna zahlt 500 sats an Ben"))
  await shot(anna, "35-stake-connect")
  await sheet.getByLabel("Verbindung einfügen").fill(payer.uri)
  await sheet.getByLabel("Verbindung einfügen").press("Enter")
  await sheet.getByLabel("Zahlungscode einfügen").waitFor({ timeout: 20_000 })
  await sheet.getByLabel("Zahlungscode einfügen").fill(code)
  await sheet.getByLabel("Zahlungscode einfügen").press("Enter")
  const pay = sheet.getByRole("button", { name: "500 sats an Ben zahlen" })
  await pay.waitFor({ timeout: 20_000 })
  await shot(anna, "36-pay-review")
  // A darts-night double tap.
  await pay.dblclick()
  await sheet.getByText("sind bei Ben angekommen").waitFor({ timeout: 40_000 })
  await shot(anna, "37-paid")
  expect("'500 sats sind bei Ben angekommen'", true)
  const hashes = [...payer.paid.entries()]
  expect("the wallet was asked to pay exactly once (double tap included)", payer.requests.filter((m) => m === "pay_invoice").length === 1 && hashes.length === 1 && hashes[0][1] === 1, JSON.stringify(payer.requests))
  // The money arrives in Ben's wallet: his open code says so.
  await payee.settle(hashes[0][0])
  await seen(b, "sind in deiner Wallet angekommen", { timeout: 40_000 })
  await shot(ben, "38-received")
  expect("Ben's phone says the 500 sats arrived", true)
  await sheet.getByRole("button", { name: "Fertig" }).click()
  await a.waitForTimeout(800)
  const after = await button(a, /500 sats/)
  const rowText = await after.innerText()
  expect("the result row now says paid and offers no second payment", !/zahlen$/.test(rowText.trim()), rowText.replace(/\s+/g, " "))
  await after.click()
  await a.waitForTimeout(800)
  expect("reopened, the sheet has no pay button", (await a.getByRole("dialog").getByRole("button", { name: "500 sats an Ben zahlen" }).count()) === 0)
  await a.keyboard.press("Escape")
  expect("still one payment in the wallet", payer.requests.filter((m) => m === "pay_invoice").length === 1)
})

// ---- 13. A member invites by the spoken code ----------------------------------------------------
await step("Ben (Mitglied) lädt Carl per Code ein, Anna nimmt ihn auf", async (expect) => {
  const b = ben.page
  await home(b)
  await tab(b, "Clubs")
  await tap(b, /^Dartfreunde Nord/)
  // The club lets its members invite (founded that way): Ben's tile says "Einladen", and his
  // link carries the code to say aloud.
  await tap(b, "Einladen", 20_000)
  await seen(b, "Oder Code eingeben", { timeout: 30_000 })
  const memberCode = (await text(b)).match(/\b[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\b/)?.[0]
  expect("a member's invitation shows a code to say aloud", !!memberCode, memberCode)
  await seen(b, /ein Verantwortlicher bestätigt/, { timeout: 15_000 })
  expect("the line says a leader confirms", true)
  await shot(ben, "38-member-invite-code")
  await tap(b, "Fertig")

  // Carl has heard the code: Clubs → Code scannen → type it.
  const carl = await device("carl-phone", { viewport: PHONE })
  const c = carl.page
  await c.goto(BASE)
  await tab(c, "Clubs")
  await tap(c, "Code scannen")
  await c.getByLabel("Link oder Club-Code eingeben").fill(memberCode.toLowerCase().replace("-", " "))
  await shot(carl, "39-code-typed")
  await tap(c, "Öffnen")
  await seen(c, "Einladung von Ben", { timeout: 30_000 })
  expect("the typed code opens Ben's invitation", true)
  await c.getByLabel("Dein Name").fill("Carl")
  await tap(c, "Beitritt anfragen")
  await seen(c, /Deine Anfrage wartet auf Bestätigung/, { timeout: 30_000 })
  expect("a member's link only asks: Carl waits for a leader", true)
  taps.codeJoin = "Clubs → Code scannen → Code tippen → Öffnen → Name → Beitritt anfragen"

  // Anna sees the request as her club's task, with who invited him.
  const a = anna.page
  await home(a)
  await tab(a, "Clubs")
  await tap(a, /^Dartfreunde Nord/)
  await tap(a, /Anfrage wartet/, 30_000)
  await seen(a, "Eingeladen von Ben", { timeout: 30_000 })
  await shot(anna, "40-request-invited-by")
  await tap(a, "Aufnehmen")
  await seen(c, /Du bist dabei/, { timeout: 30_000 })
  expect("after Anna's OK Carl is in", true)
})

// ---- 14. An invitation straight to a profile ----------------------------------------------------
await step("Anna lädt Carla direkt an ihr Profil ein", async (expect) => {
  // Carla's profile code, as her phone would show it to Anna's camera.
  const k = carla.page
  await home(k)
  await tab(k, "Profil")
  await profilePanel(k).getByRole("button", { name: "Profil teilen" }).click()
  const profileLink = await copiedLink(k)
  expect("Carla's profile has a code to scan", /#p=|#profile=/.test(profileLink) || profileLink.includes("npub"), profileLink.slice(0, 40))
  await tap(k, "Fertig")

  const a = anna.page
  await home(a)
  await tab(a, "Clubs")
  await tap(a, /^Dartfreunde Nord/)
  await tap(a, "Einladen", 20_000)
  await button(a, "Link kopieren", 30_000)
  await tap(a, "An eine Person senden")
  await seen(a, "Person einladen", { timeout: 15_000 })
  await shot(anna, "41-invite-person")
  await tap(a, "Profilcode scannen")
  await a.getByLabel("Profilcode scannen").fill(profileLink)
  await tap(a, "Öffnen")
  // The scanned profile is confirmed by name before anything goes out.
  await seen(a, "Gefundenes Profil", { timeout: 20_000 })
  await seen(a, "Carla", { timeout: 20_000 })
  await shot(anna, "42-person-found")
  await tap(a, "Einladen")
  await seen(a, /Einladung an .* gesendet/, { timeout: 30_000 })
  expect("the invitation is sent to Carla's profile", true)
  await shot(anna, "43-invitation-sent")
  // "Fertig" leaves the person sheet for the invite sheet behind it; once more closes that.
  await tap(a, "Fertig")
  await button(a, "Link kopieren", 10_000)
  await tap(a, "Fertig")
  await button(a, "Spiel starten", 10_000)
  taps.inviteToPerson = "Club → Einladen → An eine Person senden → Profilcode scannen (Code) → Einladen → 'Einladung gesendet' (4 taps after the club)"

  // On Carla's phone the invitation is under Clubs, without a link or a scan.
  await tab(k, "Clubs")
  await seen(k, "Einladungen", { timeout: 45_000 })
  await shot(carla, "44-invitation-arrived")
  expect("Carla's Clubs tab shows the invitation by itself", true)
  await tap(k, "Beitreten")
  await seen(k, "Einladung von Anna", { timeout: 20_000 })
  // A personal invitation asks a leader to confirm the person (club.md).
  await tap(k, "Beitritt anfragen")
  await seen(k, /Deine Anfrage wartet/, { timeout: 30_000 })
  expect("Carla asks with one tap; Anna confirms", true)
  await tap(a, /Anfrage wartet/, 30_000)
  await tap(a, "Aufnehmen")
  await seen(k, /Du bist dabei/, { timeout: 30_000 })
  expect("Carla's phone says she is in as soon as Anna confirms", true)
  await tap(a, /Zurück zu Dartfreunde Nord/)
  await button(a, /Spieler\s*4$/, 30_000)
  expect("Anna's club counts four players", true)
})

// ---- The whole evening --------------------------------------------------------------------------
await step("Ganzer Abend: nur lokale Verbindungen, keine Seitenfehler", async (expect) => {
  for (const d of devices) expect(`${d.label}: only the app and the local relays`, onlyLocal(d), [...new Set(d.sockets.filter((u) => !u.startsWith("ws://127.0.0.1:")))].concat(d.foreign).slice(0, 3).join(", "))
  for (const d of devices) expect(`${d.label}: no page errors`, d.errors.length === 0, d.errors.slice(0, 2).join(" | "))
  expect("the relays hold the evening's records", nakReq(["-k", "1180", "-l", "500"]).length > 0)
})

if (process.env.MATRIX === "1" && allPassed()) {
  const { runMatrix } = await import("./hig-matrix.mjs")
  const annaState = join(OUT, "anna-state.json")
  await anna.ctx.storageState({ path: annaState, indexedDB: true })
  console.log("\n# HIG matrix")
  const t0 = Date.now()
  const matrix = await runMatrix({ annaState })
  console.log(`  ${matrix.filter((r) => r.ok).length}/${matrix.length} matrix checks hold (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
}

console.log(`\n${table()}\n`)
if (notes.length) console.log(`Notes (findings about the app):\n${notes.map((n) => `  - [${n.step}] ${n.what}${n.detail ? ` (${n.detail})` : ""}`).join("\n")}\n`)
console.log("Taps:", JSON.stringify(taps, null, 1))
const flagged = audits.filter((a) => a.problems.length > 0)
console.log(`\nLayout audit: ${audits.length} screenshots, ${flagged.length} with remarks`)
for (const a of flagged) console.log(`  ${a.file} (${a.device} ${a.size}): ${a.problems.join("; ")}`)
console.log(`\nScreenshots in ${OUT}`)
await shutdown(allPassed() ? 0 : 1)
