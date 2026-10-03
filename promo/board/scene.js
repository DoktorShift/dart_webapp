// The dartboard shots: a regulation board (the app's own geometry and colours, from
// lib/board-geometry.ts), steel-tip darts, an LED ring light and the room around it.
// Every frame is an average of many renders: each one samples a moment inside the shutter
// (motion blur), a point on the lens (depth of field), a point on the ring light (soft,
// multiple shadows like a real LED surround) and a sub-pixel offset (anti-aliasing).
import * as THREE from "three"

const MM = 0.001

import { BOARD_NUMBERS, R, bedPoint } from "../timeline/board-geometry.mjs"

const COLORS = { black: "#1f1d1a", cream: "#ecdfc2", red: "#d0282e", green: "#12804a" }

// ---- Small deterministic noise helpers ----
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Value noise on a lattice of `cell` pixels, smooth-interpolated, written into out (0..1).
function valueNoise(width, height, cell, seed, out, weight) {
  const gw = Math.ceil(width / cell) + 2
  const gh = Math.ceil(height / cell) + 2
  const rnd = mulberry(seed)
  const grid = new Float32Array(gw * gh)
  for (let i = 0; i < grid.length; i++) grid[i] = rnd()
  for (let y = 0; y < height; y++) {
    const gy = y / cell
    const y0 = Math.floor(gy)
    let fy = gy - y0
    fy = fy * fy * (3 - 2 * fy)
    for (let x = 0; x < width; x++) {
      const gx = x / cell
      const x0 = Math.floor(gx)
      let fx = gx - x0
      fx = fx * fx * (3 - 2 * fx)
      const a = grid[y0 * gw + x0]
      const b = grid[y0 * gw + x0 + 1]
      const c = grid[(y0 + 1) * gw + x0]
      const d = grid[(y0 + 1) * gw + x0 + 1]
      out[y * width + x] += weight * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy)
    }
  }
}

// ---- Board face textures: colour, and a packed roughness/metalness map ----
const TEX = 4096
const TEX_MM = 460 // the texture spans 460 mm, the board face is 452 mm across
const px = (mm) => ((mm + TEX_MM / 2) / TEX_MM) * TEX

function sectorPath(ctx, r1, r2, a1, a2) {
  const s = (deg) => ((deg - 90) * Math.PI) / 180 // canvas angle from "clockwise from top"
  ctx.beginPath()
  ctx.arc(px(0), px(0), (r2 / TEX_MM) * TEX, s(a1), s(a2), false)
  ctx.arc(px(0), px(0), (r1 / TEX_MM) * TEX, s(a2), s(a1), true)
  ctx.closePath()
}

