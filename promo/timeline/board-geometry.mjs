// Regulation board geometry, as in lib/board-geometry.ts (millimetres, bull at the origin,
// y up), shared by the 3D renderer and the edit (camera targets).
export const BOARD_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
export const R = { bull: 6.35, outerBull: 15.9, trebleInner: 99, trebleOuter: 107, doubleInner: 162, doubleOuter: 170, numbers: 197, rim: 226 }

// Where a dart lands for a bed label ("T20", "D16", "20", "5", "25", "Bull"), with an offset
// in millimetres along the arc (du) and radius (dr) so darts in one bed sit side by side.
// Singles land in the inner single bed unless `outer` is set.
export function bedPoint(label, { du = 0, dr = 0, outer = false } = {}) {
  if (label === "Bull") return [du * 0.6, -dr * 0.6 - 1.2]
  if (label === "25") return [du, R.bull + 4.5 + dr]
  const m = /^([DT]?)(\d+)$/.exec(label)
  if (!m) throw new Error(`bad bed ${label}`)
  let r = m[1] === "T" ? (R.trebleInner + R.trebleOuter) / 2 : m[1] === "D" ? (R.doubleInner + R.doubleOuter) / 2 : outer ? 136 : 62
  r += dr
  const index = BOARD_NUMBERS.indexOf(Number(m[2]))
  const angle = (index * 18 * Math.PI) / 180 + du / r
  return [r * Math.sin(angle), r * Math.cos(angle)]
}
