"use client"

import { useEffect, useRef, useState } from "react"

// Browser back (Android's back gesture, the back button on desktop) works like the back button in
// the navigation bar. The app keeps one history entry per screen above the start page: entry N is
// marked with depth N in history.state. The visible depth is the source of truth; history
// follows it:
//
// - the app pushes a screen → one entry is added
// - the app goes back (back button, tab switch, game start) → the extra entries are stepped back
// - the browser goes back → the app pops as many screens as entries were left
//
// The URL never changes, so no route is involved. Next.js keeps its own data in history.state
// (`__NA` and its router tree); on popstate it reloads the page for entries without `__NA`. Its
// patched pushState/replaceState would copy that data, but this hook may run before the patch is
// installed (child effects run first), so every entry copies Next's fields itself and keeps the
// marker.

const KEY = "blueline"
const NEXT_TREE = "__PRIVATE_NEXTJS_INTERNALS_TREE"

type HistoryData = Record<string, unknown> & { __NA?: boolean }

function historyDepth(state: unknown): number {
  const mark = (state as Record<string, { depth?: unknown }> | null)?.[KEY]
  const depth = mark?.depth
  return typeof depth === "number" && Number.isInteger(depth) && depth >= 0 ? depth : 0
}

const isMarked = (state: unknown) => typeof (state as Record<string, unknown> | null)?.[KEY] === "object"

function write(kind: "push" | "replace", depth: number, url?: string) {
  const current = window.history.state as HistoryData | null
  const data: HistoryData = { __NA: true, [KEY]: { depth } }
  if (current && NEXT_TREE in current) data[NEXT_TREE] = current[NEXT_TREE]
  if (kind === "push") window.history.pushState(data, "", url)
  else window.history.replaceState(data, "", url)
}

// Changes the address of the current entry (for example to drop an invitation's fragment) and
// keeps its place in the app's history.
export function replaceUrl(url: string) {
  write("replace", historyDepth(window.history.state), url)
}

export function useHistorySync({
  depth,
  onBack,
  onNewEntry,
}: {
  // How many screens are above the start: pushed screens of the open tab, plus 1 for game setup.
  depth: number
  // The browser went back `count` entries.
  onBack: (count: number) => void
  // The browser added an entry itself, e.g. the address bar got a new fragment (#club=…).
  onNewEntry: () => void
}) {
  // Our depth of the entry the browser shows; null until mounted.
  const at = useRef<number | null>(null)
  // Target depth of a history.go() the app started itself.
  const pending = useRef<number | null>(null)
  const callbacks = useRef({ onBack, onNewEntry })
  const fallback = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    callbacks.current = { onBack, onNewEntry }
  })

  useEffect(() => {
    if (!isMarked(window.history.state)) write("replace", 0)
    // After a reload the browser may still be on a deeper entry; the sync below steps back,
    // because the app always starts at its roots.
    at.current = historyDepth(window.history.state)

    const onPop = (event: PopStateEvent) => {
      const before = at.current ?? 0
      if (!isMarked(event.state)) {
        // A new entry the browser made (fragment navigation): count it as one level deeper.
        at.current = before + 1
        write("replace", before + 1)
        callbacks.current.onNewEntry()
      } else {
        const now = historyDepth(event.state)
        at.current = now
        const ours = pending.current !== null && now === pending.current
        pending.current = null
        clearTimeout(fallback.current)
        if (!ours && now < before) callbacks.current.onBack(before - now)
      }
      setTick((n) => n + 1)
    }
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("popstate", onPop)
      clearTimeout(fallback.current)
    }
  }, [])

  useEffect(() => {
    const current = at.current
    if (current === null || pending.current !== null) return
    if (depth > current) {
      for (let d = current + 1; d <= depth; d++) write("push", d)
      at.current = depth
    } else if (depth < current) {
      pending.current = depth
      window.history.go(depth - current)
      // If the browser can't go back that far (its entries were cleared), take the current entry
      // as this depth instead of trying again and again, then catch up with any change since.
      // Kept outside the effect's cleanup: a re-render while waiting must not cancel it.
      clearTimeout(fallback.current)
      fallback.current = setTimeout(() => {
        if (pending.current !== depth) return
        pending.current = null
        write("replace", depth)
        at.current = depth
        setTick((n) => n + 1)
      }, 1500)
    }
  }, [depth, tick])
}
