// Sync checks against a production build whose NEXT_PUBLIC_BLUELINE_RELAYS points at two local
// "nak serve" relays (ws://127.0.0.1:18961 and :18962). A third relay (:18963) is added under
// Erweitert. The script runs the relays and a "nak bunker" itself; the app server runs outside:
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:18961,ws://127.0.0.1:18962 npm run build
//   npx next start -p 3312
//   node docs/implementation/evidence/P3b/scripts/sync-checks.mjs   (BASE, OUT optional)
//
// 1. Device A (signer app): a finished game, sign-in through nak bunker, the game claimed; the
//    records on both relays are kind 30078 with one opaque d tag, verified by nak, unreadable;
//    Erweitert shows the sync; a dead relay address is refused, a live one added and filled;
//    "Diagnose kopieren" has the sync section and no secret.
// 2. Device B (signer app, English): signs in, finds device A's game without any claim.
// 3. Device C (new local profile while every relay is down, iPhone SE): the profile and its games
//    list say the games couldn't be loaded yet, never "no games"; Erweitert says why; once the
//    relays are back, "Jetzt abgleichen" completes and the list says "Noch keine Spiele".
// 4. Device D (iPad landscape, English, dark): Erweitert with the sync section.
import { chromium } from "playwright"
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BASE = process.env.BASE ?? "http://localhost:3312"
const OUT = process.env.OUT ?? "/tmp/blueline-sync-shots"
mkdirSync(OUT, { recursive: true })
const NAK = "/opt/homebrew/bin/nak"
const PORTS = [18961, 18962, 18963]
const RELAYS = PORTS.slice(0, 2).map((p) => `ws://127.0.0.1:${p}`)
const EXTRA_RELAY = `ws://127.0.0.1:${PORTS[2]}`
const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const req = (args, relays = RELAYS) => execFileSync(NAK, ["req", ...args, ...relays], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
// Waits for a condition instead of a fixed time (the sync runs a little after a change).
async function until(condition, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await sleep(500)
  }
  return false
}
const records = (relay) => req(["-k", "30078", "-a", pubkey], [relay])

// --- relays and the signer app --------------------------------------------------------------
const relays = new Map()
const startRelays = async (ports = PORTS) => {
  for (const port of ports) relays.set(port, spawn(NAK, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: "ignore" }))
  await sleep(1200)
}
const stopRelays = async () => {
  for (const child of relays.values()) child.kill("SIGTERM")
  relays.clear()
  await sleep(500)
}
await startRelays()
const secret = execFileSync(NAK, ["key", "generate"]).toString().trim()
const pubkey = execFileSync(NAK, ["key", "public", secret]).toString().trim()
const bunkerHome = mkdtempSync(join(tmpdir(), "nak-bunker-"))
const bunker = spawn(NAK, ["bunker", "--sec", secret, RELAYS[0]], { env: { ...process.env, HOME: bunkerHome }, stdio: "ignore" })
await sleep(2500)

const browser = await chromium.launch()
const cleanup = async () => {
  await browser.close().catch(() => {})
  bunker.kill("SIGTERM")
  await stopRelays()
}
process.on("uncaughtException", async (error) => {
  console.error(error)
  await cleanup()
  process.exit(2)
})
async function open({ seed = null, viewport = { width: 390, height: 844 }, locale = "de-DE", colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, locale, hasTouch: true, isMobile: viewport.width < 800, serviceWorkers: "block", colorScheme })
  await ctx.addInitScript(
    ({ seed, theme }) => {
      localStorage.setItem("theme", theme)
      if (sessionStorage.getItem("seeded")) return
      sessionStorage.setItem("seeded", "1")
      if (seed) localStorage.setItem("dart-scorer.current-match.v1", seed)
    },
    { seed: seed ? JSON.stringify(seed) : null, theme: colorScheme },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  return { ctx, page, errors }
}
const tab = (page, name) => page.getByRole("navigation", { name: /Bereiche|Sections/ }).last().getByRole("button", { name, exact: true })
const idb = (page, store, id) =>
  page.evaluate(
    ([store, id]) =>
      new Promise((resolve) => {
        const request = indexedDB.open("blueline")
        request.onsuccess = () => {
          const s = request.result.transaction(store).objectStore(store)
          const get = id ? s.get(id) : s.getAll()
          get.onsuccess = () => resolve(get.result ?? null)
        }
      }),
    [store, id ?? null],
  )

