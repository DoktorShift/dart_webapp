"use client"

import { useCallback, useSyncExternalStore } from "react"

// Tailwind's screens from tailwind.config.js, for the few places where what is rendered, not
// only how it is styled, depends on the screen.
export const SPLIT = "(orientation: landscape) and (min-width: 560px)"
export const XSHORT = "(max-height: 500px)"

// Whether the media query matches; false on the server and until hydrated.
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
