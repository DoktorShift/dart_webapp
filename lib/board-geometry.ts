// Geometry of a regulation dartboard, shared by the on-screen board, tap-to-score and the
// generated app icons. Units are millimetres with the bull at the origin.

// Clockwise from the top.
export const BOARD_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

export const RADIUS = {
  bull: 6.35,
  outerBull: 15.9,
  trebleInner: 99,
  trebleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
  numbers: 197,
  rim: 226,
}

// Room for the number ring plus the light halo around it.
export const BOARD_EXTENT = 250

// The board is a physical object, so its colours are the same in light and dark mode.
export const BOARD_COLORS = {
  black: "#1f1d1a",
  cream: "#ecdfc2",
  red: "#d0282e",
  green: "#12804a",
  wire: "#c3cad3",
  rim: "#17191c",
  numeral: "#eef1f5",
}

export type Bed = "inner-single" | "triple" | "outer-single" | "double"
export type Ring = "single" | "double" | "triple" | "outer-bull" | "bull" | "miss"

export interface Hit {
  ring: Ring
  number: number | null
  score: number
  label: string
}

export interface Segment {
  key: string
  number: number
  bed: Bed
  d: string
  color: string
}

const BEDS: { bed: Bed; r1: number; r2: number }[] = [
  { bed: "inner-single", r1: RADIUS.outerBull, r2: RADIUS.trebleInner },
  { bed: "triple", r1: RADIUS.trebleInner, r2: RADIUS.trebleOuter },
  { bed: "outer-single", r1: RADIUS.trebleOuter, r2: RADIUS.doubleInner },
  { bed: "double", r1: RADIUS.doubleInner, r2: RADIUS.doubleOuter },
]

// Rounded so server and browser render identical path strings (trig differs in the last digits).
const round = (n: number) => Math.round(n * 1000) / 1000

// Point at radius r and angle deg (clockwise from the top).
export function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [round(r * Math.sin(rad)), round(-r * Math.cos(rad))]
}

function sectorPath(r1: number, r2: number, a1: number, a2: number) {
  const [x1, y1] = polar(r2, a1)
  const [x2, y2] = polar(r2, a2)
  const [x3, y3] = polar(r1, a2)
  const [x4, y4] = polar(r1, a1)
  return `M${x1} ${y1}A${r2} ${r2} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 0 0 ${x4} ${y4}Z`
}

// All 80 coloured beds outside the bull. Singles alternate black and cream; doubles and
// trebles are red on black segments and green on cream ones, starting with black 20.
export const SEGMENTS: Segment[] = BOARD_NUMBERS.flatMap((number, i) => {
  const a1 = i * 18 - 9
  const dark = i % 2 === 0
  return BEDS.map(({ bed, r1, r2 }) => ({
    key: `${number}-${bed}`,
    number,
    bed,
    d: sectorPath(r1, r2, a1, a1 + 18),
    color: bed === "triple" || bed === "double" ? (dark ? BOARD_COLORS.red : BOARD_COLORS.green) : dark ? BOARD_COLORS.black : BOARD_COLORS.cream,
  }))
})

// Which bed a point lands in.
export function hitAt(x: number, y: number): Hit {
  const r = Math.hypot(x, y)
  if (r <= RADIUS.bull) return { ring: "bull", number: null, score: 50, label: "Bull" }
  if (r <= RADIUS.outerBull) return { ring: "outer-bull", number: null, score: 25, label: "25" }
  if (r > RADIUS.doubleOuter) return { ring: "miss", number: null, score: 0, label: "Miss" }

  const angle = ((Math.atan2(x, -y) * 180) / Math.PI + 360 + 9) % 360
  const number = BOARD_NUMBERS[Math.floor(angle / 18)]

  if (r >= RADIUS.trebleInner && r <= RADIUS.trebleOuter) return { ring: "triple", number, score: number * 3, label: `T${number}` }
  if (r >= RADIUS.doubleInner) return { ring: "double", number, score: number * 2, label: `D${number}` }
  return { ring: "single", number, score: number, label: `${number}` }
}
