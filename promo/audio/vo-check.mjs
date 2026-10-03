// Reads the narration back with Whisper and compares it with the script: a check that every
// phrase is intelligible, since the narration can't be judged by ear here.
import { execFileSync } from "node:child_process"
import { pipeline } from "@huggingface/transformers"
import { VO_LINES } from "../timeline/script.mjs"

const voices = process.argv.slice(2)
const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-small.en", { dtype: "fp32" })
const words = (s) => s.toLowerCase().replace(/blue ?line/g, "blueline").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
function wer(ref, hyp) {
  const r = words(ref), h = words(hyp)
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return d[r.length][h.length] / r.length
}
for (const voice of voices) {
  let total = 0
  for (const [id, { text }] of Object.entries(VO_LINES)) {
    const file = new URL(`../build/vo/${voice}/${id}.wav`, import.meta.url).pathname
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 })
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    const { text: heard } = await asr(samples)
    const e = wer(text, heard)
    total += e
    console.log(voice.padEnd(11), id.padEnd(4), e.toFixed(2), "|", heard.trim())
  }
  console.log(voice, "mean WER", (total / Object.keys(VO_LINES).length).toFixed(3))
}
