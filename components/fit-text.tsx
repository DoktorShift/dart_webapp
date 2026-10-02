"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

// Shows text in full on one line by shrinking the font when space is tight, like an iOS
// label with "adjusts font size to fit width". Names are never cut off with an ellipsis.
// If even the smallest size doesn't fit, the text wraps at its natural breaks ("Maximilian-" /
// "Leon"); a single word only breaks when it is wider than the whole line on its own.
export function FitText({
  children,
  className,
  minScale = 0.6,
}: {
  children: ReactNode
  className?: string
  minScale?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.fontSize = ""
      el.style.whiteSpace = "nowrap"
      const available = el.clientWidth
      const needed = el.scrollWidth
      if (available === 0 || needed <= available) return
      const base = Number.parseFloat(getComputedStyle(el).fontSize)
      const scale = available / needed
      if (scale >= minScale) {
        el.style.fontSize = `${Math.floor(base * scale * 10) / 10}px`
      } else {
        el.style.fontSize = `${base * minScale}px`
        el.style.whiteSpace = "normal"
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children, minScale])

  return (
    <span ref={ref} className={cn("block min-w-0 overflow-hidden whitespace-nowrap [overflow-wrap:break-word]", className)}>
      {children}
    </span>
  )
}
