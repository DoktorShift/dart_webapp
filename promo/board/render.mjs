// Renders the board shots of the edit into build/board/<shot>/NNNNN.png.
// Usage: node board/render.mjs [--preview] [shot ...]
//   --preview  a few frames per shot at low sample counts, for checking framing and timing.
import fs from "node:fs"
import path from "node:path"
import { openBoard } from "./still.mjs"
import { BOARD, FPS } from "../timeline/edit.mjs"

const ROOT = new URL("..", import.meta.url).pathname
const args = process.argv.slice(2)
const preview = args.includes("--preview")
const wanted = args.filter((a) => !a.startsWith("--"))
const ids = wanted.length ? wanted : Object.keys(BOARD)

const b = await openBoard()
for (const id of ids) {
  const shot = { id, fps: FPS, ...BOARD[id] }
  const frames = Math.round(shot.duration * FPS)
  const outDir = path.join(ROOT, "build", preview ? "board-preview" : "board", id)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  let list = [...Array(frames).keys()]
  if (preview) {
    const hit = Math.floor((shot.throws?.[0]?.at ?? shot.duration / 2) * FPS)
    list = [...new Set([0, hit - 1, hit, hit + 1, hit + 3, frames - 1].filter((n) => n >= 0 && n < frames))]
    shot.samples = Math.min(shot.samples ?? 32, 40)
  }
  const t0 = Date.now()
  for (const n of list) await b.frame(shot, (n + 0.5) / FPS, n, path.join(outDir, `${String(n).padStart(5, "0")}.png`))
  console.log(`${id}: ${list.length} frames, ${((Date.now() - t0) / list.length).toFixed(0)} ms/frame`)
}
await b.close()
