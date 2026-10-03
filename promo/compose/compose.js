// Draws one frame of the film: app footage through a virtual camera, rendered board shots,
// touch indicators where the takes were tapped, and the words on screen.
import { BOARD, CLIPS, DURATION, FPS, HEIGHT, TEXTS, WIDTH } from "/timeline/edit.mjs"
import { srcAt } from "/timeline/derive.mjs"

const canvas = document.getElementById("frame")
const ctx = canvas.getContext("2d")
const pad = (n) => String(n).padStart(5, "0")
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const easeOut = (x) => 1 - Math.pow(1 - x, 3)
const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x))

// The phone screen: 393 x 852 CSS pixels; z = 1 is 1500 px tall on the 1920 px frame.
const PHONE = { w: 393, h: 852, k0: 1500 / 852, radius: 55 }
const ANCHOR = { app: [540, 920], split: [540, 1392], label: [540, 1268] }
const SPLIT_Y = 860

const BRAND = "#3b82f6"
const takes = {}

// ---- Images ----
const cache = new Map()
function image(url) {
  let p = cache.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => img.decode().then(() => resolve(img), () => resolve(img))
      img.onerror = () => reject(new Error(`missing ${url}`))
      img.src = url
    })
    cache.set(url, p)
    if (cache.size > 24) cache.delete(cache.keys().next().value)
  }
  return p
}
const appFrame = (take, src) => `/build/takes/${take}/${pad(Math.max(0, Math.round(src * FPS)))}.jpg`
const boardFrame = (shot, n) => `/build/board/${shot}/${pad(clamp(n, 0, Math.round(BOARD[shot].duration * FPS) - 1))}.png`

// ---- Drawing helpers ----
function roundRect(x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function background() {
  ctx.fillStyle = "#040507"
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  // The app's own board-light glow, quieter: blue from the lower left and the upper right.
  for (const [x, y] of [[0, HEIGHT], [WIDTH, 0]]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, HEIGHT * 0.62)
    g.addColorStop(0, "rgba(29, 78, 216, 0.16)")
    g.addColorStop(1, "rgba(29, 78, 216, 0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
  }
}

// Camera keyframes, eased; zoom interpolated in log space so pushes feel even.
function cameraAt(clip, t) {
  const keys = clip.camera
  if (t <= keys[0].t) return keys[0]
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t < b.t) {
      const k = easeInOut((t - a.t) / (b.t - a.t))
      return { cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k, z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * k) }
    }
  }
  return keys[keys.length - 1]
}

// Touch indicators: a soft disc while the finger is down, a ring that opens and fades after.
function touches(take, src, x0, y0, s) {
  for (const e of takes[take].events) {
    if (e.type !== "tap") continue
    const sinceDown = src - e.t
    const sinceUp = src - e.up
    if (sinceDown < 0 || sinceUp > 0.22) continue
    const r = 19 * s
    let scale = 0.86 + 0.14 * easeOut(clamp(sinceDown / 0.08))
    let alpha = 1
    if (sinceUp > 0) {
      const k = clamp(sinceUp / 0.22)
      scale = 1 + 0.4 * easeOut(k)
      alpha = 1 - k
    }
    const X = x0 + e.x * s
    const Y = y0 + e.y * s
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.arc(X, Y, r * scale, 0, Math.PI * 2)
    ctx.fillStyle = sinceUp > 0 ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.13)"
    ctx.fill()
    ctx.lineWidth = Math.max(2, 1.5 * s)
    ctx.strokeStyle = "rgba(255,255,255,0.85)"
    ctx.stroke()
    ctx.restore()
  }
}

async function drawPhone(clip, t, anchor, clipRect) {
  const src = srcAt(clip, t)
  const img = await image(appFrame(clip.take, src))
  const cam = cameraAt(clip, t)
  const s = PHONE.k0 * cam.z
  const x = anchor[0] - cam.cx * s
  const y = anchor[1] - cam.cy * s
  const w = PHONE.w * s
  const h = PHONE.h * s
  const r = PHONE.radius * s
  ctx.save()
  if (clipRect) {
    ctx.beginPath()
    ctx.rect(...clipRect)
    ctx.clip()
  }
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)"
  ctx.shadowBlur = 70
  ctx.shadowOffsetY = 28
  roundRect(x, y, w, h, r)
  ctx.fillStyle = "#020817"
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(x, y, w, h, r)
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(img, x, y, w, h)
  touches(clip.take, src, x, y, s)
  ctx.restore()
  roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = "rgba(255, 255, 255, 0.13)"
  ctx.stroke()
  ctx.restore()
}

