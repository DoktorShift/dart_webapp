// Loudness checks without ears: per narration line, voice vs (ducked) music vs effects, in LUFS.
import { execFileSync } from "node:child_process"
import { VO } from "../timeline/edit.mjs"
import fs from "node:fs"
const dir = process.argv[2] ?? "build/audio/af_heart"
const dur = JSON.parse(fs.readFileSync("build/vo/durations.json"))[process.argv[3] ?? "af_heart"]
const lufs = (file, ss, t, gainDb = 0) => {
  const out = execFileSync("sh", ["-c", `ffmpeg -hide_banner -ss ${ss} -t ${t} -i "${file}" -af "volume=${gainDb}dB,ebur128" -f null - 2>&1 | grep -E "^ +I:" | tail -1`], { encoding: "utf8" })
  const m = /I:\s+(-?[\d.]+|-inf)/.exec(out)
  return m ? Number(m[1]) : NaN
}
console.log("line   voice  music(ducked)  sfx    voice-music")
for (const cue of VO) {
  const d = dur[cue.id]
  const v = lufs(`${dir}/voice.wav`, cue.t, d)
  const m = lufs(`${dir}/music.wav`, cue.t, d, -10.5)
  const s = lufs(`${dir}/sfx.wav`, cue.t, d)
  console.log(cue.id.padEnd(5), String(v).padStart(6), String(m).padStart(10), String(s).padStart(9), (v - m).toFixed(1).padStart(9))
}
for (const [name, ss, t] of [["cold open sfx", 0, 3.4], ["intro music (no vo)", 5.85, 0.15], ["win music", 29.8, 0.6], ["tag", 32.8, 1.6], ["end card", 34.7, 1.7]]) {
  console.log(name.padEnd(22), "music", lufs(`${dir}/music.wav`, ss, t), "sfx", lufs(`${dir}/sfx.wav`, ss, t), "mix", lufs(`${dir}/mix.wav`, ss, t))
}