function boardTextures() {
  const color = document.createElement("canvas")
  color.width = color.height = TEX
  const ctx = color.getContext("2d")
  ctx.fillStyle = "#121110"
  ctx.fillRect(0, 0, TEX, TEX)
  // Outer black ring up to the rim.
  ctx.beginPath()
  ctx.arc(px(0), px(0), (R.rim / TEX_MM) * TEX, 0, Math.PI * 2)
  ctx.fillStyle = "#161514"
  ctx.fill()
  const beds = [
    ["inner", R.outerBull, R.trebleInner],
    ["triple", R.trebleInner, R.trebleOuter],
    ["outer", R.trebleOuter, R.doubleInner],
    ["double", R.doubleInner, R.doubleOuter],
  ]
  BOARD_NUMBERS.forEach((_, i) => {
    const a1 = i * 18 - 9
    const dark = i % 2 === 0
    for (const [bed, r1, r2] of beds) {
      sectorPath(ctx, r1, r2, a1, a1 + 18)
      ctx.fillStyle = bed === "triple" || bed === "double" ? (dark ? COLORS.red : COLORS.green) : dark ? COLORS.black : COLORS.cream
      ctx.fill()
    }
  })
  ctx.beginPath()
  ctx.arc(px(0), px(0), (R.outerBull / TEX_MM) * TEX, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.green
  ctx.fill()
  ctx.beginPath()
  ctx.arc(px(0), px(0), (R.bull / TEX_MM) * TEX, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.red
  ctx.fill()

  // Sisal: fine fibre grain, mottling and a few loose light fibres, over every bed.
  const img = ctx.getImageData(0, 0, TEX, TEX)
  const n = new Float32Array(TEX * TEX)
  valueNoise(TEX, TEX, 2.2, 11, n, 0.5)
  valueNoise(TEX, TEX, 7, 12, n, 0.3)
  valueNoise(TEX, TEX, 38, 13, n, 0.2)
  const rnd = mulberry(99)
  const d = img.data
  const cx = TEX / 2
  const rimPx = (R.rim / TEX_MM) * TEX
  for (let i = 0, p = 0; i < n.length; i++, p += 4) {
    const x = i % TEX
    const y = (i / TEX) | 0
    if (Math.hypot(x - cx, y - cx) > rimPx) continue
    const v = n[i] - 0.5
    const speck = rnd()
    let f = 1 + v * 0.34
    if (speck > 0.985) f *= 1.22
    else if (speck < 0.012) f *= 0.72
    const lum = (d[p] + d[p + 1] + d[p + 2]) / 3
    // Dark beds show pale fibre ends; light beds darker ones.
    const fibre = lum < 90 ? Math.max(0, v) * 34 : 0
    d[p] = Math.min(255, d[p] * f + fibre)
    d[p + 1] = Math.min(255, d[p + 1] * f + fibre * 0.92)
    d[p + 2] = Math.min(255, d[p + 2] * f + fibre * 0.78)
  }
  ctx.putImageData(img, 0, 0)

  // Numbers on the outer ring, upright as on a real board, in the app's display face.
  const orm = document.createElement("canvas")
  orm.width = orm.height = TEX / 2
  const octx = orm.getContext("2d")
  octx.fillStyle = "rgb(0, 235, 0)" // G = roughness 0.92, B = metalness 0
  octx.fillRect(0, 0, TEX / 2, TEX / 2)
  const fontPx = (24 / TEX_MM) * TEX
  for (const target of [ctx, octx]) {
    const scale = target === ctx ? 1 : 0.5
    target.save()
    target.scale(scale, scale)
    target.font = `600 ${fontPx}px "Barlow Condensed"`
    target.textAlign = "center"
    target.textBaseline = "middle"
    BOARD_NUMBERS.forEach((number, i) => {
      const a = (i * 18 * Math.PI) / 180
      const x = px(R.numbers * Math.sin(a))
      const y = px(-R.numbers * Math.cos(a))
      if (target === ctx) {
        const g = target.createLinearGradient(x, y - fontPx / 2, x, y + fontPx / 2)
        g.addColorStop(0, "#f4f6f8")
        g.addColorStop(1, "#b9c0c8")
        target.fillStyle = g
      } else target.fillStyle = "rgb(0, 140, 0)" // painted: satin, not metal
      target.fillText(String(number), x, y + fontPx * 0.04)
    })
    target.restore()
  }
  return { color, orm, height: n, numbers: (ctx2, scale) => drawNumbers(ctx2, scale, fontPx) }
}

// Number positions, for flattening the normal map under the painted numbers.
function drawNumbers(ctx, scale, fontPx) {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.font = `600 ${fontPx}px "Barlow Condensed"`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "rgb(128, 128, 255)"
  BOARD_NUMBERS.forEach((number, i) => {
    const a = (i * 18 * Math.PI) / 180
    ctx.fillText(String(number), px(R.numbers * Math.sin(a)), px(-R.numbers * Math.cos(a)) + fontPx * 0.04)
  })
  ctx.restore()
}

// Tangent-space normal map from the fibre height field (half resolution).
function normalMap(height) {
  const size = TEX / 2
  const c = document.createElement("canvas")
  c.width = c.height = size
  const ctx = c.getContext("2d")
  const img = ctx.createImageData(size, size)
  const h = (x, y) => height[Math.min(TEX - 1, Math.max(0, y * 2)) * TEX + Math.min(TEX - 1, Math.max(0, x * 2))]
  const strength = 3.2
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const p = (y * size + x) * 4
      img.data[p] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[p + 1] = ((dy / len) * 0.5 + 0.5) * 255
      img.data[p + 2] = ((1 / len) * 0.5 + 0.5) * 255
      img.data[p + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  return c
}

// Matte plaster for the wall and foam for the surround: fine mottled noise.
function plaster(size, base, amount, seed) {
  const c = document.createElement("canvas")
  c.width = c.height = size
  const ctx = c.getContext("2d")
  const img = ctx.createImageData(size, size)
  const n = new Float32Array(size * size)
  valueNoise(size, size, 3, seed, n, 0.45)
  valueNoise(size, size, 22, seed + 1, n, 0.35)
  valueNoise(size, size, 140, seed + 2, n, 0.2)
  const col = new THREE.Color(base)
  for (let i = 0; i < n.length; i++) {
    const f = 1 + (n[i] - 0.5) * amount
    img.data[i * 4] = Math.min(255, col.r * 255 * f)
    img.data[i * 4 + 1] = Math.min(255, col.g * 255 * f)
    img.data[i * 4 + 2] = Math.min(255, col.b * 255 * f)
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// The chalk scoreboard next to the board: the arithmetic of a pub game, crossed out and redone.
function chalkboardTexture() {
  const W = 1400
  const H = 1900
  const K = 1.5
  const c = document.createElement("canvas")
  c.width = W * K
  c.height = H * K
  const ctx = c.getContext("2d")
  ctx.scale(K, K)
  // Slate with old chalk dust.
  const slate = plaster(512, "#1d2421", 0.25, 41)
  ctx.drawImage(slate, 0, 0, W, H)
  const rnd = mulberry(7)
  ctx.filter = "blur(60px)"
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = "#cfd6d2"
    ctx.beginPath()
    ctx.ellipse(rnd() * W, rnd() * H, 160 + rnd() * 260, 50 + rnd() * 90, rnd() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.filter = "none"
  ctx.globalAlpha = 1
  const write = (text, x, y, size, { alpha = 0.92, rot = 0, cross = false } = {}) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.font = `600 ${size}px "Caveat"`
    ctx.fillStyle = `rgba(236, 240, 236, ${alpha})`
    ctx.textBaseline = "alphabetic"
    ctx.fillText(text, 0, 0)
    if (cross) {
      const w = ctx.measureText(text).width
      ctx.strokeStyle = `rgba(236, 240, 236, ${alpha})`
      ctx.lineWidth = size * 0.07
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(-size * 0.08, -size * 0.28)
      ctx.lineTo(w + size * 0.08, -size * 0.36)
      ctx.stroke()
    }
    ctx.restore()
  }
  // Column rules.
  ctx.strokeStyle = "rgba(236,240,236,0.8)"
  ctx.lineWidth = 9
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(W / 2 + 6, 120)
  ctx.lineTo(W / 2 - 10, H - 160)
  ctx.moveTo(110, 300)
  ctx.lineTo(W - 120, 286)
  ctx.stroke()
  write("MIA", 210, 250, 170, { rot: -0.02 })
  write("LEO", 860, 244, 170, { rot: 0.01 })
  write("501", 200, 470, 150)
  write("501", 850, 468, 150)
  write("441", 196, 650, 150, { cross: true, rot: 0.01 })
  write("416", 850, 650, 150)
  write("361", 196, 830, 150, { rot: -0.015 })
  write("341", 850, 830, 150, { cross: true })
  write("331", 846, 1010, 150, { rot: 0.02 })
  // Mia's 85: one wrong sum, crossed out, and a second one nobody is sure about.
  write("−85", 470, 935, 104, { rot: -0.05, alpha: 0.8 })
  write("281", 192, 1010, 150, { cross: true, rot: -0.01 })
  write("276", 200, 1190, 150, { rot: 0.012, alpha: 0.9 })
  write("?", 470, 1200, 190, { rot: 0.1, alpha: 0.85 })
  // Rubbed-out ghosts of earlier sums.
  ctx.globalAlpha = 0.18
  write("396", 860, 1420, 140, { alpha: 1 })
  write("301", 190, 1430, 140, { alpha: 1 })
  ctx.globalAlpha = 1
  // Chalk texture: the strokes are never solid.
  const CW = W * K
  const CH = H * K
  const img = ctx.getImageData(0, 0, CW, CH)
  const noise = new Float32Array(CW * CH)
  valueNoise(CW, CH, 1.8, 77, noise, 0.6)
  valueNoise(CW, CH, 7, 78, noise, 0.4)
  for (let i = 0; i < noise.length; i++) {
    const p = i * 4
    const lum = img.data[p]
    if (lum > 90) {
      const keep = noise[i] > 0.38 ? 1 : 0.45
      img.data[p] = 40 + (lum - 40) * keep
      img.data[p + 1] = 46 + (img.data[p + 1] - 46) * keep
      img.data[p + 2] = 43 + (img.data[p + 2] - 43) * keep
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// ---- Renderer and scene ----
const state = { ready: false }
let renderer, scene, camera, sampleRT, accRT, accScene, finalScene, quadCam, finalMat
let spot, boardGroup, extras = {}
let W = 1080
let H = 1920

const FLIGHTS = {
  blue: { color: "#2563eb", edge: "#93c5fd" },
  white: { color: "#e8ebef", edge: "#9aa3ad" },
  black: { color: "#111317", edge: "#3b82f6" },
  graphite: { color: "#3a3f47", edge: "#d1d5db" },
  red: { color: "#c62828", edge: "#f3f4f6" },
  navy: { color: "#16233f", edge: "#e5e7eb" },
}

function flightTexture(name) {
  const f = FLIGHTS[name]
  const c = document.createElement("canvas")
  c.width = c.height = 256
  const ctx = c.getContext("2d")
  ctx.fillStyle = f.color
  ctx.fillRect(0, 0, 256, 256)
  // A clean stripe along the trailing edge, like a printed flight.
  ctx.fillStyle = f.edge
  ctx.fillRect(0, 218, 256, 14)
  const g = ctx.createLinearGradient(0, 0, 256, 0)
  g.addColorStop(0, "rgba(255,255,255,0.10)")
  g.addColorStop(1, "rgba(0,0,0,0.12)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const materials = {}
function dartMaterials() {
  if (materials.point) return materials
  materials.point = new THREE.MeshStandardMaterial({ color: "#d9dde2", metalness: 1, roughness: 0.34 })
  materials.barrel = new THREE.MeshStandardMaterial({ color: "#a3aab4", metalness: 1, roughness: 0.4 })
  materials.shaft = new THREE.MeshStandardMaterial({ color: "#121318", metalness: 0.7, roughness: 0.35 })
  materials.ring = new THREE.MeshStandardMaterial({ color: "#3b82f6", metalness: 0.6, roughness: 0.3 })
  return materials
}

function lathe(profile, segments = 48) {
  const geo = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r * MM, z * MM)), segments)
  geo.rotateX(Math.PI / 2) // lathe axis y -> dart axis z
  return geo
}

const dartGeometry = (() => {
  let cache
  return () => {
    if (cache) return cache
    const point = lathe([[0, 0], [0.18, 0.25], [0.55, 1.6], [0.9, 4], [1.1, 7.5], [1.15, 11], [1.15, 30.5], [1.7, 31.2], [0, 31.2]], 24)
    // Barrel: front shoulder, ringed grip, smooth rear taper.
    const barrel = [[0, 31], [2.5, 31.2], [3.0, 32.5], [3.3, 35], [3.45, 37.5]]
    for (let z = 38; z < 62; z += 1.5) barrel.push([3.52, z], [3.52, z + 0.95], [3.22, z + 1.05], [3.22, z + 1.45])
    barrel.push([3.5, 62.2], [3.48, 70], [3.2, 76], [2.7, 80], [2.2, 81.6], [0, 81.6])
    const shaft = lathe([[0, 81.4], [2.0, 81.6], [2.05, 92], [2.05, 111], [2.45, 112], [2.45, 118], [1.2, 118.6], [0, 118.6]], 32)
    const ring = lathe([[2.08, 84], [2.12, 84], [2.12, 87.5], [2.08, 87.5]], 32)
    // Flight wing: a standard shape, in the plane through the axis.
    const wing = new THREE.Shape()
    const pts = [[1.2, 106], [5.5, 108.5], [17.2, 127.5], [18.6, 136.5], [18.1, 143.2], [15.8, 146.4], [1.2, 146.4]]
    wing.moveTo(pts[0][0] * MM, pts[0][1] * MM)
    for (const [u, v] of pts.slice(1)) wing.lineTo(u * MM, v * MM)
    wing.closePath()
    const wingGeo = new THREE.ShapeGeometry(wing, 6)
    // ShapeGeometry is in the xy plane: x = radial, y = along the axis. Move y to z.
    wingGeo.rotateX(Math.PI / 2)
    // UVs: u across the wing, v along it, for the printed stripe.
    const pos = wingGeo.attributes.position
    const uv = wingGeo.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (18.6 * MM), (pos.getZ(i) - 106 * MM) / (40.4 * MM))
    cache = { point, barrel: lathe(barrel, 48), shaft, ring, wingGeo }
    return cache
  }
})()

function makeDart(flight) {
  const g = dartGeometry()
  const m = dartMaterials()
  const dart = new THREE.Group()
  const add = (geo, mat) => {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    dart.add(mesh)
    return mesh
  }
  add(g.point, m.point)
  add(g.barrel, m.barrel)
  add(g.shaft, m.shaft)
  add(g.ring, m.ring)
  const flightMat = new THREE.MeshPhysicalMaterial({ map: flightTexture(flight), roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide })
  for (let k = 0; k < 4; k++) {
    const wing = add(g.wingGeo, flightMat)
    wing.rotation.z = (k * Math.PI) / 2
  }
  return dart
}

function buildBoard(tex) {
  const group = new THREE.Group()
  const anis = renderer.capabilities.getMaxAnisotropy()
  const colorTex = new THREE.CanvasTexture(tex.color)
  colorTex.colorSpace = THREE.SRGBColorSpace
  colorTex.anisotropy = anis
  const ormTex = new THREE.CanvasTexture(tex.orm)
  ormTex.anisotropy = anis
  const nCanvas = normalMap(tex.height)
  tex.numbers(nCanvas.getContext("2d"), 0.5)
  const nTex = new THREE.CanvasTexture(nCanvas)
  nTex.anisotropy = anis
  // Face: a disc whose UVs map the 460 mm texture square.
  const faceGeo = new THREE.CircleGeometry(R.rim * MM, 256)
  const uv = faceGeo.attributes.uv
  const pos = faceGeo.attributes.position
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (TEX_MM * MM) + 0.5, pos.getY(i) / (TEX_MM * MM) + 0.5)
  const face = new THREE.Mesh(
    faceGeo,
    new THREE.MeshStandardMaterial({ map: colorTex, roughnessMap: ormTex, metalnessMap: ormTex, roughness: 1, metalness: 1, normalMap: nTex, normalScale: new THREE.Vector2(0.9, 0.9) }),
  )
  face.receiveShadow = true
  group.add(face)
  // Edge of the board.
  const edge = new THREE.Mesh(
    new THREE.CylinderGeometry(R.rim * MM, R.rim * MM, 0.038, 256, 1, true),
    new THREE.MeshStandardMaterial({ color: "#0e0f11", roughness: 0.7, metalness: 0.2 }),
  )
  edge.rotation.x = Math.PI / 2
  edge.position.z = -0.019
  edge.receiveShadow = true
  group.add(edge)
  // The wire spider: rings and radial wires, half sunk into the sisal.
  const wireMat = new THREE.MeshStandardMaterial({ color: "#c9ced6", metalness: 1, roughness: 0.22 })
  for (const r of [R.bull, R.outerBull, R.trebleInner, R.trebleOuter, R.doubleInner, R.doubleOuter]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * MM, 0.55 * MM, 10, Math.max(96, Math.round(r * 3))), wireMat)
    ring.position.z = 0.15 * MM
    ring.castShadow = true
    group.add(ring)
  }
  const radialGeo = new THREE.CylinderGeometry(0.5 * MM, 0.5 * MM, (R.doubleOuter - R.outerBull) * MM, 10)
  for (let i = 0; i < 20; i++) {
    const a = ((i * 18 - 9) * Math.PI) / 180
    const mid = ((R.doubleOuter + R.outerBull) / 2) * MM
    const wire = new THREE.Mesh(radialGeo, wireMat)
    wire.position.set(mid * Math.sin(a), mid * Math.cos(a), 0.15 * MM)
    wire.rotation.z = -a
    wire.castShadow = true
    group.add(wire)
  }
  return group
}

function buildRoom() {
  const anis = renderer.capabilities.getMaxAnisotropy()
  const wallTex = new THREE.CanvasTexture(plaster(1024, "#1a1d22", 0.22, 5))
  wallTex.colorSpace = THREE.SRGBColorSpace
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping
  wallTex.repeat.set(3, 2)
  wallTex.anisotropy = anis
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }))
  wall.position.z = -0.045
  wall.receiveShadow = true
  scene.add(wall)
  // Black foam surround that catches bounce-outs.
  const foamTex = new THREE.CanvasTexture(plaster(1024, "#0d0e10", 0.35, 9))
  foamTex.colorSpace = THREE.SRGBColorSpace
  const surround = new THREE.Mesh(new THREE.RingGeometry(R.rim * MM, 0.43, 256, 1), new THREE.MeshStandardMaterial({ map: foamTex, roughness: 0.98 }))
  surround.position.z = -0.012
  surround.receiveShadow = true
  scene.add(surround)
  const surroundEdge = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.034, 256, 1, true), new THREE.MeshStandardMaterial({ color: "#0b0c0e", roughness: 0.95 }))
  surroundEdge.rotation.x = Math.PI / 2
  surroundEdge.position.z = -0.029
  scene.add(surroundEdge)
  // LED ring light on three arms: a bright diffuser, a dark housing and a thin blue line.
  const ring = new THREE.Group()
  const ringR = 0.3
  const housing = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.014, 24, 256), new THREE.MeshStandardMaterial({ color: "#1b1e23", metalness: 0.8, roughness: 0.35 }))
  ring.add(housing)
  const diffuser = new THREE.Mesh(new THREE.TorusGeometry(ringR - 0.009, 0.0065, 16, 256), new THREE.MeshStandardMaterial({ color: "#000", emissive: "#f4f7ff", emissiveIntensity: 9 }))
  diffuser.position.z = -0.002
  ring.add(diffuser)
  const accent = new THREE.Mesh(new THREE.TorusGeometry(ringR + 0.0132, 0.0016, 8, 256), new THREE.MeshStandardMaterial({ color: "#000", emissive: "#3b82f6", emissiveIntensity: 2.2 }))
  accent.position.z = 0.004
  ring.add(accent)
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.13), housing.material)
    arm.position.set((ringR + 0.012) * Math.cos(a), (ringR + 0.012) * Math.sin(a), -0.05)
    ring.add(arm)
  }
  ring.position.z = 0.12
  ring.traverse((o) => { if (o.isMesh) o.castShadow = false })
  scene.add(ring)
  extras.ring = ring
}

