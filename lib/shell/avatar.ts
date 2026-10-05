// The rules behind components/ui/avatar.tsx: what a generated picture looks like for a seed, and
// which photo addresses may be shown at all. No React and no browser APIs, so they run in the
// Node unit tests.
//
// The drawing is a little dartboard: a colour pair and a pattern of lit segments that are always
// the same for the same seed (a pubkey, a player id, a name), so people recognise each other at a
// glance. Nothing is uploaded (decision 0001, F5).

// Colour pairs for the drawing; white segments and initials stay readable on each of them.
export const AVATAR_PALETTE: readonly (readonly [string, string])[] = [
  ["#1d4ed8", "#60a5fa"],
  ["#4338ca", "#818cf8"],
  ["#0f766e", "#2dd4bf"],
  ["#15803d", "#4ade80"],
  ["#c2410c", "#fb923c"],
  ["#be123c", "#fb7185"],
  ["#7e22ce", "#c084fc"],
  ["#0369a1", "#38bdf8"],
]

export const AVATAR_SECTORS = 12

// FNV-1a: small, fast and the same in every browser; good enough to spread colours and patterns.
export function seedHash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Which segments are lit: mirrored left/right, so every drawing looks balanced.
function pattern(bits: number): boolean[] {
  const half = AVATAR_SECTORS / 2 + 1
  return Array.from({ length: AVATAR_SECTORS }, (_, i) => {
    const mirrored = i < half ? i : AVATAR_SECTORS - i
    return ((bits >>> mirrored) & 1) === 1
  })
}

// The first letter or digit of a name, in capitals; null when there is none (emoji, empty).
export function initialOf(name?: string): string | null {
  const first = name?.trim().match(/\p{L}|\p{N}/u)?.[0]
  return first ? first.toLocaleUpperCase() : null
}

export interface AvatarDrawing {
  from: string
  to: string
  outer: boolean[]
  inner: boolean[]
  initial: string | null
}

export function avatarDrawing(seed: string, name?: string): AvatarDrawing {
  const h = seedHash(seed || "?")
  const [from, to] = AVATAR_PALETTE[h % AVATAR_PALETTE.length]
  return { from, to, outer: pattern(h >>> 3), inner: pattern(h >>> 11), initial: initialOf(name) }
}

// A photo is only ever an existing https address of a raster image: no other schemes (http,
// data, javascript), and no SVG, which can carry scripts and links (decision 0002 §10).
export function safeImageUrl(src: string | null | undefined): string | null {
  if (!src) return null
  try {
    const url = new URL(src.trim())
    if (url.protocol !== "https:") return null
    if (url.username || url.password) return null
    if (/\.svgz?$/i.test(url.pathname)) return null
    return url.href
  } catch {
    return null
  }
}
