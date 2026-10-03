// The edit: one timeline for picture and sound. Times are seconds of film (30 fps).
//
// Clips:   "black" | "board" (a rendered 3D shot) | "app" (a range of an app take, retimed by
//          `map`: [film time, take time] pairs, a flat stretch is an invisible hold while the
//          screen is idle) | "split" (board above, app below) | "card" (end card).
// Camera:  for app clips, keyframes { t, cx, cy, z }: the app point (cx, cy) in CSS pixels sits
//          at the frame's anchor, z = 1 shows the whole phone screen 1500 px tall.
// Board shots: darts already in the board, and throws landing at `at` (seconds into the shot).

import { bedPoint } from "./board-geometry.mjs"

export const FPS = 30
export const WIDTH = 1080
export const HEIGHT = 1920
export const DURATION = 37.0

// Flights per player: Mia blue (the brand), Leo white, Sam black, Lena graphite.
const F = { mia: "blue", leo: "white", sam: "black", lena: "graphite" }

// Darts as they sit in the board: a little apart within a bed, tails up and slightly right.
const at = (bed, flight, extra = {}) => ({ bed, flight, ...extra })
const MIA_T20_A = at("T20", F.mia, { offset: { du: -6 }, dir: [0.08, 0.2, 1] })
const MIA_20 = at("20", F.mia, { offset: { du: 3 }, dir: [0.03, 0.17, 1], roll: 1.1 })
const MIA_T20_B = at("T20", F.mia, { offset: { du: 6, dr: -0.6 }, dir: [0.02, 0.19, 1], roll: 2.3 })
const MIA_BULL = at("Bull", F.mia, { dir: [0.06, 0.18, 1], roll: 0.4 })
// The cold open's visit, before anyone opens the app: T20, 20, 5 = 85 (the chalkboard gets it wrong).
const CO_T20 = MIA_T20_A
const CO_20 = MIA_20
const CO_5 = at("5", F.mia, { dir: [0.06, 0.21, 1], roll: 1.9 })

// Cameras aim at the darts, not at a bed: the centre of the new dart (and the ones already
// there), seen from a direction and distance, focused on the tip of the dart landing now.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (v, s) => v.map((x) => x * s)
const norm = (v) => mul(v, 1 / Math.hypot(...v))
const tipOf = (d) => { const [x, y] = bedPoint(d.bed, d.offset ?? {}); return [x / 1000, y / 1000, 0] }
const along = (d, a) => add(tipOf(d), mul(norm(d.dir ?? [0.06, 0.2, 1]), a))

// Directions from the subject to the camera: right side (profile), below left (low),
// broadcast (front right, a little below), straight on (front).
const VIEW = { profile: [0.84, -0.03, 0.54], low: [-0.38, -0.5, 0.78], broadcast: [0.31, -0.22, 0.92], front: [0.16, -0.14, 0.98] }

// `subject`: darts whose centres frame the shot; `hero`: the dart the focus is on.
function shotCam(view, subject, hero, distance, fov = 24, { a = 0.065, aperture = 0.003, lift = 0 } = {}) {
  const pts = subject.map((d) => along(d, a))
  const target = add(mul(pts.reduce(add), 1 / pts.length), [0, lift, 0])
  const pos = add(target, mul(norm(VIEW[view] ?? view), distance))
  return { pos, target, fov, focus: dist(pos, along(hero, 0.012)), aperture }
}
const push = (c, amount = 0.06) => ({ ...c, to: { pos: add(c.pos, mul([c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]], amount)), focus: c.focus * (1 - amount) } })

const LEO_20 = at("20", F.leo, { offset: { du: -3 }, dir: [-0.04, 0.2, 1] })
const LEO_T20 = at("T20", F.leo, { offset: { du: 3 }, dir: [0.05, 0.21, 1], roll: 0.8 })
const LEO_5 = at("5", F.leo, { dir: [0.06, 0.2, 1], roll: 1.9 })
const SAM_T19 = at("T19", F.sam, { dir: [0.04, 0.22, 1], roll: 0.3 })
const LENA_T20_A = at("T20", F.lena, { offset: { du: -2 }, dir: [0.07, 0.2, 1] })
const LENA_T20_B = at("T20", F.lena, { offset: { du: 5 }, dir: [0.02, 0.18, 1], roll: 1.4 })
const LENA_10 = at("10", F.lena, { offset: { du: 2, outer: true, dr: 13 }, dir: [0.05, 0.19, 1], roll: 0.9 })
const MIA_20_G = at("20", F.mia, { offset: { du: 2 }, dir: [0.03, 0.17, 1], roll: 1.1 })