async function drawBoard(shot, n, rect) {
  const img = await image(boardFrame(shot, n))
  if (!rect) return ctx.drawImage(img, 0, 0, WIDTH, HEIGHT)
  // A band from the middle of the frame, for the split screen.
  const [x, y, w, h] = rect
  const sy = (HEIGHT - h) / 2
  ctx.drawImage(img, 0, sy, WIDTH, h, x, y, w, h)
}

// ---- Words ----
function setFont(size, weight = 600, family = "Barlow Condensed") {
  ctx.font = `${weight} ${size}px "${family}"`
}

// Words rise into place one after another and leave together.
function kinetic(lines, t, t0, t1, { size = 120, y = HEIGHT / 2, lineHeight = 1.0, stagger = 0.07, lineStagger = 0, align = "center", color = "#fff" } = {}) {
  setFont(size)
  ctx.letterSpacing = "-1px"
  ctx.textBaseline = "alphabetic"
  const out = clamp((t1 - t) / 0.16)
  const blockH = lines.length * size * lineHeight
  let wordIndex = 0
  lines.forEach((line, li) => {
    const words = line.split(" ")
    const widths = words.map((w) => ctx.measureText(w).width)
    const space = ctx.measureText(" ").width
    const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1)
    let x = align === "center" ? (WIDTH - total) / 2 : 96
    const baseY = y - blockH / 2 + size * lineHeight * (li + 0.8)
    words.forEach((word, wi) => {
      const start = t0 + li * lineStagger + wordIndex * stagger
      const k = easeOutExpo(clamp((t - start) / 0.42))
      ctx.save()
      ctx.globalAlpha = clamp((t - start) / 0.18) * out
      ctx.fillStyle = color
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
      ctx.shadowBlur = size * 0.28
      ctx.shadowOffsetY = size * 0.04
      ctx.fillText(word, x, baseY + (1 - k) * size * 0.32)
      ctx.restore()
      x += widths[wi] + space
      wordIndex++
    })
  })
  ctx.letterSpacing = "0px"
  return { top: y - blockH / 2, bottom: y + blockH / 2 }
}

// The brand's thin blue line, drawn out from the centre.
function blueLine(t, start, y, width = 180, thickness = 5, end = Infinity) {
  const k = easeOutExpo(clamp((t - start) / 0.5)) * clamp((end - t) / 0.16)
  if (k <= 0) return
  ctx.fillStyle = BRAND
  ctx.fillRect(WIDTH / 2 - (width / 2) * k, y, width * k, thickness)
}

function scrim(fromY, toY, alpha) {
  const g = ctx.createLinearGradient(0, fromY, 0, toY)
  g.addColorStop(0, "rgba(0,0,0,0)")
  g.addColorStop(1, `rgba(0,0,0,${alpha})`)
  ctx.fillStyle = g
  ctx.fillRect(0, Math.min(fromY, toY), WIDTH, Math.abs(toY - fromY))
}

let icon
async function endCard(t, t0) {
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  icon ??= await image("/compose/assets/app-icon-512.png")
  const a = easeOut(clamp((t - (t0 + 0.22)) / 0.5))
  const size = 236 * (0.94 + 0.06 * a)
  ctx.save()
  ctx.globalAlpha = a
  roundRect(WIDTH / 2 - size / 2, 560 - size / 2, size, size, size * 0.2237)
  ctx.clip()
  ctx.drawImage(icon, WIDTH / 2 - size / 2, 560 - size / 2, size, size)
  ctx.restore()
  kinetic(["Throw darts.", "We'll keep score."], t, t0 + 0.5, Infinity, { size: 112, y: 960, lineHeight: 1.04, stagger: 0.09 })
  blueLine(t, t0 + 1.15, 1112, 150, 5)
  ctx.save()
  ctx.globalAlpha = easeOut(clamp((t - (t0 + 1.3)) / 0.45))
  ctx.fillStyle = "#e2e8f0"
  setFont(46, 600, "Inter")
  ctx.letterSpacing = "1px"
  ctx.textAlign = "center"
  ctx.fillText("BlueLine Darts", WIDTH / 2, 1214)
  ctx.fillStyle = "#7c8796"
  setFont(32, 500, "Inter")
  ctx.letterSpacing = "0.5px"
  ctx.fillText("blueline21.netlify.app", WIDTH / 2, 1268)
  ctx.restore()
  ctx.textAlign = "start"
  ctx.letterSpacing = "0px"
}

