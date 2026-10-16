// Sync checks against a production build whose NEXT_PUBLIC_BLUELINE_RELAYS points at two local
// "nak serve" relays (ws://127.0.0.1:20040 and :20041). A third relay (:20042) is added under
// Erweitert; a fourth (:20043) only carries a signer. The script runs the relays and the "nak
// bunker" signers itself; the app server runs outside:
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20040,ws://127.0.0.1:20041 npm run build
//   npx next start -p 3312
//   node docs/implementation/evidence/P3b/scripts/sync-checks.mjs   (BASE, OUT optional)
//
// 1. Device A (signer app, 390 × 844, German): a finished game, sign-in through nak bunker, the
//    game claimed. A profile in a signer app is asked to sign only at start, on request and when
//    the app hides, so the game waits here and Erweitert says "Noch nicht gesendet 2"; after
//    "Jetzt abgleichen" the records on both relays are kind 30078 with one opaque d tag, verified
//    by nak, unreadable, and Erweitert says "Vollständig" without that row. One relay
//    stopped: "Jetzt abgleichen" says "Teilweise · Nicht jedes Relay hat geantwortet." in the
//    row itself and the relay list says "Nicht erreichbar" for that relay; restarted empty:
//    "Vollständig", the relay holds every record again and says "Verbunden". A dead address is
//    refused, a live one added and filled; "Diagnose kopieren" has the sync section, no secret.
// 2. Device B (signer app, English): signs in, finds device A's game without any claim.
// 3. Device C (new local profile while every relay is down, iPhone SE): a profile made here
//    promises nothing from other devices: the card says "Noch keine X01-Spiele", Spiele "Noch
//    keine Spiele"; Erweitert says "Nicht verfügbar · Kein Relay hat geantwortet." and what is
//    not sent yet. Once the relays are back, "Jetzt abgleichen" shows "Wird abgeglichen", then
//    "Vollständig", and the not-sent row is gone.
// 4. Device E (profile from elsewhere, bunker link, while the app's relays are down): the card
//    and Spiele say the games couldn't be loaded yet; "Erneut versuchen" is the filled primary
//    button and shows "werden geladen" for a moment; with the relays back it ends in "Noch keine
//    Spiele".
// 5. Device D (iPad landscape, English, dark): Advanced with the sync section complete.
import { chromium } from "playwright"
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BASE = process.env.BASE ?? "http://localhost:3312"
const OUT = process.env.OUT ?? "/tmp/blueline-sync-shots"
mkdirSync(OUT, { recursive: true })
const NAK = "/opt/homebrew/bin/nak"
const PORTS = { general: [20040, 20041], extra: 20042, signer: 20043, dead: 20049 }
const url = (port) => `ws://127.0.0.1:${port}`
const RELAYS = PORTS.general.map(url)
const EXTRA_RELAY = url(PORTS.extra)
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
const compact = (text) => text.replace(/\s+/g, " ")

