// Every profile screen on the reference sizes (DESIGN.md §3), against the same build and relays
// as profile-checks.mjs (ONLY=se,ipad limits the sizes), audited for horizontal scrolling,
// content off screen, "…" truncation, text overflowing its control and touch targets under
// 44 × 44 pt. German light everywhere, English dark on three sizes.
import { chromium } from "playwright"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { encodeLinkPayload } from "../../../../../lib/protocol/links.ts"

const BASE = process.env.BASE ?? "http://localhost:3311"
const OUT = process.env.OUT ?? "/tmp/blueline-profile-shots"
mkdirSync(OUT, { recursive: true })
const NAK = "/opt/homebrew/bin/nak"
const RELAYS = ["ws://127.0.0.1:18951", "ws://127.0.0.1:18952"]
const tomSecret = execFileSync(NAK, ["key", "generate"]).toString().trim()
const tomPub = execFileSync(NAK, ["key", "public", tomSecret]).toString().trim()
execFileSync(NAK, ["event", "-k", "0", "-c", JSON.stringify({ name: "Maximilian Alexander von Testhausen" }), "--sec", tomSecret, ...RELAYS], { stdio: "ignore" })
const tomNpub = execFileSync(NAK, ["encode", "npub", tomPub]).toString().trim()

const SIZES = { se: [320, 548], iphone: [390, 844], "se-landscape": [568, 320], "iphone-landscape": [844, 390], ipad: [768, 1024], "ipad-landscape": [1024, 768], desktop: [1440, 900] }
const ONLY = process.env.ONLY?.split(",")
const ALL_RUNS = [
  ...Object.keys(SIZES).map((size) => ({ size, locale: "de", scheme: "light" })),
  ...["se", "iphone-landscape", "ipad-landscape"].map((size) => ({ size, locale: "en", scheme: "dark" })),
]
const RUNS = ONLY ? ALL_RUNS.filter((r) => ONLY.includes(r.size)) : ALL_RUNS
const T = {
  de: { resume: /Weiterspielen/, keep: "Deine Ergebnisse mitnehmen", name: "Anzeigename", create: "Profil anlegen", done: "Fertig", tabs: "Bereiche", profile: "Profil", play: "Spielen", stats: "Statistik", games: /^Spiele \d/, won: /Gewonnen gegen/, back: /^Zurück zu/, preview: "So sehen andere dein Profil", toggle: "Statistik im Profil zeigen", advanced: "Erweitert", scan: "Spieler per QR hinzufügen", paste: "Link oder Code einfügen", open: "Öffnen", add: "Zum Spiel hinzufügen", save: "Runde speichern", roundName: "Name der Runde", saveIt: "Speichern", signOut: "Abmelden", keepGames: "Abmelden, Spiele behalten", have: "Ich habe schon ein Profil", fromApp: /Mit einer anderen App/, signerApp: /Signer-App/, cancel: "Abbrechen", createRow: "Profil anlegen" },
  en: { resume: /Continue/, keep: "Keep your results", name: "Display name", create: "Create profile", done: "Done", tabs: "Sections", profile: "Profile", play: "Play", stats: "Statistics", games: /^Games \d/, won: /Won against/, back: /^Back to/, preview: "How others see your profile", toggle: "Show statistics in profile", advanced: "Advanced", scan: "Add player by QR code", paste: "Paste link or code", open: "Open", add: "Add to game", save: "Save group", roundName: "Name of the group", saveIt: "Save", signOut: "Sign out", keepGames: "Sign out, keep games", have: "I already have a profile", fromApp: /With another app/, signerApp: /Signer app/, cancel: "Cancel", createRow: "Create profile" },
}

const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
const nearWin = (names) => ({
  id: `near-win-${Math.random().toString(36).slice(2)}`,
  startedAt: "2026-10-05T18:00:00.000Z",
  acknowledgedLegs: 0,
  status: "paused",
  config: { modeId: "301", modeName: "301", type: "x01", startScore: 301, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: names.map((name, i) => ({ id: `s${i}`, name })) },
  throws: [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)],
})

