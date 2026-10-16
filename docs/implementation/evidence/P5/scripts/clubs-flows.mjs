// Club flows (P5.01, P5.02) against a production build whose relays are two local "nak serve"
// (NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20602,ws://127.0.0.1:20603), with two browser
// contexts as two phones: Olaf founds a closed club as a guest (profile made on the way),
// invites; Ben opens the link, sees the preview, joins while Olaf's device is open; Olaf's
// device shares access, enters a club night and a season, plays a club game against Ben from
// the club; Ben answers the date and confirms the result from his phone; the table counts it;
// the export downloads. Then a screenshot matrix over sizes and both languages.
//   node docs/implementation/evidence/P5/scripts/clubs-flows.mjs   (BASE, OUT optional)
import { chromium } from "playwright"
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { connect } from "node:net"

const BASE = process.env.BASE ?? "http://localhost:3321"
const OUT = process.env.OUT ?? "/tmp/blueline-clubs-shots"
mkdirSync(OUT, { recursive: true })
const NAK = "/opt/homebrew/bin/nak"
const PORTS = [20602, 20603]
const RELAYS = PORTS.map((port) => `ws://127.0.0.1:${port}`)
const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}
const query = (args) =>
  execFileSync(NAK, ["req", ...args, ...RELAYS], { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

// --- Local relays -----------------------------------------------------------------------------
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1")
    socket.once("connect", () => (socket.destroy(), resolve(true)))
    socket.once("error", () => resolve(false))
  })
const relays = []
for (const port of PORTS) {
  if (await portOpen(port)) continue
  relays.push(spawn(NAK, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: "ignore" }))
}
for (let i = 0; i < 100 && !(await portOpen(PORTS[0])) ; i++) await new Promise((r) => setTimeout(r, 100))