// --- relays and the signer apps -------------------------------------------------------------
const relays = new Map()
const startRelays = async (ports) => {
  for (const port of ports) relays.set(port, spawn(NAK, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: "ignore" }))
  await sleep(1200)
}
const stopRelays = async (ports = [...relays.keys()]) => {
  for (const port of ports) {
    relays.get(port)?.kill("SIGTERM")
    relays.delete(port)
  }
  await sleep(500)
}
// A signer app for a throwaway key, listening on one relay.
async function startBunker(relayUrl) {
  const secret = execFileSync(NAK, ["key", "generate"]).toString().trim()
  const pubkey = execFileSync(NAK, ["key", "public", secret]).toString().trim()
  const home = mkdtempSync(join(tmpdir(), "nak-bunker-"))
  const child = spawn(NAK, ["bunker", "--sec", secret, relayUrl], { env: { ...process.env, HOME: home }, stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  child.stdout.on("data", (chunk) => (log += chunk))
  child.stderr.on("data", (chunk) => (log += chunk))
  await until(() => /bunker:\/\/\S+/.test(log), 10000)
  const uri = /(bunker:\/\/\S+)/.exec(log)?.[1]
  return { pubkey, uri, home, stop: () => child.kill("SIGTERM") }
}
await startRelays([...PORTS.general, PORTS.extra])
const bunker = await startBunker(RELAYS[0])
const pubkey = bunker.pubkey
const records = (relay) => req(["-k", "30078", "-a", pubkey], [relay])

const browser = await chromium.launch()
const bunkers = [bunker]
const cleanup = async () => {
  await browser.close().catch(() => {})
  for (const b of bunkers) b.stop()
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

// Opens "Mit einer anderen App › Signer-App" (German or English labels).
async function openSignerApp(page) {
  await page.getByRole("button", { name: /Ich habe schon ein Profil|I already have a profile/ }).click()
  await page.getByRole("button", { name: /Mit einer anderen App|another app/i }).click()
  await page.getByRole("button", { name: /Signer-App|Signer app/ }).click()
}
const confirmAccount = (page) => page.getByRole("button", { name: /Ja, das bin ich|Yes, that's me/ }).click({ timeout: 30000 })

// Signs in with the signer app over the nostrconnect code (what scanning the QR code does).
async function signInWithCode(page, signer) {
  await openSignerApp(page)
  const link = page.getByRole("link", { name: /In der Signer-App|in the signer app/i })
  await link.waitFor({ timeout: 15000 })
  const uri = await link.getAttribute("href")
  execFileSync(NAK, ["bunker", "connect", uri], { env: { ...process.env, HOME: signer.home }, stdio: "ignore", timeout: 30000 })
  await confirmAccount(page)
}

// Signs in with the signer app's own bunker:// link, pasted: it needs only the signer's relay.
async function signInWithLink(page, signer) {
  await openSignerApp(page)
  const field = page.getByLabel("Oder Verbindungslink einfügen")
  await field.fill(signer.uri)
  await field.press("Enter")
  await confirmAccount(page)
}

const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
// 101, double out: Lena T20, 1, D20 wins in three darts.
const finishedGame = {
  id: `g-${Math.random().toString(36).slice(2)}`,
  startedAt: "2026-10-16T18:00:00.000Z",
  acknowledgedLegs: 0,
  status: "playing",
  config: { modeId: "301", modeName: "301", type: "x01", startScore: 101, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: [{ id: "s0", name: "Lena" }, { id: "s1", name: "Ben" }] },
  throws: [dart(20, 3), dart(1), dart(20, 2)],
}
const section = (page, heading) => page.locator("section").filter({ has: page.getByRole("heading", { name: heading }) })
const syncSection = (page) => section(page, /^(Abgleich|Sync)$/)
const relaySection = (page) => section(page, /^Relays/)
const relayRow = (text, port, state) => new RegExp(`127\\.0\\.0\\.1:${port}\\s*${state}`).test(text)

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
  await signInWithCode(page, bunker)
  await page.getByRole("radio", { name: /Lena/ }).click({ timeout: 15000 })
  await page.getByRole("button", { name: "Fertig" }).click()
  await page.locator('[data-tab-panel="profile"]').getByText("Lena").first().waitFor({ timeout: 15000 })
  await sleep(1500)
  check("device A: the profile shows the claimed game", (await page.locator('[data-tab-panel="profile"]').getByText(/Gewonnen gegen Ben/).count()) >= 1)
  // A profile in a signer app is asked to sign only at start, on request and when the app hides
  // (lib/sync/service.ts): the claimed game and its players wait here, and Erweitert says so.
  await page.getByRole("button", { name: "Erweitert" }).click()
  await page.getByText("Vollständig").waitFor({ timeout: 25000 })
  check("Erweitert: 'Noch nicht gesendet 2' with the next step while the game waits for a sync that writes", await until(async () => /Noch nicht gesendet\s*Wird beim nächsten Abgleich gesendet\.\s*2/.test(await syncSection(page).innerText()), 30000), compact(await syncSection(page).innerText()))
  check("device A: nothing reached the relays on its own", RELAYS.every((relay) => records(relay).length === 0))
  await syncSection(page).scrollIntoViewIfNeeded()
  await sleep(400)
  await page.screenshot({ path: `${OUT}/a-advanced-pending-de.png` })
  await page.getByRole("button", { name: "Jetzt abgleichen" }).click()
  check("device A: 'Jetzt abgleichen' sends the records to both relays", await until(() => RELAYS.every((relay) => records(relay).length === 3)))
  await until(async () => !/Noch nicht gesendet/.test(await syncSection(page).innerText()), 15000)
  await sleep(400)
  await page.screenshot({ path: `${OUT}/a-advanced-sync-de.png` })
  let text = await syncSection(page).innerText()
  check("Erweitert: synced today, complete, and no row about things not sent", /Zuletzt abgeglichen\s*Vollständig\s*Heute/.test(text) && !/Noch nicht gesendet/.test(text) && !/Kopien zuletzt geprüft|Weniger als zwei/.test(text), compact(text))

  for (const relay of RELAYS) {
    const found = records(relay)
    const opaque = found.every((r) => r.tags.length === 1 && r.tags[0][0] === "d" && /^[0-9a-f]{64}$/.test(r.tags[0][1]))
    const unreadable = found.every((r) => !/Lena|Ben|301|match|players/.test(r.content))
    const verified = found.length > 0 && execFileSync(NAK, ["verify"], { input: `${found.map((r) => JSON.stringify(r)).join("\n")}\n` }).toString().trim() === ""
    check(`${relay}: data key, game and players as three opaque records, verified by nak, unreadable`, found.length === 3 && opaque && unreadable && verified, `${found.length} records`)
  }

  // One relay down: the row says so in one line, and the relay list agrees.
  await stopRelays([PORTS.general[1]])
  await page.getByRole("button", { name: "Jetzt abgleichen" }).click()
  await page.getByText("Nicht jedes Relay hat geantwortet.").waitFor({ timeout: 25000 })
  check("the relay list says the stopped relay is unreachable once the sync ended", await until(async () => relayRow(await relaySection(page).innerText(), PORTS.general[1], "Nicht erreichbar"), 15000))
  await sleep(400)
  await page.screenshot({ path: `${OUT}/a-advanced-partial-de.png` })
  text = await syncSection(page).innerText()
  check("Erweitert: 'Teilweise · Nicht jedes Relay hat geantwortet.' under 'Zuletzt abgeglichen', nothing waiting", /Zuletzt abgeglichen\s*Teilweise · Nicht jedes Relay hat geantwortet\.\s*Heute/.test(text) && !/Noch nicht gesendet/.test(text), compact(text))

  // Back, empty: the next sync fills it again, and both the row and the list say so.
  await startRelays([PORTS.general[1]])
  await page.getByRole("button", { name: "Jetzt abgleichen" }).click()
  check("after the restart the relay holds every record again", await until(() => records(RELAYS[1]).length === 3))
  check("Erweitert says 'Vollständig' again with nothing waiting", await until(async () => /Vollständig/.test(await syncSection(page).innerText()) && !/Noch nicht gesendet/.test(await syncSection(page).innerText()), 20000), compact(await syncSection(page).innerText()))
  check("the relay list says the restarted relay is connected", await until(async () => relayRow(await relaySection(page).innerText(), PORTS.general[1], "Verbunden"), 15000))

  // A dead address is refused with NIP-11; a live relay is added, and the next sync fills it.
  await page.getByLabel("Relay hinzufügen").fill(url(PORTS.dead))
  await page.getByRole("button", { name: "Hinzufügen" }).click()
  await page.getByText("Unter dieser Adresse antwortet kein Relay.").waitFor({ timeout: 15000 })
  check("a dead relay address is refused after the NIP-11 check", true)
  await page.getByLabel("Relay hinzufügen").fill(EXTRA_RELAY)
  await page.getByRole("button", { name: "Hinzufügen" }).click()
  await page.getByText(`127.0.0.1:${PORTS.extra}`).first().waitFor({ timeout: 15000 })
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
  // The browser logs refused connections (the dead address, the stopped relay) as failed loads;
  // the app handled them above. Anything else is an error.
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
  await signInWithCode(page, bunker)
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
bunker.stop()
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
  await page.getByText(/Noch keine X01-Spiele/).waitFor({ timeout: 25000 })
  await sleep(2500)
  await page.screenshot({ path: `${OUT}/c-profile-se-new.png` })
  check("device C: a profile made here promises nothing from other devices", (await page.getByText(/Spiele von deinen anderen Geräten|konnten noch nicht geladen/).count()) === 0 && (await page.getByText(/Noch keine X01-Spiele/).count()) === 1)
  const panel = page.locator('[data-tab-panel="profile"]')
  await panel.getByRole("button", { name: /^Spiele/ }).click()
  await page.getByText("Noch keine Spiele").waitFor({ timeout: 10000 })
  await sleep(500)
  await page.screenshot({ path: `${OUT}/c-games-se-none.png` })
  check("device C: Spiele says 'Noch keine Spiele' without a retry", (await page.getByRole("button", { name: "Erneut versuchen" }).count()) === 0)
  await panel.getByRole("button", { name: /Zurück zu Profil/ }).click()
  await sleep(800)
  await page.getByRole("button", { name: "Erweitert" }).click()
  await page.getByText("Kein Relay hat geantwortet.").waitFor({ timeout: 10000 })
  await syncSection(page).scrollIntoViewIfNeeded()
  await sleep(500)
  await page.screenshot({ path: `${OUT}/c-advanced-se-unavailable.png` })
  const offline = await syncSection(page).innerText()
  check("device C: Erweitert says unavailable with the reason in the row, and what is not sent yet", /Zuletzt abgeglichen\s*Nicht verfügbar · Kein Relay hat geantwortet\./.test(offline) && /Noch nicht gesendet\s*Wird beim nächsten Abgleich gesendet\.\s*[1-9]/.test(offline), compact(offline))

  await startRelays(PORTS.general)
  await page.getByRole("button", { name: "Jetzt abgleichen" }).click()
  const during = await syncSection(page).innerText()
  await page.screenshot({ path: `${OUT}/c-advanced-se-syncing.png` })
  check("device C: the tap shows 'Wird abgeglichen' at once", /Wird abgeglichen/.test(during), compact(during))
  await page.getByText("Vollständig").waitFor({ timeout: 25000 })
  const sent = await until(async () => !/Noch nicht gesendet/.test(await syncSection(page).innerText()), 15000)
  const back = await syncSection(page).innerText()
  check("device C: after 'Jetzt abgleichen' everything is sent and complete", sent && /Vollständig/.test(back), compact(back))
  await page.screenshot({ path: `${OUT}/c-advanced-se-complete.png` })
  const scroll = await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1)
  check("device C: no horizontal scrolling at 320 pt", !scroll)
  const unexpected = errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e))
  check("no console errors (device C)", unexpected.length === 0, unexpected.join(" | "))
  await ctx.close()
}

// --- 4. Device E: a profile from elsewhere while the app's relays are down --------------------
await stopRelays()
await startRelays([PORTS.signer])
const elsewhere = await startBunker(url(PORTS.signer))
bunkers.push(elsewhere)
{
  const { ctx, page, errors } = await open()
  await page.goto(BASE)
  await page.waitForLoadState("networkidle")
  await tab(page, "Profil").click()
  await sleep(1000)
  await signInWithLink(page, elsewhere)
  await page.getByText("Spiele von deinen anderen Geräten erscheinen, sobald eine Verbindung besteht.").waitFor({ timeout: 30000 })
  check("device E: the card says the games from other devices appear once there is a connection", true)
  const panel = page.locator('[data-tab-panel="profile"]')
  await panel.getByRole("button", { name: /^Spiele/ }).click()
  await page.getByText("Deine Spiele konnten noch nicht geladen werden").waitFor({ timeout: 10000 })
  await sleep(500)
  await page.screenshot({ path: `${OUT}/e-games-unavailable-de.png` })
  const retry = page.getByRole("button", { name: "Erneut versuchen" })
  const filled = await retry.evaluate((el) => getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)")
  check("device E: 'Erneut versuchen' is the one filled primary action", (await retry.count()) === 1 && filled)
  await retry.click()
  const loading = await page.getByText("Deine Spiele werden geladen").waitFor({ timeout: 1500 }).then(() => true, () => false)
  await page.screenshot({ path: `${OUT}/e-games-retrying-de.png` })
  check("device E: the tap shows the loading state although every relay refuses at once", loading)
  await page.getByText("Deine Spiele konnten noch nicht geladen werden").waitFor({ timeout: 10000 })
  await startRelays(PORTS.general)
  await retry.click()
  await page.getByText("Noch keine Spiele").waitFor({ timeout: 30000 })
  check("device E: with the relays back, 'Erneut versuchen' ends in 'Noch keine Spiele'", true)
  const unexpected = errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e))
  check("no console errors (device E)", unexpected.length === 0, unexpected.join(" | "))
  await ctx.close()
}

// --- 5. Device D: iPad landscape, English, dark -----------------------------------------------
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
  await until(async () => !/Not sent yet/.test(await syncSection(page).innerText()), 15000)
  await syncSection(page).scrollIntoViewIfNeeded()
  await sleep(500)
  await page.screenshot({ path: `${OUT}/d-advanced-ipad-en-dark.png` })
  const text = await syncSection(page).innerText()
  check("device D: English Advanced shows the sync as complete, nothing waiting", /Last synced\s*Complete\s*Today/.test(text) && !/Not sent yet/.test(text), compact(text))
  check("no console errors (device D)", errors.length === 0, errors.join(" | "))
  await ctx.close()
}

await cleanup()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