// Silhouettes of people in the foreground of the wide shot: head, neck and shoulders, far out
// of focus, so they read as players standing around the board.
function buildPeople() {
  const mat = new THREE.MeshStandardMaterial({ color: "#07080a", roughness: 0.9 })
  const person = (x, y, z, turn, scale = 1) => {
    const p = new THREE.Group()
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 40, 28), mat)
    head.scale.set(0.82, 1.08, 0.98)
    head.position.y = 0.34
    p.add(head)
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 24), mat)
    neck.position.y = 0.21
    p.add(neck)
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 12, 24), mat)
    shoulders.rotation.z = Math.PI / 2
    shoulders.scale.set(1, 1, 0.7)
    shoulders.position.y = 0.11
    p.add(shoulders)
    const traps = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16), mat)
    traps.scale.set(1.25, 0.55, 0.62)
    traps.position.y = 0.17
    p.add(traps)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.7, 32), mat)
    torso.scale.z = 0.62
    torso.position.y = -0.27
    p.add(torso)
    p.position.set(x, y, z)
    p.rotation.y = turn
    p.scale.setScalar(scale)
    p.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true } })
    return p
  }
  const people = new THREE.Group()
  for (let i = 0; i < 3; i++) people.add(person(0, 0, 0, 0))
  scene.add(people)
  extras.people = people
}

