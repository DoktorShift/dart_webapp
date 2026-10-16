// Pairing, the device list, the backup and the restore in a production build whose
// NEXT_PUBLIC_BLUELINE_RELAYS points at one local "nak serve" relay (ws://127.0.0.1:20085). The
// script runs the relay itself; the app server runs outside:
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20085 npm run build
//   npx next start -p 3313
//   node docs/implementation/evidence/P2.03/scripts/devices-checks.mjs   (BASE, OUT optional)
//
// A. Device A (390 × 844, German): a new profile "Mia"; the "Profil sichern" hint on the card;
//    Profil › Geräte with this device; Profil › Sicherung, the backup file with its password,
//    saved (downloaded); the card then says "gesichert", the hint is gone. A passkey through
//    Chromium's virtual authenticator (SIMULATED PRF, CDP WebAuthn), then, signed out, the
//    profile back through that passkey.
// B. Device B (another browser context, German): "Von meinem anderen Gerät" shows QR and code.
//    Device A types the code under "Eigenes Gerät hinzufügen"; both show the same check code;
//    B confirms, A gives access; B says "Dein Profil ist dabei." and shows Mia's profile; A's
//    device list has two devices.
// C. Device C (iPhone SE 320 × 548, dark): "Aus meiner Sicherung" with A's file and password;
//    the profile is there.
// D. Device D (English): the new-device screen in English; the lost-device and rename sheets
//    on A.
import { chromium } from "playwright"
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3313"
const OUT = process.env.OUT ?? "/tmp/blueline-devices-shots"
mkdirSync(OUT, { recursive: true })
const NAK = "/opt/homebrew/bin/nak"
const PORT = 20085
const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const relay = spawn(NAK, ["serve", "--hostname", "127.0.0.1", "--port", String(PORT)], { stdio: "ignore" })
await sleep(1200)
const browser = await chromium.launch()
const cleanup = async () => {
  await browser.close().catch(() => {})
  relay.kill("SIGTERM")
}
process.on("uncaughtException", async (error) => {
  console.error(error)
  await cleanup()
  process.exit(2)
})

