// Word timestamps for each narration phrase (Whisper), to line words up with picture.
import fs from "node:fs"
import { execFileSync } from "node:child_process"
import { pipeline } from "@huggingface/transformers"
import { VO_LINES } from "../timeline/script.mjs"

const voice = process.argv[2] ?? "af_heart"
const asr = await pipeline("automatic-speech-recognition", process.env.ASR_MODEL ?? "onnx-community/whisper-base_timestamped", { dtype: "fp32" })
const out = {}
for (const id of Object.keys(VO_LINES)) {
  const file = new URL(`../build/vo/${voice}/${id}.wav`, import.meta.url).pathname
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 })
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const r = await asr(samples, { return_timestamps: "word" })
  out[id] = r.chunks.map((c) => ({ w: c.text.trim(), t0: c.timestamp[0], t1: c.timestamp[1] }))
  console.log(id, out[id].map((c) => `${c.w}@${c.t0.toFixed(2)}`).join(" "))
}
fs.writeFileSync(new URL(`../build/vo/${voice}/words.json`, import.meta.url), JSON.stringify(out, null, 1))