export const BOARD = {
  // Cold open: one visit, three darts, nobody keeping score yet.
  co1: { duration: 0.8, samples: 112, camera: push(shotCam("profile", [CO_T20], CO_T20, 0.36, 26, { a: 0.03 }), 0.06), darts: [], throws: [{ ...CO_T20, at: 0.38, speed: 8 }] },
  co2: { duration: 0.56, samples: 112, camera: push(shotCam("low", [CO_T20, CO_20], CO_20, 0.4, 26), 0.05), darts: [CO_T20], throws: [{ ...CO_20, at: 0.16, speed: 8 }] },
  co3: { duration: 0.56, samples: 112, camera: push(shotCam("broadcast", [CO_T20, CO_20, CO_5], CO_5, 0.5, 24), 0.05), darts: [CO_T20, CO_20], throws: [{ ...CO_5, at: 0.16, speed: 8 }] },
  co4: {
    duration: 0.7, samples: 96, roomLight: 60, roomPos: [0.0, 1.9, 0.9], roomTarget: [0, -0.2, 0],
    people: [{ pos: [-0.108, -0.5, 1.5], turn: 0.25 }, { pos: [0.132, -0.54, 1.3], turn: -0.3, scale: 1.04 }, { pos: [0.3, -0.45, 1.75], turn: -0.5, scale: 0.97 }],
    camera: { pos: [0.02, -0.2, 2.45], target: [0, -0.07, 0], fov: 27, focus: 2.45, aperture: 0.016, to: { pos: [0.02, -0.19, 2.3], focus: 2.3 } },
    darts: [CO_T20, CO_20, CO_5], throws: [],
  },
  co5: {
    duration: 0.88, samples: 96, roomLight: 60, roomPos: [0.6, 2.4, 1.6], roomTarget: [0.74, -0.04, 0],
    camera: { pos: [0.6, -0.04, 1.08], target: [0.725, -0.02, 0], fov: 30, focus: 1.09, aperture: 0.005, to: { pos: [0.62, -0.035, 0.98], focus: 0.99 } },
    darts: [], throws: [],
  },

  // Mia's first visit: T20, 20, T20. The first one sits in the split screen (middle band).
  g1: { duration: 1.2, samples: 96, camera: push(shotCam("profile", [MIA_T20_A], MIA_T20_A, 0.4, 24, { a: 0.035 }), 0.04), darts: [], throws: [{ ...MIA_T20_A, at: 0.15, speed: 9 }] },
  g2: { duration: 0.4, samples: 80, camera: shotCam("low", [MIA_T20_A, MIA_20_G], MIA_20_G, 0.4, 26), darts: [MIA_T20_A], throws: [{ ...MIA_20_G, at: 0.2, speed: 10 }] },
  g3: { duration: 0.4, samples: 80, camera: shotCam("front", [MIA_T20_A, MIA_20_G, MIA_T20_B], MIA_T20_B, 0.42, 24), darts: [MIA_T20_A, MIA_20_G], throws: [{ ...MIA_T20_B, at: 0.13, speed: 10 }] },

  // Leo: 20, T20, 5. Sam: T19.
  l1: { duration: 0.3, samples: 72, camera: shotCam("broadcast", [LEO_20], LEO_20, 0.36, 24), darts: [], throws: [{ ...LEO_20, at: 0.12, speed: 11 }] },
  l2: { duration: 0.3, samples: 72, camera: shotCam("profile", [LEO_T20], LEO_T20, 0.36, 26, { a: 0.03 }), darts: [LEO_20], throws: [{ ...LEO_T20, at: 0.1, speed: 11 }] },
  l3: { duration: 0.3, samples: 72, camera: shotCam("low", [LEO_20, LEO_T20, LEO_5], LEO_5, 0.44, 26), darts: [LEO_20, LEO_T20], throws: [{ ...LEO_5, at: 0.1, speed: 11 }] },
  s1: { duration: 0.25, samples: 72, camera: shotCam("front", [SAM_T19], SAM_T19, 0.36, 24), darts: [], throws: [{ ...SAM_T19, at: 0.1, speed: 11 }] },

  // Lena on 140: T20, T20, then single 10 instead of double 10.
  lena1: { duration: 0.25, samples: 72, camera: shotCam("broadcast", [LENA_T20_A], LENA_T20_A, 0.34, 24), darts: [], throws: [{ ...LENA_T20_A, at: 0.1, speed: 11 }] },
  lena2: { duration: 0.25, samples: 72, camera: shotCam("profile", [LENA_T20_B], LENA_T20_B, 0.36, 26, { a: 0.03 }), darts: [LENA_T20_A], throws: [{ ...LENA_T20_B, at: 0.15, speed: 11 }] },
  lena3: { duration: 0.25, samples: 72, camera: shotCam("front", [LENA_10], LENA_10, 0.38, 24), darts: [], throws: [{ ...LENA_10, at: 0.2, speed: 11 }] },

  // Mia on 170: T20, T20, Bull. Slower, closer, and the bull in slow motion.
  ck1: { duration: 0.65, samples: 112, camera: push(shotCam("profile", [MIA_T20_A], MIA_T20_A, 0.33, 26, { a: 0.03 }), 0.06), darts: [], throws: [{ ...MIA_T20_A, at: 0.25, speed: 7 }] },
  ck2: { duration: 0.45, samples: 112, camera: push(shotCam("low", [MIA_T20_A, MIA_T20_B], MIA_T20_B, 0.36, 26), 0.06), darts: [MIA_T20_A], throws: [{ ...MIA_T20_B, at: 0.15, speed: 7 }] },
  ck3: {
    duration: 1.05, samples: 128, slowmo: 0.25, shutter: 0.35, camera: push(shotCam("broadcast", [MIA_BULL], MIA_BULL, 0.34, 24), 0.08),
    darts: [MIA_T20_A, MIA_T20_B], throws: [{ ...MIA_BULL, at: 0.75, speed: 5, wobble: 0.08 }],
  },

  // The 170 in the board, and the last dart of the film.
  beauty: { duration: 1.5, samples: 128, camera: push(shotCam("broadcast", [MIA_T20_A, MIA_T20_B, MIA_BULL], MIA_BULL, 0.62, 28, { a: 0.06, lift: -0.105, aperture: 0.0026 }), 0.07), darts: [MIA_T20_A, MIA_T20_B, MIA_BULL], throws: [] },
  final: { duration: 0.36, samples: 112, camera: shotCam("front", [MIA_BULL], MIA_BULL, 0.36, 24), darts: [], throws: [{ ...MIA_BULL, at: 0.23, speed: 9 }] },
}