// ---- One frame ----
export async function renderAt(frame) {
  const t = frame / FPS
  const clip = CLIPS.find((c) => t >= c.t0 && t < c.t1) ?? CLIPS[CLIPS.length - 1]
  const local = Math.round((t - clip.t0) * FPS)
  ctx.save()
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  if (clip.type === "black") {
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
  } else if (clip.type === "board") {
    await drawBoard(clip.shot, local)
  } else if (clip.type === "app") {
    background()
    if (clip.layout === "label") {
      await drawPhone(clip, t, ANCHOR.label)
      scrim(640, 0, 0.0)
      const g = ctx.createLinearGradient(0, 0, 0, 760)
      g.addColorStop(0, "rgba(4,5,7,1)")
      g.addColorStop(0.72, "rgba(4,5,7,0.94)")
      g.addColorStop(1, "rgba(4,5,7,0)")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, WIDTH, 760)
      kinetic([clip.label], t, clip.t0 + 0.02, clip.t1 + 1, { size: 168, y: 400, stagger: 0.05 })
    } else {
      await drawPhone(clip, t, ANCHOR.app)
    }
  } else if (clip.type === "split") {
    background()
    await drawBoard(clip.shot, local, [0, 0, WIDTH, SPLIT_Y])
    await drawPhone(clip, t, ANCHOR.split, [0, SPLIT_Y, WIDTH, HEIGHT - SPLIT_Y])
    ctx.fillStyle = BRAND
    ctx.fillRect(0, SPLIT_Y - 2, WIDTH, 4)
  } else if (clip.type === "card") {
    await endCard(t, clip.t0)
  }

  // Words over the picture.
  for (const text of TEXTS) {
    if (t < text.t0 || t >= text.t1) continue
    if (text.style === "statement") {
      ctx.fillStyle = `rgba(0,0,0,${0.74 * easeOut(clamp((t - (text.t0 - 0.12)) / 0.3))})`
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
      kinetic(text.lines, t, text.t0, text.t1, { size: 150, y: HEIGHT * text.y, stagger: 0.08 })
    } else if (text.style === "stack") {
      scrim(HEIGHT * 0.4, HEIGHT * 0.86, 0.9 * easeOut(clamp((t - (text.t0 - 0.12)) / 0.35)))
      ctx.fillStyle = `rgba(0,0,0,${0.9 * easeOut(clamp((t - (text.t0 - 0.12)) / 0.35))})`
      ctx.fillRect(0, HEIGHT * 0.86, WIDTH, HEIGHT * 0.14)
      const box = kinetic(text.lines, t, text.t0, text.t1, { size: 116, y: HEIGHT * 0.69, lineHeight: 1.02, stagger: 0, lineStagger: text.stagger })
      blueLine(t, text.t0 + text.stagger * 2 + 0.2, box.bottom + 42, 150, 5, text.t1)
    }
  }
  ctx.restore()
  return true
}

export async function frameData() {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ""
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function setup() {
  for (const name of ["onboarding", "late", "solo", "duo", "six"]) takes[name] = await (await fetch(`/build/takes/${name}/events.json`)).json()
  await document.fonts.load('600 100px "Barlow Condensed"')
  await document.fonts.load('600 40px "Inter"')
  await document.fonts.load('500 40px "Inter"')
  return { frames: Math.round(DURATION * FPS) }
}

window.compose = { setup, renderAt, frameData }
