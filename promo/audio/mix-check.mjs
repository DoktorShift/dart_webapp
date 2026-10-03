// Intelligibility check: transcribe the narration from the finished mix (music and effects
// included) and compare each line with the script.
import { execFileSync } from "node:child_process"
import { pipeline } from "@huggingface/transformers"
import { VO } from "../timeline/edit.mjs"
import { VO_LINES } from "../timeline/script.mjs"
import fs from "node:fs"

const file = process.argv[2] ?? "build/audio/af_heart/mix.wav"
const dur = JSON.parse(fs.readFileSync("build/vo/durations.json"))["af_heart"]
const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-small.en", { dtype: "fp32" })
const words = (s) => s.toLowerCase().replace(/blue ?line/g, "blueline").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
const wer = (ref, hyp) => {
  const r = words(ref), h = words(hyp)
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return d[r.length][h.length] / r.length
}
let total = 0
for (const cue of VO) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(cue.t - 0.05), "-t", String(dur[cue.id] + 0.15), "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 })
  const { text } = await asr(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4))
  const e = wer(VO_LINES[cue.id].text, text)
  total += e
  console.log(cue.id.padEnd(4), e.toFixed(2), "|", text.trim())
}
console.log("mean WER from the mix:", (total / VO.length).toFixed(3))
