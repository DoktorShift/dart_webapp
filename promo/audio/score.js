// The soundtrack, synthesized offline from the edit: dart impacts, UI sounds, room tone, a
// minimal 120 BPM score and the narration, rendered as stems plus a mix.
// Stems on one OfflineAudioContext with 8 channels: music 0-1, sfx 2-3, voice 4-5, mix 6-7.
import { CUES, DURATION, MUSIC, VO } from "/timeline/edit.mjs"
import { filmImpacts, filmTaps } from "/timeline/derive.mjs"

const SR = 48000
let ctx

// ---- Deterministic randomness ----
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- Buffers ----
let NOISE
function noise() {
  if (NOISE) return NOISE
  const r = rng(4242)
  NOISE = ctx.createBuffer(1, SR * 2, SR)
  const d = NOISE.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1
  return NOISE
}

// A stereo reverb impulse: decaying noise, darkened over time.
function impulse(seconds, { power = 3, lowpass = 5000, seed = 1, early = 0 } = {}) {
  const len = Math.round(seconds * SR)
  const buf = ctx.createBuffer(2, len, SR)
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 101)
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const k = i / len
      const cutoff = lowpass * (1 - 0.7 * k)
      const a = Math.exp((-2 * Math.PI * cutoff) / SR)
      lp = a * lp + (1 - a) * (r() * 2 - 1)
      d[i] = lp * Math.pow(1 - k, power)
    }
    // A few early reflections, like walls close by.
    for (let e = 0; e < early; e++) {
      const at = Math.round((0.004 + r() * 0.03) * SR)
      d[at] += (r() > 0.5 ? 1 : -1) * (0.5 - e * 0.06)
    }
  }
  return buf
}

function reverb(seconds, opts, out, wet = 1) {
  const conv = ctx.createConvolver()
  conv.buffer = impulse(seconds, opts)
  const g = ctx.createGain()
  g.gain.value = wet
  conv.connect(g).connect(out)
  return conv
}

// ---- Building blocks ----
function noiseHit(out, t, { bp, hp, lp, q = 1, attack = 0.001, decay = 0.05, gain = 1, offset = 0 }) {
  const src = ctx.createBufferSource()
  src.buffer = noise()
  let node = src
  for (const [type, freq] of [["bandpass", bp], ["highpass", hp], ["lowpass", lp]]) {
    if (!freq) continue
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = type === "bandpass" ? q : 0.707
    node.connect(f)
    node = f
  }
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + attack)
  g.gain.setTargetAtTime(0, t + attack, decay / 3)
  node.connect(g).connect(out)
  src.start(t, offset % 1.5, attack + decay * 2.5)
}

function sineHit(out, t, { f, f2, glide = 0.02, attack = 0.0015, decay = 0.1, gain = 1, type = "sine" }) {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + glide)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + attack)
  g.gain.setTargetAtTime(0, t + attack, decay / 3)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + attack + decay * 3)
}

function saturator(amount = 1.6) {
  const ws = ctx.createWaveShaper()
  const n = 2048
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  ws.curve = curve
  ws.oversample = "4x"
  return ws
}

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12)

// ---- Sound effects ----

