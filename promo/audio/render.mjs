// Renders the soundtrack stems and the mix, then brings the mix to -14 LUFS / -1 dBTP.
// Usage: node audio/render.mjs [voice] [--no-voice]   (default voice: af_heart)
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { chromium } from "playwright"
import { serve } from "../tools/serve.mjs"

const ROOT = new URL("..", import.meta.url).pathname
const args = process.argv.slice(2)
const voiceName = args.find((a) => !a.startsWith("--")) ?? "af_heart"
const withVoice = !args.includes("--no-voice")
const tag = withVoice ? voiceName : "no-voice"
const OUT = path.join(ROOT, "build/audio", tag)
fs.mkdirSync(OUT, { recursive: true })

const { server, url } = await serve(ROOT)
const browser = await chromium.launch()
const page = await browser.newPage()
page.on("pageerror", (e) => console.log("pageerror:", e.message))
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("page:", m.text()) })
await page.goto(`${url}/audio/score.html`)
await page.waitForFunction(() => window.score)
const t0 = Date.now()
const info = await page.evaluate((o) => window.score.render(o), { voiceName, withVoice })
console.log("rendered in", Date.now() - t0, "ms", JSON.stringify(info.durations))
for (const [i, name] of ["music", "sfx", "voice", "mix-raw"].entries()) {
  const b64 = await page.evaluate((i) => window.score.stemWav(i), i)
  fs.writeFileSync(path.join(OUT, `${name}.wav`), Buffer.from(b64, "base64"))
}
await browser.close()
server.close()

// The mix runs through Web Audio compressors, each with a fixed look-ahead delay. Measure the
// delay against the effects stem (cross-correlation over the cold open) and take it out.
const readWav = (file) => fs.readFileSync(file)
const sfxWav = readWav(path.join(OUT, "sfx.wav"))
const mixWav = readWav(path.join(OUT, "mix-raw.wav"))
// Left channel of a 24-bit stereo WAV, as floats.
const channel = (b, from, len) => {
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) { const o = 44 + (from + i) * 6; out[i] = ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8 >> 8) / 8388607 }
  return out
}
const A = channel(sfxWav, 0, 48000 * 3)
const B = channel(mixWav, 0, 48000 * 3)
let best = 0
let bestLag = 0
for (let lag = 0; lag < 48 * 40; lag++) {
  let sum = 0
  for (let i = 0; i < A.length - lag; i += 2) sum += A[i] * B[i + lag]
  if (sum > best) { best = sum; bestLag = lag }
}
console.log(`mix delay ${(bestLag / 48).toFixed(2)} ms, compensated`)
{
  const shifted = Buffer.alloc(mixWav.length)
  mixWav.copy(shifted, 0, 0, 44)
  mixWav.copy(shifted, 44, 44 + bestLag * 6)
  fs.writeFileSync(path.join(OUT, "mix-raw.wav"), shifted)
}

// Loudness: measure, then normalise linearly with ffmpeg's loudnorm (two passes).
const raw = path.join(OUT, "mix-raw.wav")
let stats
try {
  stats = JSON.parse(/\{[\s\S]*\}/.exec(execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${raw}" -af loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json -f null - 2>&1`], { encoding: "utf8" }))[0])
} catch (e) { console.log("measure failed", e.message) }
console.log("measured", stats.input_i, "LUFS, peak", stats.input_tp, "dBTP, LRA", stats.input_lra)
const filter = `loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true:print_format=summary`
execFileSync("sh", ["-c", `ffmpeg -v error -y -i "${raw}" -af "${filter},aresample=48000" -c:a pcm_s24le "${path.join(OUT, "mix.wav")}"`])
const check = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${path.join(OUT, "mix.wav")}" -af ebur128=peak=true -f null - 2>&1 | tail -14`], { encoding: "utf8" })
console.log(check.split("\n").filter((l) => /I:|LRA:|Peak:/.test(l)).map((l) => l.trim()).join(" | "))
