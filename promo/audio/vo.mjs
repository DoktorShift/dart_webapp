// Temporary narration with Kokoro-82M (Apache-2.0), one file per phrase so the edit can place
// each one exactly. Usage: node audio/vo.mjs [voice ...]
import fs from "node:fs"
import { KokoroTTS } from "kokoro-js"
import { VO_LINES } from "../timeline/script.mjs"

const voices = process.argv.slice(2).length ? process.argv.slice(2) : ["af_heart"]
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" })

// Leading and trailing silence trimmed (with a few ms kept), so a cue time is the first sound.
function trim(samples, rate) {
  const threshold = 0.004
  const pad = Math.round(rate * 0.012)
  let a = 0
  let b = samples.length - 1
  while (a < b && Math.abs(samples[a]) < threshold) a++
  while (b > a && Math.abs(samples[b]) < threshold) b--
  return samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + pad * 4))
}

function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVE", 8)
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write("data", 36); buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return buf
}

const report = {}
for (const voice of voices) {
  const dir = new URL(`../build/vo/${voice}/`, import.meta.url).pathname
  fs.mkdirSync(dir, { recursive: true })
  report[voice] = {}
  for (const [id, { text, speed = 1 }] of Object.entries(VO_LINES)) {
    const audio = await tts.generate(text, { voice, speed })
    const samples = trim(audio.audio, audio.sampling_rate)
    fs.writeFileSync(`${dir}${id}.wav`, wav(samples, audio.sampling_rate))
    report[voice][id] = +(samples.length / audio.sampling_rate).toFixed(3)
  }
  console.log(voice, JSON.stringify(report[voice]))
}
fs.writeFileSync(new URL("../build/vo/durations.json", import.meta.url), JSON.stringify(report, null, 2))
