// The result of a game as a picture to share: a 1080 × 1350 card (the portrait size Instagram,
// WhatsApp and messages show in full) in the app's dark look, whatever theme the phone uses.
// Everything on it arrives as finished text in the player's language.

export interface ResultImage {
  brand: string
  title: string
  subtitle: string
  badges: string[]
  date: string
  players: string[]
  winner: number | null
  // `short` heads a column when every player gets a row; rows without one are left out there.
  rows: { label: string; short?: string; values: { text: string; best: boolean }[] }[]
  footer: string
  site: string
}

const WIDTH = 1080
const HEIGHT = 1350
const PAD = 72

const COLORS = {
  background: "#050a18",
  glow: "rgba(29, 78, 216, 0.38)",
  card: "rgba(255, 255, 255, 0.05)",
  line: "rgba(255, 255, 255, 0.1)",
  text: "#f8fafc",
  muted: "#94a3b8",
  primary: "#3b82f6",
  best: "#4ade80",
  trophy: "#f59e0b",
  badge: "rgba(245, 158, 11, 0.16)",
}

// Lucide's trophy (24 × 24, drawn with strokes): the icon on the result screen.
const TROPHY = [
  "M6 9H4.5a2.5 2.5 0 0 1 0-5H6",
  "M18 9h1.5a2.5 2.5 0 0 0 0-5H18",
  "M4 22h16",
  "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22",
  "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22",
  "M18 2H6v7a6 6 0 0 0 12 0V2Z",
]

type Font = (size: number) => string

interface Fonts {
  regular: Font
  semibold: Font
  condensed: Font
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

// The page's own fonts (Inter, and Barlow Condensed from the --font-display variable on
// <body>), so the picture looks like the app.
function pageFonts(): Fonts {
  const style = getComputedStyle(document.body)
  const body = style.fontFamily || "system-ui, sans-serif"
  const display = style.getPropertyValue("--font-display").trim() || body
  return {
    regular: (size) => `400 ${size}px ${body}`,
    semibold: (size) => `600 ${size}px ${body}`,
    condensed: (size) => `600 ${size}px ${display}`,
  }
}

async function loadImage(src: string) {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, COLORS.glow)
  gradient.addColorStop(1, "rgba(29, 78, 216, 0)")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
}

// Sets the largest font up to `size` at which `text` fits `width`.
function fit(ctx: CanvasRenderingContext2D, text: string, font: Font, size: number, width: number, min = 16) {
  let current = size
  ctx.font = font(current)
  while (current > min && ctx.measureText(text).width > width) {
    current -= 2
    ctx.font = font(current)
  }
  return current
}

function line(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) {
  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
}

function drawTrophy(ctx: CanvasRenderingContext2D, centerX: number, top: number, size: number) {
  ctx.save()
  ctx.translate(centerX - size / 2, top)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = COLORS.trophy
  ctx.lineWidth = 2
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (const d of TROPHY) ctx.stroke(new Path2D(d))
  ctx.restore()
}

// Up to three players: a column each, a row per number (as on the result screen).
function drawPlayerColumns(ctx: CanvasRenderingContext2D, model: ResultImage, fonts: Fonts, box: Box) {
  const count = model.players.length
  const labelWidth = box.width * (count <= 2 ? 0.44 : 0.36)
  const column = (box.width - labelWidth) / count
  const right = (i: number) => box.left + labelWidth + column * (i + 1) - 8
  const header = 96
  const rowHeight = Math.min(130, (box.height - header) / Math.max(1, model.rows.length))

  ctx.textAlign = "right"
  ctx.textBaseline = "alphabetic"
  model.players.forEach((name, i) => {
    ctx.fillStyle = i === model.winner ? COLORS.primary : COLORS.text
    fit(ctx, name, fonts.semibold, 40, column - 16)
    ctx.fillText(name, right(i), box.top + 66)
  })
  ctx.textBaseline = "middle"
  model.rows.forEach((row, r) => {
    const top = box.top + header + r * rowHeight
    line(ctx, box.left, box.left + box.width, top)
    ctx.textAlign = "left"
    ctx.fillStyle = COLORS.muted
    fit(ctx, row.label, fonts.regular, 32, labelWidth - 16)
    ctx.fillText(row.label, box.left, top + rowHeight / 2)
    ctx.textAlign = "right"
    row.values.forEach((value, i) => {
      ctx.fillStyle = value.best ? COLORS.best : COLORS.text
      fit(ctx, value.text, fonts.condensed, Math.min(80, rowHeight * 0.64), column - 16)
      ctx.fillText(value.text, right(i), top + rowHeight / 2 + 3)
    })
  })
}