// Signs in with the signer app on this page (German or English labels).
async function signInWithBunker(page) {
  await page.getByRole("button", { name: /Ich habe schon ein Profil|I already have a profile/ }).click()
  await page.getByRole("button", { name: /Mit einer anderen App|another app/i }).click()
  await page.getByRole("button", { name: /Signer-App|Signer app/ }).click()
  const link = page.getByRole("link", { name: /In der Signer-App|in the signer app/i })
  await link.waitFor({ timeout: 15000 })
  const uri = await link.getAttribute("href")
  execFileSync(NAK, ["bunker", "connect", uri], { env: { ...process.env, HOME: bunkerHome }, stdio: "ignore", timeout: 30000 })
  await page.getByRole("button", { name: /Ja, das bin ich|Yes, that's me/ }).click({ timeout: 20000 })
}

const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
// 101, double out: Lena T20, 1, D20 wins in three darts.
const finishedGame = {
  id: `g-${Math.random().toString(36).slice(2)}`,
  startedAt: "2026-10-06T18:00:00.000Z",
  acknowledgedLegs: 0,
  status: "playing",
  config: { modeId: "301", modeName: "301", type: "x01", startScore: 101, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: [{ id: "s0", name: "Lena" }, { id: "s1", name: "Ben" }] },
  throws: [dart(20, 3), dart(1), dart(20, 2)],
}
const syncSection = (page) => page.locator("section").filter({ has: page.getByRole("heading", { name: /^(Abgleich|Sync)$/ }) })

// --- 1. Device A -----------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open({ seed: finishedGame })
  await page.goto(BASE)
  await page.getByRole("dialog").waitFor({ timeout: 15000 })
  await sleep(800)
  await page.getByRole("dialog").getByRole("button", { name: "Fertig" }).click()
  await sleep(600)
  await tab(page, "Profil").click()
  await sleep(1000)
  await signInWithBunker(page)
  await page.getByRole("radio", { name: /Lena/ }).click({ timeout: 15000 })
  await page.getByRole("button", { name: "Fertig" }).click()
  await page.locator('[data-tab-panel="profile"]').getByText("Lena").first().waitFor({ timeout: 15000 })
  await sleep(1500)
  check("device A: the profile shows the claimed game", (await page.locator('[data-tab-panel="profile"]').getByText(/Gewonnen gegen Ben/).count()) >= 1)
  // The claimed game and its players go out a little after the change (lib/sync/service.ts).
  check("device A: the records reach both relays on their own", await until(() => RELAYS.every((relay) => records(relay).length === 3)))

  await page.getByRole("button", { name: "Erweitert" }).click()
  await page.getByText("Vollständig").waitFor({ timeout: 25000 })
  await sleep(800)
  await syncSection(page).scrollIntoViewIfNeeded()
  await sleep(400)
  await page.screenshot({ path: `${OUT}/a-advanced-sync-de.png` })
  const section = await syncSection(page).innerText()
  check("Erweitert: synced today, complete, nothing waiting, nothing with fewer than two copies", /Zuletzt abgeglichen[\s\S]*Vollständig[\s\S]*Heute/.test(section) && /Wartende Übertragungen\s*0/.test(section) && /Weniger als zwei bestätigte Kopien\s*0/.test(section), section.replace(/\s+/g, " "))

  for (const relay of RELAYS) {
    const found = records(relay)
    const opaque = found.every((r) => r.tags.length === 1 && r.tags[0][0] === "d" && /^[0-9a-f]{64}$/.test(r.tags[0][1]))
    const unreadable = found.every((r) => !/Lena|Ben|301|match|players/.test(r.content))
    const verified = found.length > 0 && execFileSync(NAK, ["verify"], { input: `${found.map((r) => JSON.stringify(r)).join("\n")}\n` }).toString().trim() === ""
    check(`${relay}: data key, game and players as three opaque records, verified by nak, unreadable`, found.length === 3 && opaque && unreadable && verified, `${found.length} records`)
  }

  // A dead address is refused with NIP-11; a live relay is added, and the next sync fills it.
  await page.getByLabel("Relay hinzufügen").fill("ws://127.0.0.1:18999")
  await page.getByRole("button", { name: "Hinzufügen" }).click()
  await page.getByText("Unter dieser Adresse antwortet kein Relay.").waitFor({ timeout: 15000 })
  check("a dead relay address is refused after the NIP-11 check", true)
  await page.getByLabel("Relay hinzufügen").fill(EXTRA_RELAY)
  await page.getByRole("button", { name: "Hinzufügen" }).click()
  await page.getByText(`127.0.0.1:${PORTS[2]}`).first().waitFor({ timeout: 15000 })
  await sleep(1500)
  const [list] = req(["-k", "10002", "-a", pubkey], [RELAYS[0]])
  check("the relay list on the relays names the new relay", list && list.tags.some((t) => t[0] === "r" && t[1] === EXTRA_RELAY), JSON.stringify(list?.tags))
  await page.getByRole("button", { name: "Jetzt abgleichen" }).click()
  check("after 'Jetzt abgleichen' the new relay has every record", await until(() => records(EXTRA_RELAY).length === 3))

  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {})
  await page.getByRole("button", { name: "Diagnose kopieren" }).click()
  await sleep(1200)
  const report = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "")
  check("the diagnostics have the sync section and no secret", /## Sync\n[\s\S]*outbox: \d+ waiting[\s\S]*fewer than 2 confirmed copies: \d+[\s\S]*last sync: 20/.test(report) && !/nsec1|[0-9a-f]{64}/.test(report), report.replace(/\n/g, " | ").slice(0, 300))
  // The browser logs the refused NIP-11 fetch of the dead address as a failed resource load; the
  // app handled it (the address was refused above). Anything else is an error.
  const unexpected = errors.filter((e) => !/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT/.test(e))
  check("no console errors (device A)", unexpected.length === 0, unexpected.join(" | "))
  await ctx.close()
}

