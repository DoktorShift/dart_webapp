"use client"

import { useEffect, useRef } from "react"
import { useReducedMotion } from "framer-motion"
import confetti from "canvas-confetti"

// Two bursts of confetti on a decorative canvas that fills its positioned parent, behind the
// content (give that z-10), so it never covers names or numbers. Hidden from assistive tech,
// and skipped with Reduce Motion.
export function ConfettiBurst() {
  const reduceMotion = useReducedMotion()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (reduceMotion || !canvas.current) return
    const fire = confetti.create(canvas.current, { resize: true, disableForReducedMotion: true })
    const shoot = (x: number) => fire({ particleCount: 70, spread: 70, startVelocity: 45, origin: { x, y: 0.75 } })
    shoot(0.2)
    const t = setTimeout(() => shoot(0.8), 180)
    return () => {
      clearTimeout(t)
      fire.reset()
    }
  }, [reduceMotion])

  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full" />
}
