// Pitch and pace of each narration take (autocorrelation pitch tracker), to compare voices
// on numbers: a monotone read has a narrow pitch range, a pushy one a very wide one.
import { execFileSync } from "node:child_process"
import { VO_LINES } from "../timeline/script.mjs"
const RATE = 16000
function load(file) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 26 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}
function f0track(x) {
  const win = 640, hop = 160, minLag = Math.floor(RATE / 400), maxLag = Math.floor(RATE / 70)
  const out = []
  for (let s = 0; s + win + maxLag < x.length; s += hop) {
    let energy = 0
    for (let i = 0; i < win; i++) energy += x[s + i] * x[s + i]
    if (energy / win < 1e-4) { out.push(0); continue }
    // normalized difference function (YIN)
    let best = 0, bestVal = 1, running = 0
    const d = new Float32Array(maxLag + 1)
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0
      for (let i = 0; i < win; i++) { const v = x[s + i] - x[s + i + lag]; sum += v * v }
      running += sum
      d[lag] = running > 0 ? (sum * lag) / running : 1
      if (lag >= minLag && d[lag] < 0.15) { best = lag; bestVal = d[lag]; while (lag + 1 <= maxLag) { lag++; let s2 = 0; for (let i = 0; i < win; i++) { const v = x[s + i] - x[s + i + lag]; s2 += v * v } running += s2; d[lag] = (s2 * lag) / running; if (d[lag] < bestVal) { bestVal = d[lag]; best = lag } else break } break }
    }
    out.push(best ? RATE / best : 0)
  }
  return out
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
for (const voice of process.argv.slice(2)) {
  const all = []
  let dur = 0, words = 0, pause = 0
  const finals = []
  for (const [id, { text }] of Object.entries(VO_LINES)) {
    const x = load(new URL(`../build/vo/${voice}/${id}.wav`, import.meta.url).pathname)
    const f = f0track(x)
    const voiced = f.filter((v) => v > 0)
    all.push(...voiced)
    dur += x.length / RATE
    words += text.split(/\s+/).length
    // pauses: runs of >= 120 ms unvoiced and quiet inside the phrase
    let run = 0
    for (const v of f) { if (v === 0) run++; else { if (run * 10 >= 120) pause += run * 10; run = 0 } }
    // final fall: last 25% of voiced frames vs the phrase median, in semitones
    const tail = voiced.slice(Math.floor(voiced.length * 0.75))
    finals.push(12 * Math.log2(pct(tail, 0.5) / pct(voiced, 0.5)))
  }
  const med = pct(all, 0.5)
  const range = 12 * Math.log2(pct(all, 0.95) / pct(all, 0.05))
  const sd = Math.sqrt(all.reduce((s, v) => s + (12 * Math.log2(v / med)) ** 2, 0) / all.length)
  console.log(`${voice.padEnd(11)} median F0 ${med.toFixed(0)} Hz | 5-95% range ${range.toFixed(1)} st | sd ${sd.toFixed(2)} st | ${(words / dur).toFixed(2)} words/s | inner pauses ${(pause / 1000).toFixed(2)} s | phrase-end ${(finals.reduce((a, b) => a + b, 0) / finals.length).toFixed(1)} st`)
}