// --- 2. Device B -----------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open({ locale: "en-US" })
  await page.goto(BASE)
  await page.waitForLoadState("networkidle")
  await tab(page, "Profile").click()
  await sleep(1000)
  await signInWithBunker(page)
  await page.locator('[data-tab-panel="profile"]').getByText(/Won against Ben/).waitFor({ timeout: 25000 })
  await sleep(800)
  await page.screenshot({ path: `${OUT}/b-profile-en.png` })
  const games = await idb(page, "matches")
  const players = await idb(page, "players")
  check("device B: the game arrived whole (throws, players, linked profile) without any claim", games.length === 1 && games[0].source === "local" && games[0].throws.length === 3 && games[0].players[0].pubkey === pubkey && players.some((p) => p.name === "Ben") && players.some((p) => p.name === "Lena" && p.pubkey === pubkey), JSON.stringify(games.map((g) => [g.id, g.source, g.throws?.length])))
  await page.getByRole("button", { name: /^Games/ }).click()
  await sleep(1000)
  check("device B: Games lists it", (await page.getByText(/Won against Ben/).count()) >= 1)
  check("no console errors (device B)", errors.length === 0, errors.join(" | "))
  await ctx.close()
}

// --- 3. Device C: a new profile while no relay answers ----------------------------------------
bunker.kill("SIGTERM")
await stopRelays()
{
  const { ctx, page, errors } = await open({ viewport: { width: 320, height: 548 } })
  await page.goto(BASE)
  await page.waitForLoadState("networkidle")
  await tab(page, "Profil").click()
  await sleep(1000)
  await page.getByRole("button", { name: "Profil anlegen" }).first().click()
  await page.getByLabel("Anzeigename").fill("Mia")
  await page.getByRole("button", { name: "Profil anlegen" }).click()
  await page.getByText("Spiele von deinen anderen Geräten erscheinen, sobald eine Verbindung besteht.").waitFor({ timeout: 25000 })
  await sleep(600)
  await page.screenshot({ path: `${OUT}/c-profile-se-unavailable.png` })
  check("device C: the profile says the games couldn't be loaded yet, not 'no games'", (await page.getByText(/Noch keine X01-Spiele/).count()) === 0)
  const panel = page.locator('[data-tab-panel="profile"]')
  await panel.getByRole("button", { name: /^Spiele/ }).click()
  await page.getByText("Deine Spiele konnten noch nicht geladen werden").waitFor({ timeout: 10000 })
  await sleep(500)
  await page.screenshot({ path: `${OUT}/c-games-se-unavailable.png` })
  check("device C: Spiele offers 'Erneut versuchen' instead of an empty list", (await page.getByRole("button", { name: "Erneut versuchen" }).count()) === 1)
  await panel.getByRole("button", { name: /Zurück zu Profil/ }).click()
  await sleep(800)
  await page.getByRole("button", { name: "Erweitert" }).click()
  await page.getByText("Kein Relay hat geantwortet.").waitFor({ timeout: 10000 })
  await syncSection(page).scrollIntoViewIfNeeded()
  await sleep(500)
  await page.screenshot({ path: `${OUT}/c-advanced-se-unavailable.png` })
  const offline = await syncSection(page).innerText()
  check("device C: Erweitert says unavailable, never synced, with waiting events", /Nicht verfügbar/.test(offline) && /Noch nie/.test(offline) && /Wartende Übertragungen\s*[1-9]/.test(offline), offline.replace(/\s+/g, " "))

  await startRelays()
  await page.getByRole("button", { name: "Jetzt abgleichen" }).click()
  await page.getByText("Vollständig").waitFor({ timeout: 25000 })
  const sent = await until(async () => /Wartende Übertragungen\s*0/.test(await syncSection(page).innerText()), 15000)
  const back = await syncSection(page).innerText()
  check("device C: after 'Jetzt abgleichen' everything is sent and complete", sent && /Vollständig/.test(back), back.replace(/\s+/g, " "))
  await page.screenshot({ path: `${OUT}/c-advanced-se-complete.png` })
  await panel.getByRole("button", { name: /Zurück zu Profil/ }).click()
  await sleep(800)
  await panel.getByRole("button", { name: /^Spiele/ }).click()
  await page.getByText("Noch keine Spiele").waitFor({ timeout: 10000 })
  await sleep(400)
  await page.screenshot({ path: `${OUT}/c-games-se-none.png` })
  check("device C: now the list honestly says 'Noch keine Spiele'", true)
  const scroll = await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1)
  check("device C: no horizontal scrolling at 320 pt", !scroll)
  // While the relays were down, the browser logged each refused WebSocket connection; the app
  // showed that honestly above. Anything else is an error.
  const unexpected = errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e))
  check("no console errors (device C)", unexpected.length === 0, unexpected.join(" | "))
  await ctx.close()
}

// --- 4. Device D: iPad landscape, English, dark -----------------------------------------------
{
  const { ctx, page, errors } = await open({ viewport: { width: 1024, height: 768 }, locale: "en-US", colorScheme: "dark" })
  await page.goto(BASE)
  await page.waitForLoadState("networkidle")
  await tab(page, "Profile").click()
  await sleep(1000)
  await page.getByRole("button", { name: "Create profile" }).first().click()
  await page.getByLabel("Display name").fill("Sam")
  await page.getByRole("button", { name: "Create profile" }).click()
  await page.locator('[data-tab-panel="profile"]').getByText("Sam").first().waitFor({ timeout: 15000 })
  await sleep(1000)
  await page.getByRole("button", { name: "Advanced" }).click()
  await page.getByText("Complete").waitFor({ timeout: 25000 })
  await syncSection(page).scrollIntoViewIfNeeded()
  await sleep(500)
  await page.screenshot({ path: `${OUT}/d-advanced-ipad-en-dark.png` })
  check("device D: English Advanced shows the sync as complete", /Last synced[\s\S]*Complete/.test(await syncSection(page).innerText()))
  check("no console errors (device D)", errors.length === 0, errors.join(" | "))
  await ctx.close()
}

await cleanup()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
