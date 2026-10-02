"use client"

import { useEffect } from "react"

// Keeps the screen on while a game is open. The browser drops the lock whenever
// the page is hidden, so it is requested again when the page comes back.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false

    const request = async () => {
      try {
        lock = await navigator.wakeLock.request("screen")
        if (cancelled) void lock.release()
      } catch {
        // Denied (battery saver, unsupported context): the screen may dim as usual.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void request()
    }

    void request()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      void lock?.release()
    }
  }, [active])
}
