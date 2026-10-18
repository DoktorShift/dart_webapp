// Loads / and /nostr-probe (scripts/nostr-probe.page.tsx.txt, copied into app/ for the run) in
// Chromium against `next start`, records every JS file and WebSocket each step opens, and
// reports gzip sizes (level 9) computed from the build output (.next). Usage:
//   node measure.mjs <worktree> <port> [relayUrl|default] [chromium|webkit]
import { chromium, webkit } from "playwright"
import { readFileSync, existsSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { join } from "node:path"

const [root, port, relayArg, engine = "chromium"] = process.argv.slice(2)
const relay = relayArg && relayArg !== "-" ? relayArg : ""
const base = `http://127.0.0.1:${port}`
const gz = (path) => gzipSync(readFileSync(path), { level: 9 }).length
const fileOf = (url) => {
  const u = new URL(url)
  if (!u.pathname.startsWith("/_next/")) return null
  const p = join(root, ".next", decodeURIComponent(u.pathname.replace(/^\/_next\//, "")))
  return existsSync(p) ? p : null
}

const browser = await (engine === "webkit" ? webkit : chromium).launch()
console.log(`browser: ${engine} ${browser.version()}`)
const context = await browser.newContext({ serviceWorkers: "block" })
const page = await context.newPage()
const seen = []
let phase = "load-home"
page.on("request", (req) => {
  if (req.resourceType() === "script" || req.url().includes(".js") || req.url().includes("worker")) seen.push({ phase, url: req.url() })
})
const sockets = []
page.on("websocket", (ws) => sockets.push(`${phase}: ${ws.url()}`))
const logs = []
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`))

const markers = ["verifyEventSignature", "XMLParser", "turndown", "nostrconnect", "ncryptsec", "scrypt"]
function report(label) {
  const files = [...new Set(seen.filter((s) => s.phase === label).map((s) => s.url))]
  let total = 0
  const rows = []
  for (const url of files) {
    const f = fileOf(url)
    if (!f) { rows.push(`  ${url} (not in .next)`); continue }
    const size = gz(f)
    total += size
    const text = readFileSync(f, "utf8")
    const found = markers.filter((m) => text.includes(m))
    rows.push(`  ${(size / 1024).toFixed(1).padStart(6)} KB gz  ${url.replace(base, "")}${found.length ? "  [" + found.join(",") + "]" : ""}`)
  }
  console.log(`${label}: ${files.length} JS files, ${(total / 1024).toFixed(1)} KB gzip`)
  console.log(rows.join("\n"))
}

await page.goto(`${base}/`, { waitUntil: "networkidle" })
report("load-home")
phase = "load-probe"
await page.goto(`${base}/nostr-probe${relay ? `?relay=${encodeURIComponent(relay)}` : ""}`, { waitUntil: "networkidle" })
report("load-probe")
phase = "run-probe"
await page.click("#run")
await page.waitForFunction(() => document.querySelector("#out")?.textContent !== "idle", null, { timeout: 60_000 })
await page.waitForLoadState("networkidle")
report("run-probe")
console.log("probe result:", await page.textContent("#out"))
console.log("websockets:", sockets.join(", ") || "(none)")
console.log("console:", logs.join("\n") || "(none)")
await browser.close()