// --- Browser -------------------------------------------------------------------------------------
const browser = await chromium.launch()
async function open({ viewport = { width: 390, height: 844 }, locale = "de-DE", dark = false, storageState } = {}) {
  const ctx = await browser.newContext({ viewport, locale, hasTouch: true, isMobile: viewport.width < 900, serviceWorkers: "block", colorScheme: dark ? "dark" : "light", storageState })
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE })
  await ctx.addInitScript((theme) => localStorage.setItem("theme", theme), dark ? "dark" : "light")
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  return { ctx, page, errors }
}
const wait = (page, ms = 600) => page.waitForTimeout(ms)
const tab = (page, name) => page.getByRole("navigation", { name: /Bereiche|Sections/ }).last().getByRole("button", { name, exact: true })
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` })
const layout = (page) =>
  page.evaluate(() => ({
    ellipsis: [...document.querySelectorAll("body *")].some((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1),
    hscroll: [...document.querySelectorAll("[data-scroll-container], body")].some((el) => el.scrollWidth > el.clientWidth + 1),
  }))
// A dart on the keypad: with Double or Triple pressed first, the keys read "D14" or "T20".
const dart = async (page, segment, multiplier = 1) => {
  if (multiplier === 3) await page.getByRole("button", { name: "Triple", exact: true }).click()
  if (multiplier === 2) await page.getByRole("button", { name: "Double", exact: true }).click()
  await page.getByRole("button", { name: new RegExp(`^${multiplier === 3 ? "T" : multiplier === 2 ? "D" : ""}\\s?${segment}$`) }).first().click()
  await wait(page, 250)
}

// A stalled step leaves both phones' screens behind for the record.
const phones = []
process.on("uncaughtException", async (error) => {
  console.error(error)
  for (const [name, phone] of phones) await phone.page.screenshot({ path: `${OUT}/failure-${name}.png` }).catch(() => {})
  for (const relay of relays) relay.kill("SIGTERM")
  process.exit(1)
})

// --- Olaf founds a closed club as a guest and invites ----------------------------------------
const A = await open()
phones.push(["olaf", A])
await A.page.goto(BASE)
await A.page.waitForLoadState("networkidle")
await tab(A.page, "Clubs").click()
await wait(A.page, 1200)
await A.page.getByRole("button", { name: "Club gründen" }).first().click()
await A.page.getByLabel("Name des Clubs").waitFor({ timeout: 15000 })
await A.page.getByLabel("Name des Clubs").fill("Dartfreunde Nord")
await A.page.getByLabel("Beschreibung (optional)").fill("Donnerstags im Vereinsheim")
check("a guest gets one name field on the founding screen, no sign-in wall", await A.page.getByLabel("Dein Name").isVisible())
await A.page.getByLabel("Dein Name").fill("Olaf")
await shot(A.page, "create-de")
await A.page.getByRole("button", { name: "Club gründen", exact: true }).click()
await A.page.getByText("Dein Club steht").waitFor({ timeout: 30000 })
await wait(A.page, 800)
await shot(A.page, "founded-de")
const foundings = query(["-k", "1180"])
check("the closed club's founding reached the relays sealed", foundings.length >= 1 && foundings.every((e) => !JSON.stringify(e).includes("Dartfreunde")), `${foundings.length} records`)

await A.page.getByRole("button", { name: "Mitglieder einladen" }).click()
await A.page.getByRole("button", { name: "Einladung erstellen" }).waitFor({ timeout: 15000 })
await wait(A.page, 500)
await shot(A.page, "invite-sheet-de")
await A.page.getByRole("button", { name: "Einladung erstellen" }).click()
await A.page.getByRole("button", { name: "Link kopieren" }).waitFor({ timeout: 30000 })
await wait(A.page, 800)
await shot(A.page, "invite-code-de")
await A.page.getByRole("button", { name: "Link kopieren" }).click()
const link = await A.page.evaluate(() => navigator.clipboard.readText())
check("the invitation link carries the club, the invite and its secret", /\/#club=C1\.[^.]+\.[^.]+\.[^.]+\./.test(link), link.slice(0, 70))
const invites = query(["-k", "1180"]).filter((e) => e.tags.some((t) => t[0] === "l" && t[1] === "club.invite"))
check("the invite record is sealed and never names the secret", invites.length === 1 && !JSON.stringify(invites[0]).includes(link.split(".")[3] ?? "?"), `${invites.length} invites`)
await A.page.getByRole("button", { name: "Fertig" }).click()
await A.page.getByRole("button", { name: "Spiel starten" }).waitFor({ timeout: 15000 })
await wait(A.page, 800)
await shot(A.page, "club-owner-alone-de")
check("no console errors (founding)", A.errors.length === 0, A.errors.join(" | "))

// --- Ben opens the link on his phone -----------------------------------------------------------
const B = await open()
phones.push(["ben", B])
await B.page.goto(link.replace(/^https?:\/\/[^/]+/, BASE))
await B.page.waitForLoadState("networkidle")
await B.page.getByText("Einladung von Olaf").waitFor({ timeout: 30000 })
await wait(B.page, 500)
check("the preview shows name and description before any profile exists", (await B.page.getByText("Dartfreunde Nord").count()) >= 1 && (await B.page.getByText("Donnerstags im Vereinsheim").count()) >= 1)
await shot(B.page, "invitation-de")
await B.page.getByLabel("Dein Name").fill("Ben")
await B.page.getByRole("button", { name: "Beitreten", exact: true }).click()
await B.page.getByText(/Du bist dabei/).waitFor({ timeout: 30000 })
await wait(B.page, 500)
await shot(B.page, "joined-de")
check("joining through a group link needs no leader online", (await B.page.getByText(/Sobald ein Verantwortlicher/).count()) === 1)
check("no console errors (joining)", B.errors.length === 0, B.errors.join(" | "))

// --- Olaf's open device sees the member and shares access ---------------------------------------
await A.page.getByRole("button", { name: /Spieler\s*2$/ }).waitFor({ timeout: 30000 })
check("the owner's open screen shows the new member without a refresh", true)
await A.page.getByRole("button", { name: "Aktualisieren" }).click()
await wait(A.page, 4000)
const shares = query(["-k", "1180"]).filter((e) => e.tags.some((t) => t[0] === "l" && t[1] === "club.keys"))
check("the owner's device shared access to earlier records", shares.length >= 1, `${shares.length} key shares`)

// --- Olaf enters a club night and sets up a season ------------------------------------------------
await A.page.getByRole("button", { name: /^Termine & Turniere/ }).click()
await A.page.getByRole("button", { name: "Termin eintragen" }).waitFor({ timeout: 15000 })
await A.page.getByRole("button", { name: "Termin eintragen" }).click()
await A.page.getByRole("button", { name: "Eintragen", exact: true }).waitFor()
await A.page.getByLabel("Ort (optional)").fill("Vereinsheim")
await A.page.getByRole("radio", { name: "4×", exact: true }).click()
await wait(A.page, 300)
await shot(A.page, "date-form-de")
await A.page.getByRole("button", { name: "Eintragen", exact: true }).click()
await A.page.getByRole("button", { name: /Clubabend.*Vereinsheim/ }).first().waitFor({ timeout: 30000 })
await wait(A.page, 500)
check("a weekly club night becomes four dates", (await A.page.getByRole("button", { name: /Clubabend/ }).count()) === 4)
await shot(A.page, "dates-de")
await A.page.getByRole("button", { name: /^Zurück/ }).click()
await wait(A.page, 800)
await A.page.getByRole("button", { name: /Noch keine Saison/ }).click()
await A.page.getByLabel("Name").first().waitFor({ timeout: 15000 })
await A.page.getByLabel("Name").first().fill("Herbst 2026")
// The quick game below is a 301; by default only 501 counts.
await A.page.getByRole("button", { name: "301", exact: true }).click()
await shot(A.page, "season-form-de")
await A.page.getByRole("button", { name: "Saison starten" }).click()
await A.page.getByRole("button", { name: /Herbst 2026/ }).waitFor({ timeout: 30000 })
check("the season shows on the club with the person's standing", /Du stehst noch nicht/.test(await A.page.getByRole("button", { name: /Herbst 2026/ }).textContent()))
await wait(A.page, 500)
await shot(A.page, "club-owner-de")
check("no console errors (dates, season)", A.errors.length === 0, A.errors.join(" | "))

// --- Ben answers the club night -----------------------------------------------------------------
await B.page.reload()
await B.page.waitForLoadState("networkidle")
await tab(B.page, "Clubs").click()
await B.page.getByRole("button", { name: /Dartfreunde Nord/ }).first().waitFor({ timeout: 30000 })
await wait(B.page, 2500)
await shot(B.page, "home-member-de")
check("Ben's Clubs tab shows the club as a member with the next date", /Mitglied/.test(await B.page.getByRole("button", { name: /Dartfreunde Nord/ }).first().textContent()))
await B.page.getByRole("button", { name: /Dartfreunde Nord/ }).first().click()
await B.page.getByRole("radiogroup", { name: "Kommst du?" }).waitFor({ timeout: 30000 })
await B.page.getByRole("radiogroup", { name: "Kommst du?" }).getByRole("radio", { name: "Ja", exact: true }).click()
await wait(B.page, 3000)
await shot(B.page, "club-member-de")
await A.page.getByRole("button", { name: "Aktualisieren" }).click()
await A.page.getByRole("button", { name: /1 Zusage/ }).waitFor({ timeout: 30000 })
check("Ben's answer reaches Olaf's device", true)

// --- Olaf starts a club game against Ben and plays it ---------------------------------------------
await A.page.getByRole("button", { name: "Spiel starten" }).click()
await A.page.getByRole("button", { name: "Ben", exact: true }).waitFor({ timeout: 30000 })
await A.page.getByRole("button", { name: "Ben", exact: true }).click()
await wait(A.page, 300)
await shot(A.page, "start-game-de")
await A.page.getByRole("button", { name: "Weiter zur Einrichtung" }).click()
await A.page.getByRole("button", { name: "Spiel starten", exact: true }).waitFor({ timeout: 15000 })
const seats = await A.page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).filter(Boolean))
check("setup opens with the club's seats", seats.includes("Olaf") && seats.includes("Ben"), seats.join(", "))
await A.page.getByRole("radiogroup", { name: "Startpunkte" }).getByRole("radio", { name: "301" }).click()
await A.page.getByRole("button", { name: "Spiel starten", exact: true }).click()
await wait(A.page, 1500)
for (const d of [[20, 3], [20, 3], [20, 3], [1], [1], [1], [20, 3], [11, 3], [14, 2]]) await dart(A.page, d[0], d[1])
await A.page.getByText("Für Dartfreunde Nord eingetragen.").waitFor({ timeout: 30000 })
await wait(A.page, 800)
await shot(A.page, "result-recorded-de")
const matches = query(["-k", "1180"]).filter((e) => e.tags.some((t) => t[0] === "l" && t[1] === "match.session"))
check("the club game's match is private: nothing of it is readable on the relays", matches.length === 1 && matches[0].tags.some((t) => t[0] === "enc" && t[1] === "nip44") && !matches[0].content.includes("Ben"))
check("no console errors (game)", A.errors.length === 0, A.errors.join(" | "))

// --- Ben confirms the result from his phone -----------------------------------------------------
await B.page.reload()
await B.page.waitForLoadState("networkidle")
await tab(B.page, "Clubs").click()
await B.page.getByRole("button", { name: /Ergebnis bestätigen: Olaf – Ben/ }).waitFor({ timeout: 30000 })
await wait(B.page, 500)
await shot(B.page, "home-task-de")
await B.page.getByRole("button", { name: /Ergebnis bestätigen: Olaf – Ben/ }).click()
await B.page.getByRole("button", { name: /Ergebnis bestätigen/ }).waitFor({ timeout: 30000 })
await B.page.getByRole("button", { name: /Ergebnis bestätigen/ }).click()
await B.page.getByRole("button", { name: "Stimmt", exact: true }).waitFor()
await wait(B.page, 500)
await shot(B.page, "verdict-de")
await B.page.getByRole("button", { name: "Stimmt", exact: true }).click()
await B.page.getByText("Bestätigt.").waitFor({ timeout: 30000 })
check("Ben confirmed the result", true)
check("no console errors (verdict)", B.errors.length === 0, B.errors.join(" | "))

// --- The table counts it on Olaf's device -------------------------------------------------------
await A.page.getByRole("button", { name: /Zurück|Fertig|Neues Spiel/ }).first().click().catch(() => {})
await A.page.reload()
await A.page.waitForLoadState("networkidle")
await tab(A.page, "Clubs").click()
await A.page.getByRole("button", { name: /Dartfreunde Nord/ }).first().waitFor({ timeout: 30000 })
await wait(A.page, 3000)
await A.page.getByRole("button", { name: /Dartfreunde Nord/ }).first().click()
await A.page.getByRole("button", { name: /Herbst 2026/ }).waitFor({ timeout: 30000 })
check("Olaf's row on the club: rank 1 with 2 points", /Platz 1, 2 Punkte aus 1 Spiel/.test(await A.page.getByRole("button", { name: /Herbst 2026/ }).textContent()))
await A.page.getByRole("button", { name: /Herbst 2026/ }).click()
await A.page.getByRole("table").waitFor({ timeout: 15000 })
await wait(A.page, 800)
await shot(A.page, "table-de")
const rows = await A.page.evaluate(() => [...document.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ").trim()))
check("the table: Olaf 1 game 2 points, Ben 1 game 0 points", rows.length === 2 && /^1 Olaf\s*Du 1 2/.test(rows[0]) && /^2 Ben 1 0/.test(rows[1]), rows.join(" | "))
await A.page.getByRole("button", { name: "So wird gewertet" }).click()
await wait(A.page, 800)
await shot(A.page, "scoring-de")
await A.page.getByRole("button", { name: "Fertig" }).click()

// --- Management: members, export --------------------------------------------------------------------
await A.page.getByRole("button", { name: /^Zurück/ }).click()
await wait(A.page, 800)
await A.page.getByRole("button", { name: "Club verwalten" }).click()
await A.page.getByRole("button", { name: "Club exportieren" }).waitFor({ timeout: 15000 })
await wait(A.page, 500)
await shot(A.page, "manage-de")
const [download] = await Promise.all([A.page.waitForEvent("download"), A.page.getByRole("button", { name: "Club exportieren" }).click()])
const exported = JSON.parse(await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString()))
check("the export is a club file with the signed records and the readable keys", download.suggestedFilename() === "blueline-club-dartfreunde-nord.json" && exported.format === "blueline-club" && exported.events.length >= 8 && Object.keys(exported.keys).length >= 5 && exported.summary.members.length === 2, `${exported.events?.length} events, ${Object.keys(exported.keys ?? {}).length} keys`)
await A.page.getByRole("button", { name: /^Mitglieder/ }).click()
await A.page.getByRole("button", { name: /Ben/ }).first().waitFor({ timeout: 15000 })
await wait(A.page, 500)
await shot(A.page, "members-de")
await A.page.getByRole("button", { name: /Ben/ }).first().click()
await A.page.getByRole("radio", { name: /Turnierleiter/ }).waitFor()
await wait(A.page, 500)
await shot(A.page, "member-sheet-de")
await A.page.getByRole("radio", { name: /Turnierleiter/ }).click()
await wait(A.page, 2500)
check("a role change shows at once", (await A.page.getByText("Turnierleiter").count()) >= 1)
await A.page.getByRole("button", { name: "Fertig" }).click()
check("no console errors (management)", A.errors.length === 0, A.errors.join(" | "))

// --- Screenshot matrix: sizes, both languages ----------------------------------------------------
const stateFile = `${OUT}/olaf-state.json`
writeFileSync(stateFile, JSON.stringify(await A.ctx.storageState({ indexedDB: true })))
for (const [w, h] of [[320, 548], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
  for (const en of [false, true]) {
    const { ctx, page } = await open({ viewport: { width: w, height: h }, locale: en ? "en-GB" : "de-DE", dark: en, storageState: stateFile })
    const tag = `${w}x${h}-${en ? "en-dark" : "de"}`
    await page.goto(BASE)
    await page.waitForLoadState("networkidle")
    await tab(page, en ? "Clubs" : "Clubs").click()
    await page.getByRole("button", { name: /Dartfreunde Nord/ }).first().waitFor({ timeout: 30000 })
    await wait(page, 1500)
    await shot(page, `home-${tag}`)
    const home = await layout(page)
    await page.getByRole("button", { name: /Dartfreunde Nord/ }).first().click()
    await page.getByRole("button", { name: en ? "Start a game" : "Spiel starten" }).waitFor({ timeout: 30000 })
    await wait(page, 800)
    await shot(page, `club-${tag}`)
    const club = await layout(page)
    await page.getByRole("button", { name: /Herbst 2026/ }).click()
    await page.getByRole("table").waitFor({ timeout: 15000 })
    await wait(page, 800)
    await shot(page, `table-${tag}`)
    const table = await layout(page)
    check(`${tag}: no ellipsis, no horizontal scroll on home, club and table`, ![home, club, table].some((l) => l.ellipsis || l.hscroll), JSON.stringify({ home, club, table }))
    await ctx.close()
  }
}

await A.ctx.close()
await B.ctx.close()
await browser.close()
for (const relay of relays) relay.kill("SIGTERM")
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
