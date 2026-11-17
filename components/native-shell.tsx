"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import { isNativeApp } from "@/lib/platform"

// The iOS app's status bar follows the app's appearance: light text on the dark theme, dark text
// on the light one (the website gets this from apple-mobile-web-app-status-bar-style). Renders
// nothing; on the website it does nothing at all.
export function NativeShell() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (!isNativeApp() || !resolvedTheme) return
    void import("@capacitor/status-bar")
      // Capacitor names the style after the background: Dark means light text.
      .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: resolvedTheme === "light" ? Style.Light : Style.Dark }))
      .catch(() => {})
  }, [resolvedTheme])
  return null
}