function buildChalkboard() {
  const group = new THREE.Group()
  const tex = new THREE.CanvasTexture(chalkboardTexture())
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const slate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.57), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
  slate.position.z = 0.012
  group.add(slate)
  const wood = new THREE.MeshStandardMaterial({ color: "#3a2b20", roughness: 0.7 })
  for (const [w, h, x, y] of [[0.46, 0.022, 0, 0.296], [0.46, 0.022, 0, -0.296], [0.022, 0.6, 0.219, 0], [0.022, 0.6, -0.219, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), wood)
    bar.position.set(x, y, 0.0)
    group.add(bar)
  }
  group.position.set(0.74, -0.04, -0.03)
  group.traverse((o) => { if (o.isMesh) o.receiveShadow = true })
  scene.add(group)
  extras.chalkboard = group
}

// Reflections: a dark room with the LED ring and a dim ceiling panel, pre-filtered.
function buildEnvironment() {
  const env = new THREE.Scene()
  env.background = new THREE.Color("#030406")
  const room = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), new THREE.MeshBasicMaterial({ color: "#07090c", side: THREE.BackSide }))
  env.add(room)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 16, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 14, 15) }))
  ring.position.set(0, 0, 0.12)
  env.add(ring)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.65, 1.8) }))
  panel.position.set(0, 2.2, 1.5)
  panel.rotation.x = Math.PI / 2
  env.add(panel)
  const soft = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.34, 0.38) }))
  soft.position.set(0.4, 0.3, 3.2)
  soft.rotation.y = Math.PI
  env.add(soft)
  const side = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.32, 0.55) }))
  side.position.set(-2.5, 0.5, 1.2)
  side.rotation.y = Math.PI / 2
  env.add(side)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tex = pmrem.fromScene(env, 0.015).texture
  pmrem.dispose()
  return tex
}