// A steel-tip dart going into sisal: the point's tick, the fibres giving, the board and wall
// answering, and a low weight. `slowmo` stretches it for the slow-motion bull.
function thud(out, room, t, { gain = 1, pitch = 1, weight = 1, slowmo = 1, pan = 0, seed = 1, roomSend = 0.12 } = {}) {
  const r = rng(seed)
  const p = pitch * (0.97 + r() * 0.06)
  const bus = ctx.createGain()
  bus.gain.value = gain
  const sat = saturator(1.3)
  const panner = ctx.createStereoPanner()
  panner.pan.value = pan
  bus.connect(sat).connect(panner).connect(out)
  if (room) {
    const send = ctx.createGain()
    send.gain.value = roomSend
    panner.connect(send).connect(room)
  }
  const s = slowmo
  // Tip: a bright, very short tick.
  noiseHit(bus, t, { bp: 5200 * p, q: 1.0, attack: 0.0002, decay: 0.006 * s, gain: 0.32, offset: r() })
  // Fibres: a dull mid "thup" and a short dry crunch.
  noiseHit(bus, t + 0.0004, { bp: 650 * p, q: 0.9, attack: 0.0006, decay: 0.022 * s, gain: 0.55, offset: r() })
  noiseHit(bus, t + 0.0006, { bp: 1350 * p, q: 0.75, attack: 0.0005, decay: 0.026 * s, gain: 0.6, offset: r() })
  noiseHit(bus, t + 0.001, { bp: 2900 * p, q: 1.4, attack: 0.0004, decay: 0.012 * s, gain: 0.22, offset: r() })
  // Board body: well damped, slightly inharmonic modes that drop a little as the hit settles.
  for (const [f, d, g] of [[190, 0.045, 1], [331, 0.032, 0.7], [547, 0.022, 0.45], [883, 0.015, 0.25], [1370, 0.01, 0.15]]) {
    sineHit(bus, t, { f: f * p * 1.05, f2: f * p, glide: 0.014 * s, decay: d * s, gain: g * 0.42 })
  }
  // Weight: a quick low push, enough to make it a THUD without ringing.
  sineHit(bus, t, { f: 86 * p, f2: 52 * p, glide: 0.035 * s, attack: 0.002, decay: 0.075 * s, gain: 0.62 * weight })
  // The dart shivering in the board, barely there.
  const shiver = ctx.createGain()
  shiver.gain.value = 0
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 11 / s
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.035
  lfo.connect(lfoGain).connect(shiver.gain)
  noiseHit(shiver, t + 0.01, { bp: 2400, q: 6, attack: 0.004, decay: 0.12 * s, gain: 1, offset: r() })
  shiver.connect(bus)
  lfo.start(t)
  lfo.stop(t + 0.5 * s)
}

// Air moving just before a dart lands, very faint.
function whoosh(out, t, { dur = 0.16, gain = 0.06, seed = 3 } = {}) {
  const src = ctx.createBufferSource()
  src.buffer = noise()
  const f = ctx.createBiquadFilter()
  f.type = "bandpass"
  f.Q.value = 1.4
  f.frequency.setValueAtTime(500, t - dur)
  f.frequency.exponentialRampToValueAtTime(2600, t)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t - dur)
  g.gain.linearRampToValueAtTime(gain, t - 0.01)
  g.gain.linearRampToValueAtTime(0, t + 0.004)
  src.connect(f).connect(g).connect(out)
  src.start(t - dur, rng(seed)() * 1.2, dur + 0.02)
}

// A key on the keypad: a crisp, short click.
function keyClick(out, t, { f = 2300, gain = 0.1, seed = 5 } = {}) {
  const r = rng(seed)
  sineHit(out, t, { f: f * (0.98 + r() * 0.04), attack: 0.0005, decay: 0.012, gain })
  noiseHit(out, t, { hp: 3500, attack: 0.0003, decay: 0.004, gain: gain * 0.8, offset: r() })
}

// A dart registered: two soft sine tones, a fifth apart.
function confirm(out, t, { gain = 0.045, step = 0 } = {}) {
  const base = 1318.5 * Math.pow(2, step / 12)
  sineHit(out, t, { f: base, attack: 0.003, decay: 0.06, gain })
  sineHit(out, t + 0.035, { f: base * 1.5, attack: 0.003, decay: 0.08, gain: gain * 0.8 })
}

// The turn moving on: a quiet airy swipe.
function swish(out, t, { gain = 0.05 } = {}) {
  const src = ctx.createBufferSource()
  src.buffer = noise()
  const f = ctx.createBiquadFilter()
  f.type = "bandpass"
  f.Q.value = 2.2
  f.frequency.setValueAtTime(2200, t)
  f.frequency.exponentialRampToValueAtTime(7000, t + 0.14)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.05)
  g.gain.linearRampToValueAtTime(0, t + 0.16)
  src.connect(f).connect(g).connect(out)
  src.start(t, 0.7, 0.2)
}

