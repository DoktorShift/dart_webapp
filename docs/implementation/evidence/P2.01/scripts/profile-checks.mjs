// Profile checks against a production build with NEXT_PUBLIC_BLUELINE_RELAYS pointing at two
// local "nak serve" relays (ws://127.0.0.1:18951 and :18952): sign-in with a real NIP-46 signer
// (nak bunker) through the QR code and confirm(), "Auch im öffentlichen Profil ändern?" with
// another app's fields, long names on the game screen, the offer's dismissal and its absence for
// unnamed practice, secret keys refused, a same-name hint, relay states and the diagnostics.
//   node docs/implementation/evidence/P2.01/scripts/profile-checks.mjs   (BASE, OUT optional)
import { chromium } from "playwright"
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BASE = process.env.BASE ?? "http://localhost:3311"
const OUT = process.env.OUT ?? "/tmp/blueline-profile-shots"
mkdirSync(OUT, { recursive: true })
const NAK = "/opt/homebrew/bin/nak"
const RELAYS = ["ws://127.0.0.1:18951", "ws://127.0.0.1:18952"]
const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}
const query = (args) => execFileSync(NAK, ["req", ...args, ...RELAYS], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))

const browser = await chromium.launch()
async function open({ seed = null, viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, locale: "de-DE", hasTouch: true, isMobile: true, serviceWorkers: "block", colorScheme: "light" })
  await ctx.addInitScript((c) => {
    localStorage.setItem("theme", "light")
    if (sessionStorage.getItem("seeded")) return
    sessionStorage.setItem("seeded", "1")
    if (c) localStorage.setItem("dart-scorer.current-match.v1", c)
  }, seed ? JSON.stringify(seed) : null)
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  return { ctx, page, errors }
}
const wait = (page, ms = 700) => page.waitForTimeout(ms)

// --- NIP-46 sign-in with nak bunker ----------------------------------------------------------
if (!process.env.ONLY_LAST) {
  const secret = execFileSync(NAK, ["key", "generate"]).toString().trim()
  const pubkey = execFileSync(NAK, ["key", "public", secret]).toString().trim()
  // The profile as another app left it: fields BlueLine doesn't know.
  execFileSync(NAK, ["event", "-k", "0", "-c", JSON.stringify({ name: "lena_s", display_name: "Lena aus Amber", about: "Darts!", lud16: "lena@wallet.example" }), "--sec", secret, ...RELAYS], { stdio: "ignore" })
  const home = mkdtempSync(join(tmpdir(), "nak-bunker-"))
  const bunker = spawn(NAK, ["bunker", "--sec", secret, RELAYS[0]], { env: { ...process.env, HOME: home }, stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  bunker.stdout.on("data", (c) => (log += c))
  bunker.stderr.on("data", (c) => (log += c))
  await new Promise((resolve) => setTimeout(resolve, 2500))

  const { ctx, page, errors } = await open()
  await page.goto(BASE)
  await page.waitForLoadState("networkidle")
  await page.getByRole("navigation", { name: "Bereiche" }).last().getByRole("button", { name: "Profil", exact: true }).click()
  await wait(page, 1200)
  await page.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
  await wait(page, 800)
  await page.getByRole("button", { name: /Mit einer anderen App/ }).click()
  await wait(page, 1200)
  await page.getByRole("button", { name: /Signer-App/ }).click()
  await wait(page, 2000)
  const uri = await page.getByRole("link", { name: /In der Signer-App/ }).getAttribute("href")
  check("the code is a nostrconnect link to the app's relays", uri?.startsWith("nostrconnect://") && uri.includes(encodeURIComponent(RELAYS[0])), uri?.slice(0, 60))
  execFileSync(NAK, ["bunker", "connect", uri], { env: { ...process.env, HOME: home }, stdio: "ignore", timeout: 30000 })
  await page.getByText("Bist du das?").waitFor({ timeout: 20000 })
  await wait(page, 2000)
  await page.screenshot({ path: `${OUT}/nip46-confirm.png` })
  check("the account is shown with its name before anything is kept", (await page.getByText("Lena aus Amber").count()) === 1)
  const before = await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("blueline")
    request.onsuccess = () => {
      const get = request.result.transaction("kv").objectStore("kv").get("profile.session")
      get.onsuccess = () => resolve(get.result ?? null)
    }
  }))
  check("nothing is stored before the person confirms", before === null)
  await page.getByRole("button", { name: "Ja, das bin ich" }).click()
  await page.getByText("Lena aus Amber").first().waitFor({ timeout: 20000 })
  await wait(page, 2500)
  await page.screenshot({ path: `${OUT}/nip46-profile.png` })
  check("the profile tab shows the existing profile", (await page.locator('[data-tab-panel="profile"]').getByText("Lena aus Amber").count()) >= 1)
  const session = await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("blueline")
    request.onsuccess = () => {
      const get = request.result.transaction("kv").objectStore("kv").get("profile.session")
      get.onsuccess = () => resolve(get.result?.value ?? null)
    }
  }))
  check("the session is a signer app session of that key, its connection key sealed", session?.kind === "nip46" && session.pubkey === pubkey && session.secret?.data instanceof Object && !("clientSecretKey" in session), JSON.stringify(Object.keys(session ?? {})))
  check("signing in published nothing", query(["-k", "0", "-a", pubkey]).length === 1 && query(["-k", "10002", "-a", pubkey]).length === 0)

  // A new name, also publicly: signed by the bunker, the other app's fields kept.
  await page.getByRole("button", { name: "Bearbeiten" }).click()
  await wait(page, 900)
  await page.getByLabel("Anzeigename").fill("Lena Amber")
  await page.getByRole("button", { name: "Sichern" }).click()
  await wait(page, 600)
  await page.getByRole("button", { name: "Auch öffentlich ändern" }).click()
  await wait(page, 4000)
  const [metadata] = query(["-k", "0", "-a", pubkey])
  const content = JSON.parse(metadata.content)
  check("the bunker signed the public change; unknown fields stay", metadata.pubkey === pubkey && content.display_name === "Lena Amber" && content.name === "lena_s" && content.about === "Darts!" && content.lud16 === "lena@wallet.example", metadata.content)
  check("nak verifies the event", execFileSync(NAK, ["verify"], { input: JSON.stringify(metadata) }).toString().trim() === "")
  await page.screenshot({ path: `${OUT}/nip46-after-edit.png` })
  check("no console errors (NIP-46)", errors.length === 0, errors.join(" | "))
  await ctx.close()
  bunker.kill("SIGTERM")
}

