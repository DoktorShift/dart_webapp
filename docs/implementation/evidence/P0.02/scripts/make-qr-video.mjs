// P0.02: fake camera videos for the scanner checks in shell-flows.mjs. Each file is a short
// YUV4MPEG2 (.y4m) clip that Chromium plays as its camera (--use-file-for-fake-video-capture):
// a QR code, black on white, in the middle of a grey picture. Written directly, no ffmpeg needed.
//
//   node docs/implementation/evidence/P0.02/scripts/make-qr-video.mjs <out dir> [base URL]
//
// club.y4m  → <base>/#club=scanned-club   (an invitation the club scanner takes)
// other.y4m → https://example.com/#club=x  (a code from another site, refused)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import qrcode from 'qrcode-generator'

const OUT = process.argv[2] ?? 'videos'
const BASE = process.argv[3] ?? 'http://localhost:3203'
const W = 640
const H = 480
const FRAMES = 10

function frame(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const modules = qr.getModuleCount()
  const quiet = 4
  const scale = Math.floor((H * 0.8) / (modules + quiet * 2))
  const side = (modules + quiet * 2) * scale
  const x0 = Math.floor((W - side) / 2)
  const y0 = Math.floor((H - side) / 2)
  const y = Buffer.alloc(W * H, 110)
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const m = Math.floor(row / scale) - quiet
      const n = Math.floor(col / scale) - quiet
      const dark = m >= 0 && n >= 0 && m < modules && n < modules && qr.isDark(m, n)
      y[(y0 + row) * W + x0 + col] = dark ? 16 : 235
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128)
  return Buffer.concat([Buffer.from('FRAME\n'), y, chroma])
}

function video(text) {
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)
  const one = frame(text)
  return Buffer.concat([header, ...Array.from({ length: FRAMES }, () => one)])
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'club.y4m'), video(`${BASE}/#club=scanned-club`))
writeFileSync(join(OUT, 'other.y4m'), video('https://example.com/#club=x'))
console.log(`Wrote club.y4m and other.y4m to ${OUT}`)