// The app's full screen view: centre of the 393 x 852 screen, whole phone visible.
const FULL = { cx: 196.5, cy: 426, z: 1 }
const k = (t, cx, cy, z, ease) => ({ t, cx, cy, z, ...(ease ? { ease } : {}) })

export const CLIPS = [
  { t0: 0, t1: 0.8, type: "board", shot: "co1" },
  { t0: 0.8, t1: 1.36, type: "board", shot: "co2" },
  { t0: 1.36, t1: 1.92, type: "board", shot: "co3" },
  { t0: 1.92, t1: 2.62, type: "board", shot: "co4" },
  { t0: 2.62, t1: 3.5, type: "board", shot: "co5" },

  // Home, setup and the game starting: one take, held where the screen is idle.
  {
    t0: 3.5, t1: 11.85, type: "app", take: "onboarding",
    map: [[3.5, 0], [6.1, 2.6], [6.35, 2.6], [9.25, 5.5], [10.5, 5.5], [11.85, 6.85]],
    camera: [k(3.5, 196.5, 262, 1.42), k(4.65, FULL.cx, FULL.cy, 1), k(5.15, FULL.cx, FULL.cy, 1), k(6.05, 196.5, 392, 1.34), k(8.9, 196.5, 452, 1.27), k(10.35, 196.5, 470, 1.33), k(11.0, FULL.cx, FULL.cy, 1), k(11.85, FULL.cx, FULL.cy, 1)],
  },

  // Mia's first dart: board above, the entry below. Impacts sit on the beat (120 BPM from 3.5 s).
  { t0: 11.85, t1: 13.05, type: "split", shot: "g1", take: "onboarding", map: [[11.85, 7.55], [13.05, 8.75]], camera: [k(11.85, 196.5, 519, 1.27), k(13.05, 196.5, 516, 1.29)] },
  { t0: 13.05, t1: 13.45, type: "board", shot: "g2" },
  { t0: 13.45, t1: 13.87, type: "app", take: "onboarding", map: [[13.45, 8.83], [13.87, 9.25]], camera: [k(13.45, 196.5, 400, 1.12), k(13.87, 196.5, 395, 1.16)] },
  { t0: 13.87, t1: 14.27, type: "board", shot: "g3" },
  { t0: 14.27, t1: 15.38, type: "app", take: "onboarding", map: [[14.27, 9.79], [15.38, 10.9]], camera: [k(14.27, 196.5, 400, 1.12), k(14.75, 196.5, 400, 1.12), k(15.32, 196.5, 250, 1.42)] },

  // Leo, then Sam: dart, score, next player.
  { t0: 15.38, t1: 15.68, type: "board", shot: "l1" },
  { t0: 15.68, t1: 15.9, type: "app", take: "onboarding", map: [[15.68, 11.33], [15.9, 11.55]], camera: [k(15.68, 196.5, 330, 1.22), k(15.9, 196.5, 326, 1.24)] },
  { t0: 15.9, t1: 16.2, type: "board", shot: "l2" },
  { t0: 16.2, t1: 16.65, type: "app", take: "onboarding", map: [[16.2, 12.18], [16.65, 12.63]], camera: [k(16.2, 196.5, 360, 1.18), k(16.65, 196.5, 355, 1.21)] },
  { t0: 16.65, t1: 16.95, type: "board", shot: "l3" },
  { t0: 16.95, t1: 17.4, type: "app", take: "onboarding", map: [[16.95, 13.1], [17.4, 13.55]], camera: [k(16.95, 196.5, 300, 1.24), k(17.4, 196.5, 280, 1.3)] },
  { t0: 17.4, t1: 17.65, type: "board", shot: "s1" },
  { t0: 17.65, t1: 18.2, type: "app", take: "onboarding", map: [[17.65, 14.32], [18.2, 14.87]], camera: [k(17.65, 196.5, 330, 1.2), k(18.2, 196.5, 320, 1.24)] },

  // Later: Lena on 140 with her route, the whole board of scores.
  { t0: 18.2, t1: 19.4, type: "app", take: "late", map: [[18.2, 0.9], [19.4, 0.9]], camera: [k(18.2, 196.5, 262, 1.66), k(18.7, 196.5, 276, 1.64), k(19.4, 196.5, 300, 1.6)] },
  { t0: 19.4, t1: 19.65, type: "board", shot: "lena1" },
  { t0: 19.65, t1: 20.1, type: "app", take: "late", map: [[19.65, 1.45], [20.1, 1.9]], camera: [k(19.65, 196.5, 380, 1.12), k(20.1, 196.5, 380, 1.12)] },
  { t0: 20.1, t1: 20.35, type: "board", shot: "lena2" },
  { t0: 20.35, t1: 20.8, type: "app", take: "late", map: [[20.35, 2.55], [20.8, 3.0]], camera: [k(20.35, 196.5, 390, 1.1), k(20.8, 196.5, 390, 1.1)] },
  { t0: 20.8, t1: 21.05, type: "board", shot: "lena3" },

  // Lena left on 10, Ben misses, Mia on 170: the game is close, and her route is on screen.
  {
    t0: 21.05, t1: 24.75, type: "app", take: "late",
    map: [[21.05, 3.6], [21.45, 4.0], [21.45, 4.45], [22.3, 5.3], [24.75, 5.3]],
    camera: [k(21.05, 196.5, 400, 1.1), k(21.5, 196.5, 300, 1.28), k(22.4, 196.5, 232, 1.45), k(23.3, 196.5, 218, 1.64), k(24.75, 196.5, 216, 1.66)],
  },

  // The checkout: T20, T20, and the bull in slow motion, landing on the downbeat.
  { t0: 24.75, t1: 25.4, type: "board", shot: "ck1" },
  { t0: 25.4, t1: 25.85, type: "app", take: "late", map: [[25.4, 6.95], [25.85, 7.4]], camera: [k(25.4, 196.5, 390, 1.32), k(25.85, 196.5, 385, 1.36)] },
  { t0: 25.85, t1: 26.3, type: "board", shot: "ck2" },
  { t0: 26.3, t1: 26.75, type: "app", take: "late", map: [[26.3, 8.55], [26.75, 9.0]], camera: [k(26.3, 196.5, 390, 1.32), k(26.5, 196.5, 380, 1.34), k(26.75, 196.5, 216, 1.66)] },
  { t0: 26.75, t1: 27.8, type: "board", shot: "ck3" },
  {
    t0: 27.8, t1: 30.5, type: "app", take: "late", map: [[27.8, 10.3], [30.5, 13.0]],
    camera: [k(27.8, 196.5, 470, 1.14), k(27.95, 196.5, 470, 1.14), k(28.5, FULL.cx, FULL.cy, 1), k(28.9, FULL.cx, FULL.cy, 1), k(30.45, 196.5, 395, 1.36)],
  },

  // One, two, six players: the same app.
  { t0: 30.5, t1: 31.25, type: "app", take: "solo", map: [[30.5, 0.95], [31.25, 1.7]], layout: "label", label: "1 Player", camera: [k(30.5, 196.5, 330, 0.98), k(31.25, 196.5, 330, 1.0)] },
  { t0: 31.25, t1: 32.0, type: "app", take: "duo", map: [[31.25, 0.95], [32.0, 1.7]], layout: "label", label: "2 Players", camera: [k(31.25, 196.5, 330, 0.98), k(32.0, 196.5, 330, 1.0)] },
  { t0: 32.0, t1: 32.75, type: "app", take: "six", map: [[32.0, 0.95], [32.75, 1.7]], layout: "label", label: "6 Players", camera: [k(32.0, 196.5, 330, 0.98), k(32.75, 196.5, 330, 1.0)] },
  { t0: 32.75, t1: 34.27, type: "board", shot: "beauty" },
  { t0: 34.27, t1: 34.6, type: "board", shot: "final" },
  { t0: 34.6, t1: DURATION, type: "card" },
]

