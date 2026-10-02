"use client"

import { suggestCheckout } from "./checkout"
import type { MatchState } from "./engine"
import type { AppSettings } from "./storage"
import { playSound, speak, vibrate } from "@/lib/feedback"

// Sound, vibration and the caller after a throw, based on what the throw did.
export function announce(next: MatchState, missed: boolean, settings: AppSettings) {
  const o = next.outcome
  const x01 = next.config.type === "x01"

  if (settings.sound) {
    if (o.type === "match") playSound("match")
    else if (o.type === "leg" || o.type === "set") playSound("leg")
    else if (o.type === "bust") playSound("bust")
    else if (o.type === "visit" && x01 && o.total === 180) playSound("max")
    else playSound(missed ? "miss" : "dart")
  }
  vibrate(o.type === "bust" ? [30, 50, 30] : o.type === "leg" || o.type === "set" || o.type === "match" ? [20, 40, 60] : 8)

  if (!settings.caller) return
  const parts: string[] = []
  if (o.type === "match") parts.push("Game shot, and the match!")
  else if (o.type === "set") parts.push("Game shot, and the set!")
  else if (o.type === "leg") parts.push("Game shot, and the leg!")
  else if (o.type === "bust") parts.push("No score")
  else if (o.type === "visit" && x01) parts.push(o.total === 0 ? "No score" : o.total === 180 ? "One hundred and eighty!" : `${o.total}`)
  if (x01 && (o.type === "visit" || o.type === "bust" || o.type === "turn")) {
    const left = next.scores[next.current]
    if (suggestCheckout(left, 3, next.config.doubleOut)) parts.push(`${next.config.players[next.current].name}, you require ${left}`)
  }
  if (parts.length > 0) speak(parts.join(". "))
}

export function announceUndo(settings: AppSettings) {
  if (settings.sound) playSound("undo")
  vibrate(8)
}
