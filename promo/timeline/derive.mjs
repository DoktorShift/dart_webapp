// Times derived from the edit: where each app clip reads its take, when taps and dart impacts
// happen in film time. Shared by the compositor (picture) and the sound design.
import { BOARD, CLIPS, FPS } from "./edit.mjs"

// Take time shown at film time t, for an app or split clip (piecewise linear `map`; a flat
// stretch holds a frame, two keyframes at the same film time make a jump cut).
export function srcAt(clip, t) {
  const m = clip.map
  if (t <= m[0][0]) return m[0][1]
  for (let i = 0; i < m.length - 1; i++) {
    const [t0, s0] = m[i]
    const [t1, s1] = m[i + 1]
    if (t1 === t0) continue
    if (t >= t0 && t < t1) return s0 + ((t - t0) / (t1 - t0)) * (s1 - s0)
  }
  return m[m.length - 1][1]
}

// Film times at which take time s is shown at normal speed inside a clip (taps only fall there).
export function filmTimesOf(clip, s) {
  const out = []
  const m = clip.map
  for (let i = 0; i < m.length - 1; i++) {
    const [t0, s0] = m[i]
    const [t1, s1] = m[i + 1]
    if (t1 === t0 || s1 === s0) continue
    if (s >= s0 && s < s1) out.push(t0 + ((s - s0) / (s1 - s0)) * (t1 - t0))
  }
  return out.filter((t) => t >= clip.t0 && t < clip.t1)
}

// Every tap the audience sees, in film time.
export function filmTaps(takes) {
  const taps = []
  for (const clip of CLIPS) {
    if (clip.type !== "app" && clip.type !== "split") continue
    const events = takes[clip.take]?.events ?? []
    for (const e of events) {
      if (e.type !== "tap") continue
      for (const t of filmTimesOf(clip, e.t)) taps.push({ t, up: t + (e.up - e.t), label: e.label, clip, x: e.x, y: e.y })
    }
  }
  return taps.sort((a, b) => a.t - b.t)
}

// Every dart landing on screen, in film time.
export function filmImpacts() {
  const out = []
  for (const clip of CLIPS) {
    if (clip.type !== "board" && clip.type !== "split") continue
    const shot = BOARD[clip.shot]
    for (const th of shot.throws ?? []) {
      const t = clip.t0 + th.at
      if (t < clip.t1) out.push({ t, bed: th.bed, shot: clip.shot, slowmo: shot.slowmo ?? 1, flight: th.flight })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

export const frameOf = (t) => Math.round(t * FPS)
export const clipAt = (t) => CLIPS.find((c) => t >= c.t0 && t < c.t1)
