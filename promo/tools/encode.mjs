// Encodes the rendered frames with each soundtrack into the deliverables in out/.
// Usage: node tools/encode.mjs [voice]   (default af_heart)
import fs from "node:fs"
import { execFileSync } from "node:child_process"

const ROOT = new URL("..", import.meta.url).pathname
const voice = process.argv[2] ?? "af_heart"
const name = "BlueLine-Darts-Social-9x16"
fs.mkdirSync(`${ROOT}out/stems`, { recursive: true })

function encode(audio, file) {
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-framerate", "30", "-i", `${ROOT}build/frames/%05d.png`, "-i", audio,
    "-map", "0:v", "-map", "1:a",
    // PNG frames are sRGB: convert with the BT.709 matrix and tag the stream so players agree.
    "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-level", "4.2",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-g", "30", "-bf", "2", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest",
    "-metadata", "title=BlueLine Darts — Throw darts. We'll keep score.",
    `${ROOT}out/${file}`,
  ])
  console.log("wrote out/" + file)
}

encode(`${ROOT}build/audio/${voice}/mix.wav`, `${name}.mp4`)
if (fs.existsSync(`${ROOT}build/audio/no-voice/mix.wav`)) encode(`${ROOT}build/audio/no-voice/mix.wav`, `${name}-no-voiceover.mp4`)
fs.writeFileSync(`${ROOT}out/${name}.srt`, execFileSync("node", [`${ROOT}timeline/captions.mjs`, voice]))
for (const [from, to] of [["music", "music"], ["sfx", "sound-effects"], ["voice", "voiceover-temp"]]) fs.copyFileSync(`${ROOT}build/audio/${voice}/${from}.wav`, `${ROOT}out/stems/${to}.wav`)
console.log("wrote captions and stems")