async function open({ viewport = { width: 390, height: 844 }, locale = "de-DE", colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, locale, hasTouch: true, isMobile: viewport.width < 800, serviceWorkers: "block", colorScheme, acceptDownloads: true })
  await ctx.addInitScript((theme) => localStorage.setItem("theme", theme), colorScheme)
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  await page.goto(BASE)
  await sleep(800)
  return { ctx, page, errors }
}
const tab = (page, name) => page.getByRole("navigation", { name: /Bereiche|Sections/ }).last().getByRole("button", { name, exact: true })
const panel = (page) => page.locator('[data-tab-panel="profile"]')
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` })
const text = async (page) => (await panel(page).innerText()).replace(/\s+/g, " ")

// --- A: a profile, the hint, the devices, the backup ----------------------------------------
const a = await open()
await tab(a.page, "Profil").click()
await a.page.getByRole("button", { name: "Profil anlegen" }).first().click()
await a.page.getByLabel("Anzeigename").fill("Mia")
await a.page.getByRole("button", { name: "Profil anlegen" }).click()
await a.page.getByText(/Noch keine X01-Spiele/).waitFor({ timeout: 25000 })
await sleep(800)
await shot(a.page, "a-profile-hint")
check("A: the own profile shows the backup hint with one action", (await text(a.page)).includes("Noch nicht gesichert.") && (await panel(a.page).getByRole("button", { name: "Jetzt sichern" }).count()) === 1)
check("A: the rows Geräte and Sicherung are there, Sicherung says not backed up", (await panel(a.page).getByRole("button", { name: /^Geräte/ }).count()) === 1 && (await text(a.page)).includes("Noch nicht gesichert"))

await panel(a.page).getByRole("button", { name: /^Geräte/ }).click()
await a.page.getByText("Dieses Gerät").waitFor({ timeout: 25000 })
await sleep(500)
await shot(a.page, "a-devices")
check("A: Geräte lists this device by its kind and browser", /Linux · Chrome|Computer|Chrome/.test(await text(a.page)) && (await text(a.page)).includes("Dieses Gerät"))
await panel(a.page).getByRole("button", { name: /Chrome|Computer/ }).first().click()
await a.page.getByRole("dialog").waitFor()
await sleep(400)
await shot(a.page, "a-device-edit")
check("A: a device opens with a name field and the honest removal", (await a.page.getByRole("dialog").innerText()).includes("Aus der Liste entfernen"))
await a.page.keyboard.press("Escape")
await sleep(400)
await panel(a.page).getByRole("button", { name: "Gerät verloren?" }).click()
await a.page.getByRole("dialog").waitFor()
await sleep(400)
await shot(a.page, "a-lost")
check("A: 'Gerät verloren?' says plainly that access can't be blocked from afar", (await a.page.getByRole("dialog").innerText()).includes("aus der Ferne nicht sperren"))
await a.page.getByRole("dialog").getByRole("button", { name: "Verstanden" }).click()
await sleep(300)
await a.page.getByRole("button", { name: /Zurück zu Profil/ }).click()
await sleep(500)

await panel(a.page).getByRole("button", { name: /^Sicherung/ }).click()
await a.page.getByText("Dein Profil ist noch nicht gesichert.").waitFor({ timeout: 15000 })
await sleep(400)
await shot(a.page, "a-backup")
// Chromium says it can do PRF (getClientCapabilities), so the passkey row is offered here.
check("A: Sicherung says not backed up and offers the file and (Chromium) the passkey", (await text(a.page)).includes("Sicherungsdatei erstellen") && (await text(a.page)).includes("Passkey einrichten"))
await panel(a.page).getByRole("button", { name: "Sicherungsdatei erstellen" }).click()
const dialog = a.page.getByRole("dialog")
await dialog.getByText("Dein Kennwort").waitFor({ timeout: 30000 })
await sleep(300)
await shot(a.page, "a-backup-file")
const password = (await dialog.innerText()).match(/[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}/)?.[0]
check("A: the file sheet shows a generated password once, with copy and save", !!password && (await dialog.getByRole("button", { name: "Kennwort kopieren" }).count()) === 1, password)
const [download] = await Promise.all([a.page.waitForEvent("download"), dialog.getByRole("button", { name: "Datei speichern" }).click()])
const backupPath = `${OUT}/${download.suggestedFilename()}`
await download.saveAs(backupPath)
await dialog.getByText("Dein Profil ist gesichert.").waitFor({ timeout: 15000 })
await sleep(300)
await shot(a.page, "a-backup-saved")
const backup = JSON.parse(readFileSync(backupPath, "utf8"))
check("A: the saved file is a versioned, encrypted backup", backup.format === "blueline-backup" && backup.version === 1 && /^ncryptsec1/.test(backup.ncryptsec) && !readFileSync(backupPath, "utf8").includes("Mia"), download.suggestedFilename())
await dialog.getByRole("button", { name: "Fertig" }).click()
await a.page.getByText("Dein Profil ist gesichert.").waitFor({ timeout: 15000 })
await sleep(400)
await shot(a.page, "a-backup-secured")

// The passkey, with a SIMULATED authenticator that has PRF (CDP WebAuthn): the sheet asks once,
// the browser "proves" the PRF twice, the package goes to the relay and is read back.
const cdp = await a.ctx.newCDPSession(a.page)
await cdp.send("WebAuthn.enable", { enableUI: false })
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } })
await panel(a.page).getByRole("button", { name: "Passkey einrichten" }).click()
await a.page.getByRole("dialog").getByRole("button", { name: "Passkey einrichten" }).click()
await a.page.getByRole("dialog").getByText("Passkey eingerichtet.").waitFor({ timeout: 30000 })
await sleep(300)
await shot(a.page, "a-passkey-done")
check("A: the simulated passkey is set up and its backup was read back from the relay", (await a.page.getByRole("dialog").innerText()).includes("Passkey eingerichtet.") && !(await a.page.getByRole("dialog").innerText()).includes("noch nicht bestätigt"))
await a.page.getByRole("dialog").getByRole("button", { name: "Schließen" }).click()
await a.page.getByText(/Eingerichtet am/).waitFor({ timeout: 10000 })
await sleep(300)
await shot(a.page, "a-backup-both")
await a.page.getByRole("button", { name: /Zurück zu Profil/ }).click()
await sleep(600)
check("A: the hint is gone and the row says gesichert", !(await text(a.page)).includes("Noch nicht gesichert") && (await text(a.page)).includes("Gesichert"))

// --- B: the new device ------------------------------------------------------------------------
const b = await open()
await tab(b.page, "Profil").click()
await b.page.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
await b.page.getByRole("button", { name: /Von meinem anderen Gerät/ }).click()
await b.page.getByText("Oder gib dort diesen Code ein:").waitFor({ timeout: 25000 })
await sleep(800)
await shot(b.page, "b-new-device")
const code = (await text(b.page)).match(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/)?.[0]
check("B: the new device shows a QR code, share buttons, a typed code and its validity", !!code && (await panel(b.page).getByRole("img", { name: "QR-Code zum Verbinden" }).count()) === 1 && /Gilt bis \d\d:\d\d Uhr/.test(await text(b.page)), code)

// A types the code.
await panel(a.page).getByRole("button", { name: /^Geräte/ }).click()
await a.page.getByText("Dieses Gerät").waitFor({ timeout: 25000 })
await panel(a.page).getByRole("button", { name: "Eigenes Gerät hinzufügen" }).click()
await a.page.getByLabel("Code oder Link eingeben").waitFor({ timeout: 15000 })
await sleep(400)
await shot(a.page, "a-add-scanner")
await a.page.getByLabel("Code oder Link eingeben").fill("B1.notacode")
await a.page.getByRole("button", { name: "Öffnen" }).click()
await a.page.getByText("Das ist kein Code zum Verbinden eines Geräts.").waitFor({ timeout: 5000 })
check("A: a wrong code is answered in place", true)
await a.page.getByLabel("Code oder Link eingeben").fill(code.toLowerCase())
await a.page.getByRole("button", { name: "Öffnen" }).click()
await a.page.getByText("Zugriff geben").waitFor({ timeout: 30000 })
await sleep(500)
await shot(a.page, "a-add-found")
await b.page.getByText("Gerät gefunden").waitFor({ timeout: 30000 })
await sleep(500)
await shot(b.page, "b-found")
const codeA = (await text(a.page)).match(/\d{4} \d{4}/)?.[0]
const codeB = (await text(b.page)).match(/\d{4} \d{4}/)?.[0]
check("A and B show the same check code; A names the full access", !!codeA && codeA === codeB && (await text(a.page)).includes("Dieses Gerät erhält vollen Zugriff auf dein Profil."), `${codeA} / ${codeB}`)
await b.page.getByRole("button", { name: "Ja, verbinden" }).click()
await b.page.getByText("Bestätige jetzt auf deinem anderen Gerät.").waitFor({ timeout: 15000 })
await sleep(400)
await shot(b.page, "b-confirming")
await sleep(1500)
check("B: nothing arrives before A taps", !(await text(b.page)).includes("Dein Profil ist dabei"))
await a.page.getByRole("button", { name: "Zugriff geben" }).click()
await a.page.getByText("Verbunden", { exact: true }).waitFor({ timeout: 30000 })
await sleep(400)
await shot(a.page, "a-add-done")
await b.page.getByText("Dein Profil ist dabei.").waitFor({ timeout: 30000 })
await sleep(1200)
await shot(b.page, "b-done")
check("B: 'Dein Profil ist dabei.' with the history state", (await text(b.page)).includes("Dein Profil ist dabei.") && /Spiele/.test(await text(b.page)))
await b.page.getByRole("button", { name: "Fertig" }).click()
await panel(b.page).getByText("Mia").first().waitFor({ timeout: 25000 })
await sleep(1000)
await shot(b.page, "b-profile")
check("B: the profile tab shows Mia, signed in, and knows the backup made on A", (await text(b.page)).includes("Mia") && (await text(b.page)).includes("Abmelden") && (await text(b.page)).includes("Gesichert") && !(await text(b.page)).includes("Noch nicht gesichert"))
await a.page.getByRole("button", { name: "Fertig" }).click()
await sleep(500)
await a.page.getByRole("button", { name: /Zurück zu Profil/ }).click()
await sleep(500)
await panel(a.page).getByRole("button", { name: /^Geräte/ }).click()
await a.page.getByText("Dieses Gerät").waitFor({ timeout: 25000 })
await sleep(1500)
await shot(a.page, "a-devices-two")
check("A: Geräte now lists two devices", (await panel(a.page).getByText(/Seit \d/).count()) >= 1)

// Signed out, A gets the profile back through the (simulated) passkey.
await a.page.getByRole("button", { name: /Zurück zu Profil/ }).click()
await sleep(500)
await panel(a.page).getByRole("button", { name: "Abmelden" }).click()
await a.page.getByRole("alertdialog").getByRole("button", { name: /behalten|Abmelden$/ }).first().click()
await a.page.getByRole("button", { name: "Ich habe schon ein Profil" }).waitFor({ timeout: 15000 })
await a.page.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
await a.page.getByRole("button", { name: /Aus meiner Sicherung/ }).click()
await a.page.getByRole("button", { name: "Mit Passkey öffnen" }).waitFor({ timeout: 15000 })
await sleep(300)
await shot(a.page, "a-restore-passkey")
await a.page.getByRole("button", { name: "Mit Passkey öffnen" }).click()
await a.page.getByText("Dein Profil ist dabei.").waitFor({ timeout: 30000 })
await sleep(500)
await shot(a.page, "a-restore-passkey-done")
check("A: the simulated passkey brings the profile back after signing out", (await text(a.page)).includes("Dein Profil ist dabei."))

// --- C: restore from the file on an iPhone SE, dark -------------------------------------------
const c = await open({ viewport: { width: 320, height: 548 }, colorScheme: "dark" })
await tab(c.page, "Profil").click()
await c.page.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
await c.page.getByRole("button", { name: /Aus meiner Sicherung/ }).click()
await c.page.getByRole("button", { name: "Datei wählen" }).waitFor({ timeout: 25000 })
await sleep(500)
await shot(c.page, "c-restore")
await c.page.locator('input[type="file"]').setInputFiles(backupPath)
await c.page.getByLabel("Kennwort").fill("wrong-wrong-wrong-wrong")
await c.page.getByRole("button", { name: "Profil öffnen" }).click()
await c.page.getByText("Das Kennwort passt nicht zu dieser Datei.").waitFor({ timeout: 30000 })
await sleep(300)
await shot(c.page, "c-restore-wrong")
await c.page.getByLabel("Kennwort").fill(password)
await c.page.getByRole("button", { name: "Profil öffnen" }).click()
await c.page.getByText("Dein Profil ist dabei.").waitFor({ timeout: 30000 })
await sleep(800)
await shot(c.page, "c-restore-done")
check("C: the file with its password opens the profile on an iPhone SE in the dark", (await text(c.page)).includes("Dein Profil ist dabei."))
check("C: no horizontal scrolling at 320", await c.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))

// --- D: English ---------------------------------------------------------------------------------
const d = await open({ locale: "en-GB" })
await tab(d.page, "Profile").click()
await d.page.getByRole("button", { name: "I already have a profile" }).click()
await d.page.getByRole("button", { name: /From my other device/ }).click()
await d.page.getByText("Or enter this code there:").waitFor({ timeout: 25000 })
await sleep(800)
await shot(d.page, "d-new-device-en")
check("D: the new-device screen in English", (await text(d.page)).includes("Add my own device"))

for (const [name, device] of [["A", a], ["B", b], ["C", c], ["D", d]]) check(`${name}: no page errors`, device.errors.length === 0, device.errors.slice(0, 3).join(" | "))
await cleanup()
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; screenshots in ${OUT}`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