// A clean mechanical latch: click, then clack.
function latch(out, room, t, { gain = 0.35 } = {}) {
  for (const [dt, f, g] of [[0, 3300, 1], [0.034, 2350, 0.62]]) {
    noiseHit(out, t + dt, { bp: f, q: 9, attack: 0.0002, decay: 0.03, gain: gain * g, offset: dt * 7 })
    noiseHit(out, t + dt, { hp: 5000, attack: 0.0001, decay: 0.003, gain: gain * g * 0.6, offset: dt * 3 })
    sineHit(out, t + dt, { f: f * 0.5, attack: 0.0005, decay: 0.02, gain: gain * g * 0.3 })
  }
  if (room) {
    const send = ctx.createGain()
    send.gain.value = 0.12
    noiseHit(send, t, { bp: 3000, q: 4, attack: 0.0002, decay: 0.03, gain: gain })
    send.connect(room)
  }
}

// Low room tone for the cold open: air and a distant hum, nothing anyone says.
function roomTone(out, t0, t1, gain = 0.02) {
  const src = ctx.createBufferSource()
  src.buffer = noise()
  src.loop = true
  const lp = ctx.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 380
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.25)
  g.gain.setValueAtTime(gain, t1 - 0.2)
  g.gain.linearRampToValueAtTime(0, t1 + 0.15)
  src.connect(lp).connect(g).connect(out)
  src.start(t0)
  src.stop(t1 + 0.2)
  const hum = ctx.createOscillator()
  hum.frequency.value = 100
  const hg = ctx.createGain()
  hg.gain.setValueAtTime(0, t0)
  hg.gain.linearRampToValueAtTime(gain * 0.08, t0 + 0.3)
  hg.gain.linearRampToValueAtTime(0, t1 + 0.1)
  hum.connect(hg).connect(out)
  hum.start(t0)
  hum.stop(t1 + 0.2)
}

// ---- Music instruments ----
function kick(out, t, gain = 1) {
  sineHit(out, t, { f: 150, f2: 46, glide: 0.07, attack: 0.002, decay: 0.32, gain: 0.9 * gain })
  noiseHit(out, t, { hp: 1800, attack: 0.0003, decay: 0.006, gain: 0.12 * gain })
}

function hat(out, t, { gain = 0.1, decay = 0.028, seed = 9 } = {}) {
  noiseHit(out, t, { hp: 7200, bp: 10500, q: 0.8, attack: 0.0005, decay, gain, offset: rng(seed)() })
}

function clap(out, t, gain = 0.3) {
  for (let i = 0; i < 3; i++) noiseHit(out, t + i * 0.009, { bp: 1700, q: 1.6, attack: 0.0005, decay: i === 2 ? 0.12 : 0.01, gain: gain * (i === 2 ? 1 : 0.6), offset: i * 0.31 })
}

function tick(out, t, gain = 0.05) {
  sineHit(out, t, { f: 3150, attack: 0.0004, decay: 0.008, gain })
}

function bassNote(out, t, dur, midi, { gain = 0.3, cutoff = 420, env = 900 } = {}) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.006)
  g.gain.setTargetAtTime(gain * 0.55, t + 0.01, 0.08)
  g.gain.setTargetAtTime(0, t + dur, 0.03)
  const f = ctx.createBiquadFilter()
  f.type = "lowpass"
  f.Q.value = 2
  f.frequency.setValueAtTime(cutoff + env, t)
  f.frequency.setTargetAtTime(cutoff, t, 0.06)
  for (const det of [-7, 7]) {
    const o = ctx.createOscillator()
    o.type = "sawtooth"
    o.frequency.value = midiHz(midi)
    o.detune.value = det
    o.connect(f)
    o.start(t)
    o.stop(t + dur + 0.2)
  }
  const sub = ctx.createOscillator()
  sub.frequency.value = midiHz(midi - 12)
  const sg = ctx.createGain()
  sg.gain.value = 0.9
  sub.connect(sg).connect(g)
  sub.start(t)
  sub.stop(t + dur + 0.2)
  f.connect(g).connect(out)
}

