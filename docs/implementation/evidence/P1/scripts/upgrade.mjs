// Run from the repository root against a production build (npm run build && npx next start -p 3201):
//   [OUT=<folder for screenshots>] node docs/implementation/evidence/P1/scripts/upgrade.mjs dark 390x844
// BASE overrides the address (default http://localhost:3201).
// Scenario A: a device that ran 1.0.0 (history + a game in progress with seat-only ids) opens
// this version, finishes the game, looks at the Rangliste, assigns imported games, then
// exports, deletes everything and imports the file again.
import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"

const BASE = process.env.BASE ?? "http://localhost:3201"
const OUT = `${process.env.OUT ?? `${os.tmpdir()}/blueline-p1-shots`}/`
fs.mkdirSync(OUT, { recursive: true })
const theme = process.argv[2] ?? "dark"
const [w, h] = (process.argv[3] ?? "390x844").split("x").map(Number)
const tag = `${theme}-${w}x${h}`

const v1History = [
  {
    id: "mut3p9t1-9znimr",
    finishedAt: "2026-09-20T20:00:00.000Z",
    modeId: "501",
    modeName: "501",
    modeType: "x01",
    players: [
      { name: "Anna", won: true, darts: 18, points: 501 },
      { name: "Ben", won: false, darts: 18, points: 400 },
    ],
  },
  {
    id: "mut3p9t2-aaaaaa",
    finishedAt: "2026-09-19T20:00:00.000Z",
    modeId: "301",
    modeName: "301",
    modeType: "x01",
    players: [
      { name: "Spieler 1", won: false, darts: 15, points: 250 },
      { name: "Ben", won: true, darts: 15, points: 301 },
    ],
  },
]
const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
// Anna T20 T20 T20 · Ben 20 20 20 · Anna T20 T15, 16 left, her third dart to come.
const throwsRaw = [dart(20, 3), dart(20, 3), dart(20, 3), dart(20), dart(20), dart(20), dart(20, 3), dart(15, 3)]
const current = {
  id: "mut9zzzz-legacy",
  config: {
    modeId: "301",
    modeName: "301",
    type: "x01",
    startScore: 301,
    doubleOut: true,
    doubleIn: false,
    cutThroat: false,
    bullFinish: false,
    legsToWin: 1,
    setsToWin: 1,
    startRule: "alternate",
    players: [
      { id: "pmut9a0", name: "Anna" },
      { id: "pmut9a1", name: "Ben" },
    ],
  },
  throws: throwsRaw,
  startedAt: "2026-10-04T05:00:00.000Z",
  acknowledgedLegs: 0,
  status: "playing",
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 2,
  locale: "de-DE",
  colorScheme: theme,
  hasTouch: true,
  isMobile: w < 800,
  acceptDownloads: true,
})
const page = await context.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

// Seed 1.0.0 data before the first load only.
await page.goto(`${BASE}/about`)
await page.evaluate(
  ({ v1History, current, theme }) => {
    localStorage.clear()
    localStorage.setItem("dart-scorer.matches.v1", JSON.stringify(v1History))
    localStorage.setItem("dart-scorer.current-match.v1", JSON.stringify(current))
    localStorage.setItem("theme", theme)
  },
  { v1History, current, theme },
)
await page.goto(BASE)
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}${tag}-01-resumed-game.png` })

// Anna's checkout: Double, then D8.
await page.getByRole("button", { name: "Double", exact: true }).click()
await page.getByRole("button", { name: "D8", exact: true }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}${tag}-02-result.png` })

const readArchive = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("blueline", 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(["matches", "players"], "readonly")
          const m = tx.objectStore("matches").getAll()
          const p = tx.objectStore("players").getAll()
          tx.oncomplete = () => {
            db.close()
            resolve({ matches: m.result, players: p.result })
          }
        }
      }),
  )
const first = await readArchive()
const local = first.matches.find((m) => m.id === "mut9zzzz-legacy")
console.log("archived after win:", local && { source: local.source, finishedAt: local.finishedAt, throws: local.throws.length, players: local.players.map((p) => [p.name, p.playerId]) })
console.log("directory:", first.players.map((p) => [p.name, p.id]))

// Reload on the result screen: the finish time must stay.
await page.waitForTimeout(1200)
await page.reload()
await page.waitForTimeout(1500)
const second = await readArchive()
const again = second.matches.find((m) => m.id === "mut9zzzz-legacy")
const v1 = JSON.parse(await page.evaluate(() => localStorage.getItem("dart-scorer.matches.v1")))
console.log("finishedAt after reload:", again.finishedAt, again.finishedAt === local.finishedAt ? "(unchanged)" : "(CHANGED)")
console.log("v1 copy:", v1.map((r) => [r.id, r.finishedAt]))

// To the Rangliste from the result screen.
await page.getByRole("button", { name: "Rangliste", exact: true }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}${tag}-03-leaderboard.png`, fullPage: true })

// The imported Anna row opens the sheet.
await page.getByRole("button", { name: /Anna.*Importiert/ }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}${tag}-04-imported-sheet.png` })
await page.getByRole("button", { name: "Zu Anna zählen" }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}${tag}-05-leaderboard-merged.png`, fullPage: true })

// The merged row offers to separate again.
await page.getByRole("button", { name: /Anna.*Mit früheren Spielen/ }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}${tag}-06-merged-sheet.png` })
await page.getByRole("button", { name: "Fertig" }).click()
await page.waitForTimeout(600)

// Settings › Daten.
await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
await page.waitForTimeout(800)
await page.getByRole("heading", { name: "Daten" }).scrollIntoViewIfNeeded()
await page.screenshot({ path: `${OUT}${tag}-07-settings-data.png` })

// Export.
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Daten exportieren" }).click()])
const file = `${OUT}${tag}-export.json`
await download.saveAs(file)
const exported = JSON.parse(fs.readFileSync(file, "utf8"))
console.log("export:", download.suggestedFilename(), { format: exported.format, version: exported.version, matches: exported.matches.length, players: exported.players.length, v1Keys: Object.keys(exported.v1).length })

// Delete everything (red, confirmed).
await page.getByRole("button", { name: "Alle Daten auf diesem Gerät löschen" }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}${tag}-08-wipe-confirm.png` })
await page.getByRole("button", { name: "Alles löschen" }).click()
await page.waitForURL(BASE + "/")
await page.waitForTimeout(1200)
const afterWipe = await page.evaluate(() => Object.keys(localStorage))
const archiveAfterWipe = await readArchive()
console.log("after wipe: localStorage keys", afterWipe, "archive", archiveAfterWipe.matches.length, "players", archiveAfterWipe.players.length)
// Import the file again.
await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
await page.waitForTimeout(800)
await page.locator('input[type="file"]').setInputFiles(file)
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}${tag}-09-import-result.png` })
await page.getByRole("button", { name: "OK" }).click()
// Import the same file a second time: nothing new.
await page.locator('input[type="file"]').setInputFiles(file)
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}${tag}-10-import-again.png` })
await page.getByRole("button", { name: "OK" }).click()
await page.getByRole("button", { name: "Rangliste", exact: true }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}${tag}-11-leaderboard-after-import.png`, fullPage: true })

// A file that isn't an export.
fs.writeFileSync(`${OUT}not-an-export.json`, JSON.stringify({ hello: "world" }))
await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
await page.waitForTimeout(600)
await page.locator('input[type="file"]').setInputFiles(`${OUT}not-an-export.json`)
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}${tag}-12-import-wrong-file.png` })

console.log("page errors:", errors)
await browser.close()
