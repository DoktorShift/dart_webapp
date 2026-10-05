"use client"

import { useEffect, useRef, type RefObject } from "react"

// Keyboard and VoiceOver focus follow navigation: when the layer in `ref` comes back on top, focus
// returns to the control in it that was focused last (the one that opened what covered it), or to
// the first element matching `fallback` if that control is gone. In a hidden tab nothing happens:
// an element that isn't displayed can't take focus.
export function useFocusReturn(ref: RefObject<HTMLElement | null>, onTop: boolean, fallback?: string) {
  const lastFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const track = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocus.current = event.target
    }
    el.addEventListener("focusin", track)
    return () => el.removeEventListener("focusin", track)
  }, [ref])

  const wasOnTop = useRef(onTop)
  useEffect(() => {
    if (onTop && !wasOnTop.current) {
      const target = lastFocus.current?.isConnected ? lastFocus.current : fallback ? ref.current?.querySelector<HTMLElement>(fallback) : null
      target?.focus({ preventScroll: true })
    }
    wasOnTop.current = onTop
  }, [ref, onTop, fallback])
}