function pluck(out, t, midi, { gain = 0.08, cutoff = 3200 } = {}) {
  const o = ctx.createOscillator()
  o.type = "square"
  o.frequency.value = midiHz(midi)
  const f = ctx.createBiquadFilter()
  f.type = "lowpass"
  f.Q.value = 1
  f.frequency.setValueAtTime(cutoff, t)
  f.frequency.setTargetAtTime(700, t, 0.05)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.003)
  g.gain.setTargetAtTime(0, t + 0.003, 0.09)
  o.connect(f).connect(g).connect(out)
  o.start(t)
  o.stop(t + 0.6)
}

function pad(out, t, dur, midis, { gain = 0.05, attack = 0.5, release = 1.2, cutoff = 1500 } = {}) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + attack)
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur))
  g.gain.setTargetAtTime(0, t + Math.max(attack, dur), release / 3)
  const f = ctx.createBiquadFilter()
  f.type = "lowpass"
  f.frequency.value = cutoff
  f.Q.value = 0.5
  f.connect(g).connect(out)
  for (const m of midis)
    for (const det of [-9, 0, 9]) {
      const o = ctx.createOscillator()
      o.type = "sawtooth"
      o.frequency.value = midiHz(m)
      o.detune.value = det
      const og = ctx.createGain()
      og.gain.value = 1 / (midis.length * 3)
      o.connect(og).connect(f)
      o.start(t)
      o.stop(t + Math.max(attack, dur) + release * 2)
    }
}

function riser(out, t0, t1, gain = 0.18) {
  const src = ctx.createBufferSource()
  src.buffer = noise()
  src.loop = true
  const f = ctx.createBiquadFilter()
  f.type = "bandpass"
  f.Q.value = 2.5
  f.frequency.setValueAtTime(280, t0)
  f.frequency.exponentialRampToValueAtTime(7200, t1)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t1 - 0.02)
  g.gain.linearRampToValueAtTime(0, t1)
  src.connect(f).connect(g).connect(out)
  src.start(t0)
  src.stop(t1 + 0.05)
  const o = ctx.createOscillator()
  o.type = "triangle"
  o.frequency.setValueAtTime(110, t0)
  o.frequency.exponentialRampToValueAtTime(440, t1)
  const og = ctx.createGain()
  og.gain.setValueAtTime(0.0001, t0)
  og.gain.exponentialRampToValueAtTime(gain * 0.25, t1 - 0.02)
  og.gain.linearRampToValueAtTime(0, t1)
  o.connect(og).connect(out)
  o.start(t0)
  o.stop(t1 + 0.05)
}

function subBoom(out, t, gain = 0.8) {
  sineHit(out, t, { f: 62, f2: 31, glide: 0.9, attack: 0.004, decay: 1.4, gain })
}