// More players: a row each, a column per number, so every name has room.
function drawPlayerRows(ctx: CanvasRenderingContext2D, model: ResultImage, fonts: Fonts, box: Box) {
  const columns = model.rows.filter((row) => row.short)
  const header = 80
  const rowHeight = Math.min(120, (box.height - header) / model.players.length)
  const valueSize = Math.min(64, rowHeight * 0.6)
  // Each number column is as wide as its widest entry; the names get the rest.
  const widths = columns.map((row) => {
    ctx.font = fonts.regular(28)
    let widest = ctx.measureText(row.short ?? "").width
    ctx.font = fonts.condensed(valueSize)
    for (const value of row.values) widest = Math.max(widest, ctx.measureText(value.text).width)
    return widest + 36
  })
  const nameWidth = box.width - widths.reduce((sum, w) => sum + w, 0)
  const right = (c: number) => box.left + nameWidth + widths.slice(0, c + 1).reduce((sum, w) => sum + w, 0)

  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = COLORS.muted
  ctx.textAlign = "right"
  columns.forEach((row, c) => {
    ctx.font = fonts.regular(28)
    ctx.fillText(row.short ?? "", right(c), box.top + 54)
  })
  ctx.textBaseline = "middle"
  model.players.forEach((name, p) => {
    const top = box.top + header + p * rowHeight
    line(ctx, box.left, box.left + box.width, top)
    ctx.textAlign = "left"
    ctx.fillStyle = p === model.winner ? COLORS.primary : COLORS.text
    fit(ctx, name, fonts.semibold, 40, nameWidth - 20)
    ctx.fillText(name, box.left, top + rowHeight / 2)
    ctx.textAlign = "right"
    columns.forEach((row, c) => {
      const value = row.values[p]
      ctx.fillStyle = value.best ? COLORS.best : COLORS.text
      ctx.font = fonts.condensed(valueSize)
      ctx.fillText(value.text, right(c), top + rowHeight / 2 + 3)
    })
  })
}

export async function renderResultImage(model: ResultImage, iconSrc: string): Promise<Blob> {
  const fonts = pageFonts()
  await Promise.all([document.fonts.load(fonts.condensed(100)), document.fonts.load(fonts.regular(32)), document.fonts.load(fonts.semibold(32))]).catch(() => {})
  const icon = await loadImage(iconSrc).catch(() => null)

  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is not available")
  const inner = WIDTH - PAD * 2

  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  glow(ctx, WIDTH * 0.9, HEIGHT * 0.04, 760)
  glow(ctx, WIDTH * 0.05, HEIGHT * 0.98, 700)

  // Brand and date.
  ctx.textBaseline = "middle"
  let brandX = PAD
  if (icon) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(PAD, PAD, 76, 76, 18)
    ctx.clip()
    ctx.drawImage(icon, PAD, PAD, 76, 76)
    ctx.restore()
    brandX += 96
  }
  ctx.fillStyle = COLORS.text
  ctx.textAlign = "left"
  ctx.font = fonts.condensed(54)
  ctx.fillText(model.brand, brandX, PAD + 40)
  ctx.fillStyle = COLORS.muted
  ctx.textAlign = "right"
  ctx.font = fonts.regular(30)
  ctx.fillText(model.date, WIDTH - PAD, PAD + 40)

  // Who won, and how.
  drawTrophy(ctx, WIDTH / 2, 200, 120)
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = COLORS.text
  fit(ctx, model.title, fonts.condensed, 170, inner)
  ctx.fillText(model.title, WIDTH / 2, 480)
  ctx.fillStyle = COLORS.muted
  fit(ctx, model.subtitle, fonts.regular, 40, inner)
  ctx.fillText(model.subtitle, WIDTH / 2, 545)

  let y = 590
  for (const badge of model.badges) {
    const size = fit(ctx, badge, fonts.semibold, 34, inner - 64)
    const height = size + 30
    const width = ctx.measureText(badge).width + 56
    ctx.fillStyle = COLORS.badge
    ctx.beginPath()
    ctx.roundRect((WIDTH - width) / 2, y, width, height, height / 2)
    ctx.fill()
    ctx.fillStyle = COLORS.trophy
    ctx.textBaseline = "middle"
    ctx.fillText(badge, WIDTH / 2, y + height / 2 + 2)
    ctx.textBaseline = "alphabetic"
    y += height + 16
  }

  // The numbers, in a card.
  const top = Math.max(y + 24, 650)
  const bottom = HEIGHT - 190
  ctx.fillStyle = COLORS.card
  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(PAD, top, inner, bottom - top, 40)
  ctx.fill()
  ctx.stroke()
  const box = { left: PAD + 40, top, width: inner - 80, height: bottom - top - 24 }
  if (model.players.length > 3) drawPlayerRows(ctx, model, fonts, box)
  else drawPlayerColumns(ctx, model, fonts, box)

  // Where it came from.
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = COLORS.muted
  ctx.font = fonts.regular(32)
  ctx.fillText(model.footer, WIDTH / 2, HEIGHT - 112)
  ctx.fillStyle = COLORS.primary
  ctx.font = fonts.semibold(34)
  ctx.fillText(model.site, WIDTH / 2, HEIGHT - 64)

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be made"))), "image/png"))
}
