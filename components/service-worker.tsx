"use client"

import { useEffect } from "react"
import { isNativeApp } from "@/lib/platform"

// Registers /sw.js in production builds so the installed app works offline.
// Development is left alone so hot reloading never serves cached files.
// The installed app also asks for persistent storage, so the browser doesn't clear saved games
// and the leaderboard to free space. Browsers decide this silently for installed apps. The iOS
// app asks too, but registers no worker: its files are inside the app already.
export function ServiceWorker() {
  useEffect(() => {
    if (isNativeApp() || window.matchMedia("(display-mode: standalone)").matches) {
      navigator.storage?.persist?.().catch(() => {})
    }
    if (isNativeApp()) return
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Not fatal: the app still works online.
    })
  }, [])
  return null
}