// Words on screen.
export const TEXTS = [
  { t0: 2.78, t1: 3.46, lines: ["Who's counting?"], style: "statement", y: 0.5 },
  { t0: 32.85, t1: 34.2, lines: ["Same board.", "Same game.", "No paperwork."], style: "stack", y: 0.5, stagger: 0.28 },
]

// Narration cue times (first sound of each phrase).
export const VO = [
  { id: "v1", t: 3.64 },
  { id: "v2a", t: 6.05 },
  { id: "v2b", t: 9.3 },
  { id: "v3", t: 12.35 },
  { id: "v4", t: 15.4 },
  { id: "v5", t: 21.2 },
  { id: "v6", t: 26.12 },
]

// Music: 120 BPM from the cut into the app; sections by beat number (beat 0 = 3.5 s).
export const MUSIC = {
  start: 3.5,
  bpm: 120,
  sections: [
    { name: "intro", from: 0, to: 16 },
    { name: "scoring", from: 16, to: 24 },
    { name: "rhythm", from: 24, to: 36 },
    { name: "close", from: 36, to: 43 },
    { name: "breakdown", from: 43, to: 48 },
    { name: "win", from: 48, to: 54 },
    { name: "montage", from: 54, to: 58.5 },
    { name: "tag", from: 58.5, to: 62 },
    { name: "end", from: 62, to: 66 },
  ],
}

// Picture cues the sound keys on, beyond taps and dart impacts (derived from the clips).
export const CUES = {
  coldOpenEnd: 3.5,
  result: 27.93,
  montage: [30.5, 31.25, 32.0],
  card: 34.6,
  click: 36.5,
}