const QUAD_VS = `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

function setupPasses() {
  sampleRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true })
  accRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false })
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.PlaneGeometry(2, 2)
  accScene = new THREE.Scene()
  accScene.add(
    new THREE.Mesh(
      quad,
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { tex: { value: sampleRT.texture } },
        vertexShader: QUAD_VS,
        fragmentShader: `precision highp float; uniform sampler2D tex; in vec2 vUv; out vec4 o; void main() { o = vec4(texture(tex, vUv).rgb, 1.0); }`,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    ),
  )
  finalMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { tex: { value: accRT.texture }, count: { value: 1 }, exposure: { value: 1 }, seed: { value: 0 }, grain: { value: 0.02 }, vignette: { value: 0.22 }, aspect: { value: W / H }, lift: { value: 0.0 } },
    vertexShader: QUAD_VS,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tex; uniform float count, exposure, seed, grain, vignette, aspect, lift;
      in vec2 vUv; out vec4 o;
      // ACES fitted (Stephen Hill)
      vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c) {
        const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        return clamp(outM * RRTAndODTFit(inM * c), 0.0, 1.0);
      }
      float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
      vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec3 c = texture(tex, vUv).rgb / count * exposure;
        vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
        c *= 1.0 - vignette * smoothstep(0.25, 0.95, length(q) * 1.25);
        vec3 m = srgb(aces(c));
        m += lift;
        float n = hash(vUv * vec2(1080.0, 1920.0) + seed * 17.13) + hash(vUv * vec2(1931.0, 1213.0) - seed * 3.7) - 1.0;
        m += n * grain;
        o = vec4(clamp(m, 0.0, 1.0), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
  finalScene = new THREE.Scene()
  finalScene.add(new THREE.Mesh(quad, finalMat))
}

export async function setup({ width = 1080, height = 1920 } = {}) {
  W = width
  H = height
  await document.fonts.load('600 100px "Barlow Condensed"')
  await document.fonts.load('600 100px "Caveat"')
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  document.body.appendChild(canvas)
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.NoToneMapping
  scene = new THREE.Scene()
  scene.background = new THREE.Color("#020305")
  camera = new THREE.PerspectiveCamera(20, W / H, 0.01, 20)
  const tex = boardTextures()
  boardGroup = buildBoard(tex)
  scene.add(boardGroup)
  buildRoom()
  buildPeople()
  buildChalkboard()
  scene.environment = buildEnvironment()
  scene.environmentIntensity = 0.55
  // One spot light, moved around the ring for every sample.
  spot = new THREE.SpotLight("#f5f8ff", 1, 4, Math.PI / 3.2, 0.6, 2)
  spot.castShadow = true
  spot.shadow.mapSize.set(2048, 2048)
  spot.shadow.camera.near = 0.03
  spot.shadow.camera.far = 3
  spot.shadow.bias = -0.00008
  spot.shadow.normalBias = 0.0004
  scene.add(spot)
  scene.add(spot.target)
  // A soft room light from above for the wall, the chalkboard and the people.
  extras.room = new THREE.SpotLight("#dfe6f2", 0, 7, Math.PI / 4, 0.9, 2)
  extras.room.position.set(0.3, 2.3, 1.6)
  extras.room.target.position.set(0.3, -0.2, 0)
  extras.room.castShadow = false
  scene.add(extras.room)
  scene.add(extras.room.target)
  extras.spill = new THREE.PointLight("#eef3ff", 0.05, 3, 2)
  extras.spill.position.set(0, 0, 0.16)
  scene.add(extras.spill)
  extras.hemi = new THREE.HemisphereLight("#9fb4d9", "#0a0b0d", 0.02)
  scene.add(extras.hemi)
  setupPasses()
  state.ready = true
  return true
}

// ---- Shots ----
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const lerp = (a, b, t) => a + (b - a) * t
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

// Camera at shot time t: eased move from `from` to `to`, focus and aperture interpolated.
function cameraAt(cam, t, duration) {
  const k = cam.to ? easeInOut(Math.min(1, Math.max(0, (t - (cam.moveStart ?? 0)) / ((cam.moveEnd ?? duration) - (cam.moveStart ?? 0))))) : 0
  const pick = (key) => (cam.to && cam.to[key] !== undefined ? (Array.isArray(cam[key]) ? lerp3(cam[key], cam.to[key], k) : lerp(cam[key], cam.to[key], k)) : cam[key])
  return { pos: pick("pos"), target: pick("target"), fov: pick("fov"), focus: pick("focus"), aperture: pick("aperture") ?? 0 }
}

const dartPool = new Map()
function dartFor(key, flight) {
  let d = dartPool.get(key)
  if (!d) {
    d = makeDart(flight)
    dartPool.set(key, d)
    scene.add(d)
  }
  d.visible = true
  return d
}

const Z = new THREE.Vector3(0, 0, 1)
const Y = new THREE.Vector3(0, 1, 0)
// Puts a dart with its tip at (x, y) mm, its tail pointing along `dir`, wobbling `wob` radians.
function poseDart(d, tipMM, dir, depth, roll, wob, along = 0) {
  const axis = new THREE.Vector3(...dir).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(Z, axis)
  q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, roll))
  if (wob) {
    const w = new THREE.Vector3().crossVectors(axis, Y).normalize()
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(w, wob))
  }
  d.quaternion.copy(q)
  const tip = new THREE.Vector3(tipMM[0] * MM, tipMM[1] * MM, 0)
  d.position.copy(tip).addScaledVector(axis, along - depth)
}

// Shot time (seconds of film) to the dart's state: in flight before `at`, stuck and wobbling after.
function placeDarts(shot, t) {
  for (const d of dartPool.values()) d.visible = false
  const physics = t * (shot.slowmo ?? 1)
  const all = [...(shot.darts ?? []).map((d) => ({ ...d, at: -10 })), ...(shot.throws ?? [])]
  all.forEach((d, i) => {
    const key = `${shot.id}-${i}`
    const at = (d.at ?? 0) * (shot.slowmo ?? 1)
    const tip = d.tip ?? bedPoint(d.bed, d.offset ?? {})
    const dir = d.dir ?? [0.06, 0.2, 1]
    const roll = d.roll ?? i * 0.7
    const dt = physics - at
    if (dt < -0.6) return
    const dart = dartFor(key, d.flight ?? "blue")
    if (dt < 0) {
      const speed = d.speed ?? 14
      poseDart(dart, tip, dir, 0, roll + dt * 9, 0, -dt * speed)
    } else {
      const amp = d.wobble ?? 0.065
      const wob = amp * Math.exp(-dt / 0.11) * Math.sin(2 * Math.PI * 11 * dt)
      poseDart(dart, tip, dir, Math.min(1, dt / 0.003) * (d.depth ?? 11) * MM, roll, wob)
    }
  })
}

// Camera shake after each impact: a short, damped jolt.
function shakeAt(shot, t) {
  let x = 0
  let y = 0
  const physics = t * (shot.slowmo ?? 1)
  for (const th of shot.throws ?? []) {
    const dt = physics - th.at * (shot.slowmo ?? 1)
    if (dt < 0 || dt > 0.4) continue
    const a = (th.shake ?? shot.shake ?? 0.0006) * Math.exp(-dt / 0.07)
    x += a * Math.sin(2 * Math.PI * 17 * dt + 0.6)
    y += a * 0.7 * Math.sin(2 * Math.PI * 13 * dt + 1.9)
  }
  return [x, y]
}

function radicalInverse(i, base) {
  let f = 1
  let r = 0
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base) }
  return r
}

// Renders one frame of a shot at shot time t (seconds) into the canvas.
export function renderFrame(shot, t, frameIndex = 0) {
  const N = shot.samples ?? 32
  const fps = shot.fps ?? 30
  const shutter = (shot.shutter ?? 0.5) / fps
  renderer.setRenderTarget(accRT)
  renderer.setClearColor(0x000000, 0)
  renderer.clear()
  extras.people.visible = !!shot.people
  extras.people.children.forEach((g, i) => {
    const p = shot.people?.[i]
    g.visible = !!p
    if (!p) return
    g.position.set(p.pos[0], p.pos[1], p.pos[2])
    g.rotation.y = p.turn ?? 0
    g.scale.setScalar(p.scale ?? 1)
  })
  extras.chalkboard.visible = shot.chalkboard !== false
  extras.room.intensity = shot.roomLight ?? 0
  if (shot.roomTarget) { extras.room.target.position.set(...shot.roomTarget); extras.room.target.updateMatrixWorld() }
  if (shot.roomPos) extras.room.position.set(...shot.roomPos)
  const ringPower = shot.ringPower ?? 1
  for (let s = 0; s < N; s++) {
    const u1 = (s + 0.5) / N
    const u2 = radicalInverse(s + 1, 2)
    const u3 = radicalInverse(s + 1, 3)
    const u4 = radicalInverse(s + 1, 5)
    const ts = t + (u1 - 0.5) * shutter
    placeDarts(shot, ts)
    const cam = cameraAt(shot.camera, ts, shot.duration)
    const [sx, sy] = shakeAt(shot, ts)
    camera.fov = cam.fov
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2])
    camera.up.set(0, 1, 0)
    camera.lookAt(cam.target[0], cam.target[1], cam.target[2])
    camera.updateMatrixWorld()
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    // Thin lens: move the eye on the aperture disc and shear the frustum so the focus plane stays put.
    const r = Math.sqrt(u2) * cam.aperture
    const phi = u3 * Math.PI * 2
    const lx = r * Math.cos(phi)
    const ly = r * Math.sin(phi)
    camera.position.addScaledVector(right, lx + sx).addScaledVector(up, ly + sy)
    camera.updateMatrixWorld()
    const near = camera.near
    const top0 = near * Math.tan((cam.fov * Math.PI) / 360)
    const right0 = top0 * camera.aspect
    const focusDist = cam.focus
    const jx = ((u4 - 0.5) * 2 * right0) / W
    const jy = ((radicalInverse(s + 1, 7) - 0.5) * 2 * top0) / H
    const shiftX = -(lx * near) / focusDist + jx
    const shiftY = -(ly * near) / focusDist + jy
    camera.projectionMatrix.makePerspective(-right0 + shiftX, right0 + shiftX, top0 + shiftY, -top0 + shiftY, near, camera.far)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    // Ring light sample.
    const a = ((s + radicalInverse(s + 1, 11)) / N) * Math.PI * 2 + (shot.ringPhase ?? 0)
    spot.position.set(0.291 * Math.cos(a), 0.291 * Math.sin(a), 0.12)
    spot.target.position.set(0.0, 0.0, 0)
    spot.intensity = 0.9 * ringPower
    spot.updateMatrixWorld()
    spot.target.updateMatrixWorld()
    renderer.setRenderTarget(sampleRT)
    renderer.setClearColor(scene.background, 1)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(accRT)
    renderer.autoClear = false
    renderer.render(accScene, quadCam)
    renderer.autoClear = true
  }
  finalMat.uniforms.count.value = N
  finalMat.uniforms.exposure.value = shot.exposure ?? 1.25
  finalMat.uniforms.seed.value = frameIndex
  finalMat.uniforms.grain.value = shot.grain ?? 0.018
  finalMat.uniforms.vignette.value = shot.vignette ?? 0.25
  finalMat.uniforms.lift.value = shot.lift ?? 0
  renderer.setRenderTarget(null)
  renderer.render(finalScene, quadCam)
  const gl = renderer.getContext()
  gl.finish()
  return true
}

export async function frameData(type = "image/png") {
  const blob = await new Promise((resolve) => renderer.domElement.toBlob(resolve, type, 0.95))
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ""
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
  return btoa(s)
}

window.board = { setup, renderFrame, frameData, bedPoint, state }