// ---- Arrangement ----
const CHORDS = {
  Dm: { root: 38, pad: [62, 65, 69, 72] },
  Bb: { root: 34, pad: [58, 62, 65, 69] },
  F: { root: 41, pad: [53, 57, 60, 64] },
  C: { root: 36, pad: [60, 64, 67, 74] },
  Gm: { root: 31, pad: [55, 58, 62, 65] },
  A: { root: 33, pad: [57, 62, 64, 67] },
  D: { root: 38, pad: [62, 66, 69, 76] },
  G: { root: 31, pad: [55, 59, 62, 69] },
  Bm: { root: 35, pad: [59, 62, 66, 69] },
}
// One chord per bar (4 beats) from the cut into the app.
const BARS = ["Dm", "Bb", "F", "C", "Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "A", "D", "G", "D", "D", "D"]
const MOTIF_MINOR = [[0, 74], [3, 69], [6, 77], [8, 72], [11, 69], [14, 74]]
const MOTIF_MAJOR = [[0, 74], [3, 69], [6, 78], [8, 76], [11, 69], [14, 74]]

function section(n) {
  return MUSIC.sections.find((s) => n >= s.from && n < s.to)?.name ?? "none"
}

function music(out, hall) {
  const beat = 60 / MUSIC.bpm
  const T = (n) => MUSIC.start + n * beat
  const drums = ctx.createGain()
  drums.gain.value = 1
  drums.connect(out)
  // Drums go dull through the "close" section and come back for the win.
  const drumTone = ctx.createBiquadFilter()
  drumTone.type = "lowpass"
  drumTone.frequency.setValueAtTime(18000, 0)
  drumTone.frequency.setValueAtTime(18000, T(36))
  drumTone.frequency.exponentialRampToValueAtTime(900, T(42.5))
  drumTone.frequency.setValueAtTime(18000, T(48))
  drumTone.connect(drums)
  // Bass and pad breathe with the kick.
  const pump = ctx.createGain()
  pump.connect(out)
  const motifBus = ctx.createGain()
  motifBus.gain.value = 1
  const delay = ctx.createDelay(1)
  delay.delayTime.value = beat * 0.75
  const fb = ctx.createGain()
  fb.gain.value = 0.32
  const delayOut = ctx.createGain()
  delayOut.gain.value = 0.26
  motifBus.connect(out)
  motifBus.connect(delay)
  delay.connect(fb).connect(delay)
  delay.connect(delayOut).connect(out)
  const send = ctx.createGain()
  send.gain.value = 0.22
  send.connect(hall)
  motifBus.connect(send)

  const kicks = []
  for (let n = 0; n < 66; n += 0.25) {
    const sec = section(n)
    const t = T(n)
    const inBeat = n % 1
    const beatInBar = Math.floor(n) % 4
    const bar = Math.floor(n / 4)
    const chord = CHORDS[BARS[Math.min(bar, BARS.length - 1)]]
    if (sec === "intro") {
      if (inBeat === 0 && beatInBar % 2 === 0) { kick(drumTone, t, 0.75); kicks.push(t) }
      if (inBeat === 0.5) hat(drumTone, t, { gain: 0.05, seed: n * 4 })
      if (inBeat === 0.75 && beatInBar === 3) tick(drumTone, t, 0.03)
      if (inBeat === 0 || inBeat === 0.5) bassNote(pump, t, beat * 0.42, chord.root, { gain: 0.16, cutoff: 260, env: 380 })
    } else if (sec === "scoring" || sec === "rhythm" || sec === "win" || sec === "montage") {
      const full = sec !== "scoring"
      if (inBeat === 0) { kick(drumTone, t, sec === "montage" ? 0.9 : 0.74); kicks.push(t) }
      hat(drumTone, t, { gain: inBeat === 0.5 ? 0.075 : 0.035, decay: inBeat === 0.5 && full ? 0.07 : 0.026, seed: n * 4 })
      if (full && inBeat === 0 && (beatInBar === 1 || beatInBar === 3)) clap(drumTone, t, 0.2)
      if (inBeat === 0.75 && beatInBar % 2 === 1) tick(drumTone, t, 0.03)
      if (inBeat === 0 || inBeat === 0.5) {
        const octave = full && inBeat === 0.5 && beatInBar % 2 === 1 ? 12 : 0
        bassNote(pump, t, beat * 0.42, chord.root + octave, { gain: 0.16, cutoff: full ? 380 : 300, env: 700 })
      }
      const motif = sec === "win" || sec === "montage" ? MOTIF_MAJOR : MOTIF_MINOR
      const step = Math.round((n % 4) * 4)
      const hit = motif.find(([s]) => s === step)
      if (hit && sec !== "montage") pluck(motifBus, t, hit[1], { gain: sec === "scoring" ? 0.05 : 0.06 })
    } else if (sec === "close") {
      // A heartbeat under the route on screen; the bass holds.
      if (inBeat === 0 && beatInBar % 2 === 0) { kick(drumTone, t, 0.7); kick(drumTone, t + 0.18, 0.45); kicks.push(t) }
      if (inBeat === 0.5) tick(drumTone, t, 0.035)
      if (inBeat === 0 && beatInBar === 0) bassNote(pump, t, beat * 3.6, chord.root, { gain: 0.15, cutoff: 200, env: 200 })
    } else if (sec === "breakdown") {
      // Near silence: a clock-like tick, the darts carry the rhythm.
      if (inBeat === 0) tick(drumTone, t, 0.03)
    } else if (sec === "tag") {
      if (inBeat === 0 && beatInBar % 2 === 0) bassNote(pump, t, beat * 1.6, 38, { gain: 0.09, cutoff: 180, env: 120 })
    }
  }
  // Pads, a bar at a time.
  for (let bar = 0; bar < 17; bar++) {
    const n = bar * 4
    const sec = section(n)
    const chord = CHORDS[BARS[bar]]
    if (sec === "intro") pad(pump, T(n), beat * 4, chord.pad, { gain: 0.03, attack: 0.6, release: 0.8, cutoff: 1100 })
    else if (sec === "scoring" || sec === "rhythm") pad(pump, T(n), beat * 4, chord.pad, { gain: 0.035, attack: 0.3, release: 0.6, cutoff: 1500 })
    else if (sec === "close") pad(pump, T(n), beat * 3.8, chord.pad, { gain: 0.04, attack: 0.8, release: 0.6, cutoff: 900 })
  }
  // Breakdown: a riser into the bull, cut dead on the impact.
  riser(out, T(45), T(48), 0.16)
  pad(pump, T(44), beat * 3.9, CHORDS.A.pad, { gain: 0.035, attack: 1.5, release: 0.05, cutoff: 1200 })
  // The win: low boom, a D major chord with air on it.
  subBoom(out, T(48), 0.75)
  pad(out, T(48), beat * 5.5, CHORDS.D.pad, { gain: 0.07, attack: 0.012, release: 1.6, cutoff: 3200 })
  pad(send, T(48), beat * 2, [74, 78, 81], { gain: 0.05, attack: 0.01, release: 1.6, cutoff: 6000 })
  pad(pump, T(52), beat * 2.5, CHORDS.G.pad, { gain: 0.04, attack: 0.05, release: 0.6, cutoff: 2000 })
  // Tag and end card: one calm chord, held until the latch.
  pad(out, T(58.5), beat * 3.4, CHORDS.D.pad, { gain: 0.075, attack: 0.5, release: 0.25, cutoff: 1500 })
  pad(out, T(62.3), beat * 3.6, CHORDS.D.pad, { gain: 0.15, attack: 0.9, release: 0.02, cutoff: 2000 })
  bassNote(out, T(62.3), beat * 3.6, 38, { gain: 0.07, cutoff: 160, env: 60 })
  pad(send, T(62.6), beat * 3.2, [86, 90, 93], { gain: 0.035, attack: 1.2, release: 0.02, cutoff: 7000 })

  // Sidechain-style breathing on bass and pads.
  pump.gain.setValueAtTime(1, 0)
  for (const k of kicks) {
    pump.gain.setValueAtTime(1, k)
    pump.gain.linearRampToValueAtTime(0.42, k + 0.012)
    pump.gain.setTargetAtTime(1, k + 0.03, 0.07)
  }
  // Nothing rings over the final dart and the black, and everything stops on the latch.
  out.gain.setValueAtTime(out.gain.value, T(61.95))
  out.gain.linearRampToValueAtTime(0, T(62))
  out.gain.setValueAtTime(0, T(62.25))
  out.gain.linearRampToValueAtTime(out.gain.value, T(62.6))
  out.gain.setValueAtTime(out.gain.value, CUES.click - 0.004)
  out.gain.linearRampToValueAtTime(0, CUES.click + 0.002)
}

function sfx(out, room) {
  const impacts = filmImpacts()
  impacts.forEach((imp, i) => {
    const cold = imp.t < CUES.coldOpenEnd
    const slow = imp.slowmo < 1
    const last = imp.shot === "final"
    thud(out, room, imp.t, {
      gain: cold ? 0.95 : slow ? 1.05 : last ? 1.0 : 0.78,
      pitch: slow ? 0.72 : 1,
      weight: slow ? 1.6 : cold || last ? 1.2 : 0.9,
      slowmo: slow ? 3.2 : 1,
      pan: (i % 3) * 0.06 - 0.06,
      seed: 31 + i * 7,
      roomSend: cold ? 0.22 : slow ? 0.3 : 0.1,
    })
    if (cold || slow || last) whoosh(out, imp.t, { dur: slow ? 0.6 : 0.15, gain: slow ? 0.05 : 0.04, seed: i })
  })
  // The montage cuts land on a dart.
  CUES.montage.forEach((t, i) => thud(out, room, t, { gain: 0.72, weight: 1, seed: 501 + i, roomSend: 0.08 }))
  return impacts
}

function ui(out, takes) {
  const taps = filmTaps(takes)
  const darts = new Set(["T20", "T19", "20", "5", "19", "3", "1", "10", "Bull"])
  // Which taps end a visit (the turn moves on) or the game.
  const visitEnds = new Set([14.713, 17.05, 21.15, 21.648].map((t) => t.toFixed(2)))
  let dartIndex = 0
  for (const tap of taps) {
    const up = tap.up
    if (tap.label === "Treble" || tap.label === "Double") keyClick(out, tap.t + 0.004, { f: 1650, gain: 0.07, seed: Math.round(tap.t * 100) })
    else if (darts.has(tap.label) || tap.label === "3× Miss") {
      keyClick(out, up, { f: 2350, gain: 0.085, seed: Math.round(tap.t * 100) })
      if (tap.label !== "3× Miss") confirm(out, up + 0.02, { step: [0, 2, 4][dartIndex++ % 3] })
      if (visitEnds.has(tap.t.toFixed(2))) { swish(out, up + 0.06); dartIndex = 0 }
    } else keyClick(out, up, { f: 1250, gain: 0.07, seed: Math.round(tap.t * 100) })
  }
  return taps
}

async function voice(out, voiceName) {
  const durations = {}
  for (const cue of VO) {
    const res = await fetch(`/build/vo/${voiceName}/${cue.id}.wav`)
    const buf = await ctx.decodeAudioData(await res.arrayBuffer())
    durations[cue.id] = buf.duration
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(out)
    src.start(cue.t)
  }
  return durations
}

export async function render({ voiceName = "af_heart", withVoice = true } = {}) {
  const takes = {}
  for (const name of ["onboarding", "late", "solo", "duo", "six"]) takes[name] = await (await fetch(`/build/takes/${name}/events.json`)).json()
  const length = Math.ceil(DURATION * SR)
  ctx = new OfflineAudioContext({ numberOfChannels: 8, length, sampleRate: SR })
  NOISE = null
  const merger = ctx.createChannelMerger(8)
  merger.connect(ctx.destination)
  const toStem = (node, ch) => {
    const split = ctx.createChannelSplitter(2)
    node.connect(split)
    split.connect(merger, 0, ch)
    split.connect(merger, 1, ch + 1)
  }

  // Buses, always stereo (a mono source is spread to both sides, not left only).
  const stereo = (node) => Object.assign(node, { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" })
  const musicBus = stereo(ctx.createGain())
  musicBus.gain.value = 0.85
  const sfxBus = stereo(ctx.createGain())
  sfxBus.gain.value = 1
  const voBus = stereo(ctx.createGain())
  voBus.gain.value = 1
  const hall = reverb(2.2, { power: 3.2, lowpass: 5200, seed: 7 }, musicBus, 0.9)
  const room = reverb(0.55, { power: 2.4, lowpass: 3800, seed: 11, early: 6 }, sfxBus, 0.9)

  music(musicBus, hall)
  roomTone(sfxBus, 0, CUES.coldOpenEnd, 0.028)
  sfx(sfxBus, room)
  ui(sfxBus, takes)
  latch(sfxBus, room, CUES.click, { gain: 0.32 })

  // Narration: high-pass, a little presence, gentle compression.
  const voHp = ctx.createBiquadFilter()
  voHp.type = "highpass"
  voHp.frequency.value = 85
  const voPresence = ctx.createBiquadFilter()
  voPresence.type = "peaking"
  voPresence.frequency.value = 3200
  voPresence.gain.value = 2
  voPresence.Q.value = 0.9
  const voComp = ctx.createDynamicsCompressor()
  voComp.threshold.value = -22
  voComp.ratio.value = 2.6
  voComp.attack.value = 0.006
  voComp.release.value = 0.12
  voComp.knee.value = 8
  const voGain = ctx.createGain()
  voGain.gain.value = 1.25
  voHp.connect(voPresence).connect(voComp).connect(voGain).connect(voBus)
  const durations = withVoice ? await voice(voHp, voiceName) : {}

  // Music steps back under the narration.
  const duck = stereo(ctx.createGain())
  duck.gain.setValueAtTime(1, 0)
  if (withVoice)
    for (const cue of VO) {
      const t0 = cue.t
      const t1 = cue.t + durations[cue.id]
      duck.gain.setValueAtTime(1, Math.max(0, t0 - 0.16))
      duck.gain.linearRampToValueAtTime(0.3, t0 - 0.02)
      duck.gain.setValueAtTime(0.3, t1)
      duck.gain.linearRampToValueAtTime(1, t1 + 0.4)
    }
  musicBus.connect(duck)

  // Mix: glue compression, then a fast peak catcher.
  const mix = stereo(ctx.createGain())
  mix.gain.value = 0.9
  duck.connect(mix)
  sfxBus.connect(mix)
  voBus.connect(mix)
  const glue = ctx.createDynamicsCompressor()
  glue.threshold.value = -14
  glue.ratio.value = 2.2
  glue.attack.value = 0.008
  glue.release.value = 0.15
  glue.knee.value = 6
  const catcher = ctx.createDynamicsCompressor()
  catcher.threshold.value = -3
  catcher.ratio.value = 20
  catcher.attack.value = 0.001
  catcher.release.value = 0.05
  catcher.knee.value = 0
  mix.connect(glue).connect(catcher)

  toStem(musicBus, 0)
  toStem(sfxBus, 2)
  toStem(voBus, 4)
  toStem(catcher, 6)
  const out = await ctx.startRendering()
  window.__rendered = out
  return { durations, length: out.length }
}

// One stereo stem as a 24-bit WAV, base64.
export function stemWav(index) {
  const out = window.__rendered
  const L = out.getChannelData(index * 2)
  const R = out.getChannelData(index * 2 + 1)
  const n = L.length
  const bytes = new Uint8Array(44 + n * 6)
  const v = new DataView(bytes.buffer)
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, "RIFF"); v.setUint32(4, 36 + n * 6, true); str(8, "WAVE"); str(12, "fmt ")
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true)
  v.setUint32(28, SR * 6, true); v.setUint16(32, 6, true); v.setUint16(34, 24, true); str(36, "data"); v.setUint32(40, n * 6, true)
  let o = 44
  for (let i = 0; i < n; i++)
    for (const ch of [L, R]) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      const x = Math.round(s * 8388607)
      v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255)
      o += 3
    }
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

window.score = { render, stemWav }
