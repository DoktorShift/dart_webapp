"use client"

import { createElement, lazy, type ComponentType } from "react"

export type LazyScreen<P extends object> = ComponentType<P> & {
  // Fetches the code without showing it, so it is cached for offline use.
  preload: () => Promise<unknown>
  // After a failed load (offline): the next render tries again instead of repeating the error.
  reset: () => void
}

// A screen whose code loads when it is first opened, keeping it out of the start page. Unlike a
// bare React.lazy it can retry after a failed download (see LoadBoundary in stack-view.tsx).
export function lazyScreen<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): LazyScreen<P> {
  let Lazy = lazy(load)
  const Screen = ((props: P) => createElement(Lazy, props)) as LazyScreen<P>
  Screen.preload = () => load()
  Screen.reset = () => {
    Lazy = lazy(load)
  }
  return Screen
}
