import { closeCard, COLORS, fit, HEIGHT, line, openCard, PAD, WIDTH, type Fonts } from "../result-image.ts"

// A player's figures as a picture to share (proposal 2026-10-26, M17): the statistics of a
// period, a training month or the year's recap, in the same 1080 × 1350 card as the result
// picture. Everything arrives as finished text in the player's language; the picture never
// holds more than the screen it was made from shows.

export interface FiguresImage {
  brand: string
  date: string
  // "Statistik · X01", "Mein Dartjahr 2026", "Training · Oktober".
  title: string
  // Who, and what the figures cover ("Anna · gegen andere, letzte 30 Spiele").
  subtitle: string
  headline: { value: string; label: string }
  // The direction against before, when there is one.
  sentence?: string
  bars?: {
    values: (number | null)[]
    first: string
    last: string
    // The value above the best bar.
    best: string
    goal?: { value: number; label: string }
  }
  // Up to six, each a value with its name.
  figures: { label: string; value: string }[]
  footer: string
  site: string
}

const CARD_TOP = 330
const CARD_BOTTOM = HEIGHT - 190

export async function renderFiguresImage(model: FiguresImage, iconSrc: string): Promise<Blob> {
  const { canvas, ctx, fonts } = await openCard(model.brand, model.date, iconSrc)
  const inner = WIDTH - PAD * 2

  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = COLORS.text
  fit(ctx, model.title, fonts.condensed, 96, inner)
  ctx.fillText(model.title, PAD, 250)
  ctx.fillStyle = COLORS.muted
  fit(ctx, model.subtitle, fonts.regular, 34, inner)
  ctx.fillText(model.subtitle, PAD, 298)

  ctx.fillStyle = COLORS.card
  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(PAD, CARD_TOP, inner, CARD_BOTTOM - CARD_TOP, 40)
  ctx.fill()
  ctx.stroke()
  const left = PAD + 48
  const width = inner - 96
  let y = CARD_TOP + 150

  // The one figure, large, and what it is.
  ctx.fillStyle = COLORS.text
  fit(ctx, model.headline.value, fonts.condensed, 170, width)
  ctx.fillText(model.headline.value, left, y)
  y += 52
  ctx.fillStyle = COLORS.muted
  fit(ctx, model.headline.label, fonts.regular, 36, width)
  ctx.fillText(model.headline.label, left, y)
  if (model.sentence) {
    y += 54
    ctx.fillStyle = COLORS.text
    fit(ctx, model.sentence, fonts.semibold, 34, width)
    ctx.fillText(model.sentence, left, y)
  }

  if (model.bars && model.bars.values.some((v) => v !== null)) {
    y += 40
    drawBars(ctx, fonts, model.bars, { left, top: y, width, height: 230 })
    y += 230 + 70
  } else y += 40

  drawFigures(ctx, fonts, model.figures.slice(0, model.bars ? 3 : 6), left, y, width, CARD_BOTTOM - 40)
  return closeCard(canvas, ctx, fonts, model.footer, model.site)
}

// The chart as on the screen (components/profile/bars.tsx): no axes, the best bar in orange with
// its value, a dashed line for the goal, first and last label below.
function drawBars(ctx: CanvasRenderingContext2D, fonts: Fonts, bars: NonNullable<FiguresImage["bars"]>, box: { left: number; top: number; width: number; height: number }) {
  const values = bars.values.filter((v): v is number => v !== null)
  const lo = Math.min(...values, bars.goal?.value ?? Infinity)
  const hi = Math.max(...values, bars.goal?.value ?? -Infinity)
  const span = hi - lo
  const base = Math.max(0, Math.min(lo * 0.8, lo - span))
  const scale = hi > base ? hi - base : 1
  const heightOf = (v: number) => box.height * (0.12 + 0.88 * ((v - base) / scale))
  const gap = 6
  const barWidth = (box.width - gap * (bars.values.length - 1)) / bars.values.length
  const bottom = box.top + box.height
  const bestValue = Math.max(...values)
  const bestAt = bars.values.indexOf(bestValue)
  if (bars.goal) {
    // Under the bars, its label at the end away from the best bar's value.
    const gy = bottom - heightOf(bars.goal.value)
    ctx.save()
    ctx.setLineDash([12, 10])
    ctx.strokeStyle = COLORS.muted
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(box.left, gy)
    ctx.lineTo(box.left + box.width, gy)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = COLORS.muted
    ctx.font = fonts.semibold(26)
    const atRight = bestAt < (bars.values.length * 2) / 3
    ctx.textAlign = atRight ? "right" : "left"
    ctx.fillText(bars.goal.label, atRight ? box.left + box.width : box.left, gy - 10)
  }
  let bestDrawn = false
  bars.values.forEach((value, i) => {
    const x = box.left + i * (barWidth + gap)
    if (value === null) {
      ctx.fillStyle = COLORS.line
      ctx.beginPath()
      ctx.roundRect(x, bottom - box.height * 0.05, barWidth, box.height * 0.05, 4)
      ctx.fill()
      return
    }
    const h = heightOf(value)
    const best = value === bestValue && !bestDrawn
    ctx.fillStyle = best ? COLORS.trophy : COLORS.primary
    ctx.beginPath()
    ctx.roundRect(x, bottom - h, barWidth, h, 6)
    ctx.fill()
    if (best) {
      bestDrawn = true
      ctx.fillStyle = COLORS.trophy
      ctx.textAlign = "center"
      fit(ctx, bars.best, fonts.semibold, 28, Math.max(barWidth * 3, 120))
      ctx.fillText(bars.best, Math.min(Math.max(x + barWidth / 2, box.left + 40), box.left + box.width - 40), bottom - h - 14)
    }
  })
  ctx.fillStyle = COLORS.muted
  ctx.font = fonts.regular(28)
  ctx.textAlign = "left"
  ctx.fillText(bars.first, box.left, bottom + 40)
  ctx.textAlign = "right"
  ctx.fillText(bars.last, box.left + box.width, bottom + 40)
  ctx.textAlign = "left"
}

// Up to six figures in rows of three: value, name under it.
function drawFigures(ctx: CanvasRenderingContext2D, fonts: Fonts, figures: FiguresImage["figures"], left: number, top: number, width: number, bottom: number) {
  if (figures.length === 0) return
  const columns = Math.min(3, figures.length)
  const column = width / columns
  const rowHeight = 150
  figures.forEach((figure, i) => {
    const x = left + (i % columns) * column
    const y = top + Math.floor(i / columns) * rowHeight
    if (y + 100 > bottom) return
    if (i % columns === 0 && i > 0) line(ctx, left, left + width, y - 30)
    ctx.textAlign = "left"
    ctx.fillStyle = COLORS.text
    fit(ctx, figure.value, fonts.condensed, 72, column - 24)
    ctx.fillText(figure.value, x, y + 60)
    ctx.fillStyle = COLORS.muted
    fit(ctx, figure.label, fonts.regular, 28, column - 24)
    ctx.fillText(figure.label, x, y + 100)
  })
}