// --- Long names on the game screen -----------------------------------------------------------
const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
const game = (names, throws, status = "paused") => ({
  id: `g-${Math.random().toString(36).slice(2)}`,
  startedAt: "2026-10-05T18:00:00.000Z",
  acknowledgedLegs: 0,
  status,
  config: { modeId: "501", modeName: "501", type: "x01", startScore: 501, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: names.map((name, i) => ({ id: `s${i}`, name })) },
  throws,
})
if (!process.env.ONLY_LAST) for (const [w, h] of [[320, 548], [390, 844], [568, 320], [844, 390]]) {
  const { ctx, page } = await open({ seed: game(["Maximilian Alexander von Testhausen", "Anna Schmidt-Wellenbrink"], [dart(20, 3)], "playing"), viewport: { width: w, height: h } })
  await page.goto(BASE)
  await wait(page, 1500)
  await page.screenshot({ path: `${OUT}/game-long-names-${w}x${h}.png` })
  const found = await page.evaluate(() => ({ ellipsis: [...document.querySelectorAll("body *")].some((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1), scroll: document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1, full: document.body.innerText.includes("Maximilian Alexander von Testhausen") }))
  check(`game screen ${w}x${h}: long names in full, no ellipsis, no scrolling`, !found.ellipsis && !found.scroll && found.full, JSON.stringify(found))
  await ctx.close()
}

// --- The offer: "Später" is for this game; unnamed practice never gets one ----------------------
if (!process.env.ONLY_LAST) {
  const nearWin = game(["Anna", "Ben"], [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)])
  const { ctx, page } = await open({ seed: { ...nearWin, config: { ...nearWin.config, modeId: "301", modeName: "301", startScore: 301 } } })
  await page.goto(BASE)
  await page.getByRole("button", { name: /Weiterspielen/ }).first().click()
  await wait(page, 900)
  await page.keyboard.press("b")
  await wait(page, 1500)
  check("the offer shows for a game with names", (await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).count()) === 1)
  const box = await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).boundingBox()
  check("the offer is one row (44 to 48 pt)", box && box.height <= 49, `${box?.height}`)
  await page.getByRole("button", { name: "Später, nicht für dieses Spiel" }).click()
  await wait(page, 500)
  check("Später removes it", (await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).count()) === 0)
  const dismissed = await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("blueline")
    request.onsuccess = () => {
      const get = request.result.transaction("kv").objectStore("kv").get("results-offer.dismissed")
      get.onsuccess = () => resolve(get.result?.value ?? [])
    }
  }))
  check("and remembers it for this game only", Array.isArray(dismissed) && dismissed.length === 1, JSON.stringify(dismissed))
  await ctx.close()
}
if (!process.env.ONLY_LAST) {
  // Alone and without a name: 301, 50 left after two visits, the bull finishes.
  const practice = game(["Spieler 1"], [dart(20, 3), dart(20, 3), dart(20, 3), dart(20, 3), dart(11)])
  const solo = { ...practice, config: { ...practice.config, modeId: "301", modeName: "301", startScore: 301 } }
  const { ctx, page } = await open({ seed: solo })
  await page.goto(BASE)
  await page.getByRole("button", { name: /Weiterspielen/ }).first().click()
  await wait(page, 900)
  await page.keyboard.press("b")
  await wait(page, 1500)
  await page.screenshot({ path: `${OUT}/solo-unnamed-result.png` })
  const result = await page.getByRole("dialog").count()
  check("unnamed solo practice: the result shows, without the offer", result === 1 && (await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).count()) === 0)
  await ctx.close()
}

