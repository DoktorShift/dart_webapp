"use client"

import { useCallback, useSyncExternalStore } from "react"

// Whether a CSS media query matches right now, following changes (a phone turned, a window
// resized). False on the server and until hydration, so the first render matches the markup.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