const audit = () => {
  const vw = innerWidth
  const shown = (el) => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false
    const s = getComputedStyle(el)
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight
  }
  const all = Array.from(document.querySelectorAll("body *")).filter(shown)
  const describe = (el) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}`
  const pageScroll = document.scrollingElement.scrollWidth > vw + 1
  const offscreen = all.filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 }).map(describe)
  const ellipsis = all.filter((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1).map(describe)
  const literal = all.filter((el) => el.children.length === 0 && /…/.test(el.textContent ?? "")).map(describe)
  const controls = all.filter((el) => el.matches('button, a[href], [role="radio"]'))
  const overflowing = controls.filter((el) => el.scrollWidth > el.clientWidth + 1).map(describe)
  const small = all
    .filter((el) => el.matches('button, a[href], input, [role="radio"], summary') && !el.closest("[data-vaul-drawer] [data-vaul-handle]"))
    .map((el) => (el.matches('[role="switch"]') && el.closest("label") ? el.closest("label") : el))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 })
    .map((el) => { const r = el.getBoundingClientRect(); return `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}` })
  return { pageScroll, offscreen: offscreen.slice(0, 5), ellipsis: [...ellipsis, ...literal], overflowing, small }
}

const browser = await chromium.launch()
const report = []
let profileLink = null
for (const { size, locale, scheme } of RUNS) {
  const t = T[locale]
  const [width, height] = SIZES[size]
  const ctx = await browser.newContext({ viewport: { width, height }, locale: locale === "de" ? "de-DE" : "en-US", colorScheme: scheme, hasTouch: width < 1400, isMobile: width < 1400, deviceScaleFactor: 2, serviceWorkers: "block" })
  await ctx.addInitScript(([c, theme]) => {
    localStorage.setItem("theme", theme)
    if (sessionStorage.getItem("seeded")) return
    sessionStorage.setItem("seeded", "1")
    localStorage.setItem("dart-scorer.current-match.v1", c)
  }, [JSON.stringify(nearWin(["Anna", "Benedikt-Maximilian"])), scheme])
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  const wait = (ms = 700) => page.waitForTimeout(ms)
  const label = `${size}-${locale}-${scheme}`
  const snap = async (screen) => {
    await wait(350)
    const name = `${screen}-${label}`
    await page.screenshot({ path: `${OUT}/${name}.png` })
    const found = await page.evaluate(audit)
    report.push({ screen, size, locale, scheme, ...found })
  }
  const tabs = () => page.getByRole("navigation", { name: t.tabs }).last()
  const back = () => page.getByRole("button", { name: t.back }).last().click()
  try {
    await page.goto(BASE)
    await page.waitForLoadState("networkidle")
    await page.getByRole("button", { name: t.resume }).first().click()
    await wait(900)
    await page.keyboard.press("b")
    await wait(1600)
    await snap("result-offer")
    await page.getByRole("button", { name: t.keep }).click()
    await wait(900)
    await snap("keep-sheet")
    await page.getByRole("radio", { name: "Anna" }).click()
    await page.getByLabel(t.name).fill("Anna Schmidt-Wellenbrink")
    await snap("keep-sheet-filled")
    await page.getByRole("button", { name: t.create }).click()
    await wait(2000)
    await snap("result-created")
    await page.getByRole("button", { name: t.done, exact: true }).click()
    await wait(900)
    await tabs().getByRole("button", { name: t.profile, exact: true }).click()
    await wait(1500)
    await snap("profile")
    await page.getByRole("button", { name: t.stats }).click()
    await wait(1000)
    await snap("stats")
    await back()
    await wait(700)
    await page.getByRole("button", { name: t.games }).click()
    await wait(900)
    await page.getByRole("button", { name: t.won }).click()
    await wait(1200)
    await snap("match")
    await back()
    await wait(600)
    await back()
    await wait(700)
    await page.getByRole("button", { name: t.preview }).click()
    await wait(1500)
    await page.getByText(t.toggle).click()
    await wait(2500)
    await snap("preview")
    await back()
    await wait(700)
    await page.getByRole("button", { name: t.advanced }).click()
    await wait(1500)
    await snap("advanced")
    await back()
    await wait(700)
    if (!profileLink) {
      const pubkey = await page.evaluate(() => new Promise((resolve) => {
        const request = indexedDB.open("blueline")
        request.onsuccess = () => {
          const get = request.result.transaction("kv").objectStore("kv").get("profile.session")
          get.onsuccess = () => resolve(get.result?.value?.pubkey)
        }
      }))
      profileLink = `${BASE}/#p=${encodeLinkPayload({ type: "profile", pubkey, relays: [] })}`
    }
    await tabs().getByRole("button", { name: t.play, exact: true }).click()
    await wait(800)
    await page.getByRole("button", { name: /^X01/ }).first().click()
    await wait(1200)
    await page.getByRole("button", { name: t.scan }).click()
    await wait(1200)
    await snap("scan-sheet")
    await page.getByLabel(t.paste).fill(tomNpub)
    await page.getByRole("button", { name: t.open, exact: true }).click()
    await wait(2500)
    await snap("scan-found")
    await page.getByRole("button", { name: t.add }).click()
    await wait(900)
    await page.getByRole("button", { name: t.save }).click()
    await wait(1000)
    await page.getByLabel(t.roundName).fill("Dienstagsrunde im Vereinsheim")
    await page.getByRole("button", { name: t.saveIt, exact: true }).click()
    await wait(2500)
    await page.evaluate(() => { const main = document.querySelector("main"); main?.scrollIntoView({ block: "end" }) })
    await page.getByRole("button", { name: t.scan }).scrollIntoViewIfNeeded()
    await snap("setup-players")
    await page.getByRole("button", { name: /^(Spielen|Play)$/ }).first().click()
    await wait(1000)
    await tabs().getByRole("button", { name: t.profile, exact: true }).click()
    await wait(800)
    await page.getByRole("button", { name: t.signOut }).click()
    await wait(800)
    await snap("sign-out")
    await page.getByRole("button", { name: t.keepGames }).click()
    await wait(1500)
    await page.getByRole("button", { name: t.createRow }).first().click()
    await wait(1500)
    await snap("create")
    await back()
    await wait(700)
    await page.getByRole("button", { name: t.have }).click()
    await wait(900)
    await page.getByRole("button", { name: t.fromApp }).click()
    await wait(1200)
    await snap("connect")
    await page.getByRole("button", { name: t.signerApp }).click()
    await wait(2500)
    await snap("connect-signer-app")
    await page.goto(profileLink)
    await wait(3000)
    await snap("public")
  } catch (error) {
    report.push({ screen: "flow", size, locale, scheme, error: String(error).slice(0, 300) })
    await page.screenshot({ path: `${OUT}/error-${label}.png` })
  }
  if (errors.length) report.push({ screen: "console", size, locale, scheme, errors })
  await ctx.close()
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
const problems = report.filter((r) => r.error || r.errors || r.pageScroll || r.offscreen?.length || r.ellipsis?.length || r.overflowing?.length || r.small?.length)
console.log(`${report.length} entries, ${problems.length} with findings`)
for (const p of problems) console.log(JSON.stringify(p))
