// Captions (SRT) for the narration, split at its natural pauses, timed from the voice track.
// Usage: node timeline/captions.mjs [voice] > out/file.srt
import fs from "node:fs"
import { VO } from "./edit.mjs"
import { VO_LINES } from "./script.mjs"

const voice = process.argv[2] ?? "af_heart"
const words = JSON.parse(fs.readFileSync(new URL(`../build/vo/${voice}/words.json`, import.meta.url)))
const durations = JSON.parse(fs.readFileSync(new URL("../build/vo/durations.json", import.meta.url)))[voice]
const stamp = (t) => {
  const ms = Math.round(t * 1000)
  const p = (n, w = 2) => String(n).padStart(w, "0")
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}
// Script words carry the timing of the recognised words they match ("head-to-head" is three).
function timedScript(id) {
  const heard = words[id]
  let k = 0
  return VO_LINES[id].text.split(" ").map((w) => {
    const parts = w.split("-").filter(Boolean).length
    const first = heard[Math.min(k, heard.length - 1)]
    k += parts
    return { w, t0: first.t0 }
  })
}
// Long lines break after a comma that is followed by a pause, so each caption is one thought.
const cues = []
for (const cue of VO) {
  const w = timedScript(cue.id)
  const end = cue.t + durations[cue.id]
  let group = []
  w.forEach((word, i) => {
    group.push(word)
    const next = w[i + 1]
    const text = group.map((g) => g.w).join(" ")
    const pause = next ? next.t0 - word.t0 : 0
    if (!next || (/,$/.test(word.w) && pause > 0.5 && text.length > 18)) {
      cues.push({ from: cue.t + group[0].t0, to: next ? cue.t + next.t0 - 0.05 : end + 0.15, text })
      group = []
    }
  })
}
cues.forEach((c, i) => console.log(`${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}\n`))
