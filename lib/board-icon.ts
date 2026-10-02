import { BOARD_COLORS, RADIUS, SEGMENTS } from "@/lib/board-geometry"

export const ICON_BACKGROUND = "#020817"
export const ICON_ACCENT = "#3b82f6"

// The app icon as SVG markup: the board inside the blue light ring on the app's dark
// background. `fill` is how much of the icon's width the ring takes (smaller for maskable
// icons, whose outer edge may be cropped by the launcher).
export function boardIconSvg(fill: number): string {
  const ring = RADIUS.doubleOuter + 14
  const half = (ring + 6) / fill
  const segments = SEGMENTS.map((s) => `<path d="${s.d}" fill="${s.color}"/>`).join("")
  const wires = [RADIUS.outerBull, RADIUS.trebleInner, RADIUS.trebleOuter, RADIUS.doubleInner, RADIUS.doubleOuter]
    .map((r) => `<circle r="${r}" fill="none" stroke="${BOARD_COLORS.wire}" stroke-width="1.6" opacity="0.8"/>`)
    .join("")

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${half * 2} ${half * 2}">`,
    `<rect x="${-half}" y="${-half}" width="${half * 2}" height="${half * 2}" fill="${ICON_BACKGROUND}"/>`,
    `<circle r="${ring}" fill="${BOARD_COLORS.rim}" stroke="${ICON_ACCENT}" stroke-width="7"/>`,
    segments,
    `<circle r="${RADIUS.outerBull}" fill="${BOARD_COLORS.green}"/>`,
    `<circle r="${RADIUS.bull}" fill="${BOARD_COLORS.red}"/>`,
    wires,
    `</svg>`,
  ].join("")
}

export const svgDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
