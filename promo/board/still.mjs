// Renders single frames of board shots for look development. Usage: node board/still.mjs shots.json
import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright"
import { serve } from "../tools/serve.mjs"

const ROOT = new URL("..", import.meta.url).pathname
export async function openBoard({ width = 1080, height = 1920 } = {}) {
  const { server, url } = await serve(ROOT)
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] })
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
  page.on("console", (m) => { if (m.type() === "error") console.log("page:", m.text()) })
  page.on("pageerror", (e) => console.log("pageerror:", e.message))
  await page.goto(`${url}/board/board.html`)
  await page.waitForFunction(() => window.board)
  const t0 = Date.now()
  await page.evaluate(({ width, height }) => window.board.setup({ width, height }), { width, height })
  console.log("board setup", Date.now() - t0, "ms")
  return {
    page,
    async frame(shot, t, index, file) {
      await page.evaluate(({ shot, t, index }) => window.board.renderFrame(shot, t, index), { shot, t, index })
      const b64 = await page.evaluate(() => window.board.frameData("image/png"))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(b64, "base64"))
    },
    async close() { await browser.close(); server.close() },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const shots = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  const b = await openBoard()
  for (const s of shots) {
    const t0 = Date.now()
    await b.frame(s, s.still ?? 0, 0, path.join(ROOT, "build/stills", `${s.id}.png`))
    console.log(s.id, Date.now() - t0, "ms")
  }
  await b.close()
}