// --- Secret keys are never taken; relays under Erweitert; same names told apart --------------
{
  const nsec = execFileSync(NAK, ["encode", "nsec", execFileSync(NAK, ["key", "generate"]).toString().trim()]).toString().trim()
  const twin = execFileSync(NAK, ["key", "generate"]).toString().trim()
  execFileSync(NAK, ["event", "-k", "0", "-c", JSON.stringify({ name: "Anna", nip05: "anna@example.invalid" }), "--sec", twin, ...RELAYS], { stdio: "ignore" })
  const twinNpub = execFileSync(NAK, ["encode", "npub", execFileSync(NAK, ["key", "public", twin]).toString().trim()]).toString().trim()
  const nearWin = game(["Anna", "Ben"], [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)])
  const { ctx, page, errors } = await open({ seed: { ...nearWin, config: { ...nearWin.config, modeId: "301", modeName: "301", startScore: 301 } } })
  await page.goto(BASE)
  await page.getByRole("button", { name: /Weiterspielen/ }).first().click()
  await wait(page, 900)
  await page.keyboard.press("b")
  await wait(page, 1500)
  await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).click()
  await wait(page, 800)
  await page.getByRole("radio", { name: "Anna" }).click()
  await page.getByLabel("Anzeigename").fill(nsec)
  await wait(page, 300)
  await page.screenshot({ path: `${OUT}/nsec-name-field.png` })
  check("a secret key typed into the name is dropped, with a warning", (await page.getByLabel("Anzeigename").inputValue()) === "Anna" && (await page.getByText(/geheime Zugangscode/).count()) === 1)
  await page.getByRole("button", { name: "Profil anlegen" }).click()
  await wait(page, 2000)
  await page.getByRole("button", { name: "Fertig", exact: true }).click()
  await wait(page, 900)
  await page.getByRole("button", { name: /^X01/ }).first().click()
  await wait(page, 1200)
  const firstSeat = page.locator("main input").first()
  await firstSeat.fill("Anna")
  await page.getByRole("button", { name: "Spieler per QR hinzufügen" }).click()
  await wait(page, 1200)
  await page.getByLabel("Link oder Code einfügen").fill(nsec)
  await page.getByRole("button", { name: "Öffnen" }).click()
  await wait(page, 600)
  await page.screenshot({ path: `${OUT}/nsec-scan-field.png` })
  check("a pasted secret key is refused in the scanner and the field is emptied", (await page.getByLabel("Link oder Code einfügen").inputValue()) === "" && (await page.getByText(/geheime Zugangscode/).count()) === 1)
  await page.getByLabel("Link oder Code einfügen").fill(twinNpub)
  await page.getByRole("button", { name: "Öffnen" }).click()
  await page.getByText("Ein anderer Spieler heißt auch so.", { exact: false }).waitFor({ timeout: 8000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/scan-same-name.png` })
  check("a scanned profile named like a seat is told apart by its fingerprint", (await page.getByText(/Ein anderer Spieler heißt auch so\. Dieses Profil: [0-9a-f]{4} [0-9a-f]{4}/).count()) === 1)
  check("an address that can't be verified is not shown", (await page.getByText("anna@example.invalid").count()) === 0)
  await page.getByRole("button", { name: "Abbrechen" }).last().click()
  await wait(page, 600)
  await page.getByRole("button", { name: /^Spielen$/ }).first().click()
  await wait(page, 900)
  await page.getByRole("navigation", { name: "Bereiche" }).last().getByRole("button", { name: "Profil", exact: true }).click()
  await wait(page, 1200)
  await page.getByRole("button", { name: "Erweitert" }).click()
  await page.getByText("Verbunden").first().waitFor({ timeout: 8000 }).catch(() => {})
  await wait(page, 500)
  await page.screenshot({ path: `${OUT}/advanced-states.png`, fullPage: false })
  const hosts = await page.getByText(/^127\.0\.0\.1:1895[12]$/).count()
  check("relays show as hosts without the scheme, each with its state in words", hosts === 2 && (await page.getByText("Verbunden").count()) === 2 && (await page.getByText(/wss?:\/\//).count()) === 0, String(hosts))
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {})
  await page.getByRole("button", { name: "Diagnose kopieren" }).click()
  await wait(page, 800)
  const report = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "")
  check("the diagnostics report names version, access and relay states, and nothing secret", /BlueLine Darts 1\.0\.0/.test(report) && /access: local/.test(report) && /ws:\/\/127\.0\.0\.1:18951 rw connected/.test(report) && !/nsec|secret/i.test(report), report.slice(0, 200).split("\n").join(" | "))
  await page.evaluate(() => [...document.querySelectorAll("[data-scroll-container]")].filter((el) => el.offsetParent).at(-1).scrollTo(0, 2000))
  await wait(page, 400)
  await page.screenshot({ path: `${OUT}/advanced-bottom.png` })
  check("no console errors (secrets, relays)", errors.length === 0, errors.join(" | "))
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
