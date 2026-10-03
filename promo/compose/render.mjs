// Renders the film's frames to build/frames/NNNNN.png with a few pages in parallel.
// Usage: node compose/render.mjs                 every frame
//        node compose/render.mjs --at 4.2,12.4   single frames at film times, to build/check/
//        node compose/render.mjs --from 10 --to 14
import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright"
import { serve } from "../tools/serve.mjs"

const ROOT = new URL("..", import.meta.url).pathname
const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const FPS = 30

const { server, url } = await serve(ROOT)
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"] })
async function page() {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })
  p.on("pageerror", (e) => console.log("pageerror:", e.message))
  p.on("console", (m) => { if (m.type() === "error") console.log("page:", m.text()) })
  await p.goto(`${url}/compose/compose.html`)
  await p.waitForFunction(() => window.compose)
  const info = await p.evaluate(() => window.compose.setup())
  return { p, info }
}

async function renderTo(p, frame, file) {
  await p.evaluate((f) => window.compose.renderAt(f), frame)
  const b64 = await p.evaluate(() => window.compose.frameData())
  fs.writeFileSync(file, Buffer.from(b64, "base64"))
}

const at = opt("at")
if (at) {
  const dir = path.join(ROOT, "build/check")
  fs.mkdirSync(dir, { recursive: true })
  const { p } = await page()
  for (const t of at.split(",").map(Number)) {
    const frame = Math.round(t * FPS)
    await renderTo(p, frame, path.join(dir, `t${t.toFixed(2)}.png`))
  }
  console.log("checks written to build/check")
} else {
  const dir = path.join(ROOT, "build/frames")
  fs.mkdirSync(dir, { recursive: true })
  const workers = await Promise.all([0, 1, 2, 3].map(() => page()))
  const total = workers[0].info.frames
  const from = opt("from") ? Math.round(Number(opt("from")) * FPS) : 0
  const to = opt("to") ? Math.round(Number(opt("to")) * FPS) : total
  let next = from
  let done = 0
  const t0 = Date.now()
  await Promise.all(workers.map(async ({ p }) => {
    while (next < to) {
      const f = next++
      await renderTo(p, f, path.join(dir, `${String(f).padStart(5, "0")}.png`))
      if (++done % 60 === 0) console.log(`${done}/${to - from} frames, ${((Date.now() - t0) / done).toFixed(0)} ms/frame`)
    }
  }))
  console.log(`rendered ${done} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
await browser.close()
server.close()
