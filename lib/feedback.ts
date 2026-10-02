"use client"

// Sound, voice and vibration for game events. Everything here is best effort:
// browsers that lack an API simply stay quiet.

let audio: AudioContext | null = null

function context() {
  if (typeof window === "undefined") return null
  if (!audio) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    audio = new Ctx()
  }
  // iOS starts the context suspended until a tap; every call here comes from one.
  if (audio.state === "suspended") void audio.resume()
  return audio
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = "sine", gain = 0.18, endFreq?: number) {
  const ctx = context()
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration)
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(amp).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

export type SoundName = "dart" | "miss" | "bust" | "leg" | "match" | "max" | "undo"

export function playSound(name: SoundName) {
  switch (name) {
    case "dart":
      // A short, low thud, like a dart going into sisal.
      tone(220, 0, 0.09, "triangle", 0.22, 70)
      break
    case "miss":
      tone(160, 0, 0.12, "sine", 0.12, 110)
      break
    case "undo":
      tone(520, 0, 0.07, "sine", 0.1, 380)
      break
    case "bust":
      tone(196, 0, 0.18, "sawtooth", 0.08)
      tone(147, 0.16, 0.28, "sawtooth", 0.08)
      break
    case "leg":
      ;[523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle", 0.14))
      break
    case "match":
      ;[523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, i === 3 ? 0.6 : 0.24, "triangle", 0.16))
      break
    case "max":
      ;[392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.3, "square", 0.06))
      break
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Not supported (iOS Safari).
  }
}

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = "en-GB"
  utterance.rate = 1.02
  const voice = synth.getVoices().find((v) => v.lang === "en-GB")
  if (voice) utterance.voice = voice
  synth.speak(utterance)
}
