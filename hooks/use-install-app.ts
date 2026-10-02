"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

// Chromium's install prompt event; not in the DOM typings.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export type InstallState =
  | { kind: "installed" }
  // Android and desktop Chrome/Edge: the app can open the system install dialog.
  | { kind: "prompt"; install: () => Promise<void> }
  // iPhone and iPad: installing goes through Safari's Share menu.
  | { kind: "ios" }
  // Other browsers: their own menu, if they support it at all.
  | { kind: "manual" }

// The browser fires its install event once, early, often before the Settings tab is open,
// so it is caught here when the app loads and kept until it is used.
let deferred: BeforeInstallPromptEvent | null = null
let installedNow = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    installedNow = true
    deferred = null
    notify()
  })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function install() {
  if (!deferred) return
  const event = deferred
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === "accepted") installedNow = true
  deferred = null
  notify()
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

// iPadOS reports itself as a Mac; touch support tells them apart.
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)

// Null until mounted, because the answer depends on the device and browser.
export function useInstallApp(): InstallState | null {
  const canPrompt = useSyncExternalStore(subscribe, () => deferred !== null, () => false)
  const justInstalled = useSyncExternalStore(subscribe, () => installedNow, () => false)
  const [device, setDevice] = useState<{ standalone: boolean; ios: boolean } | null>(null)

  useEffect(() => setDevice({ standalone: isStandalone(), ios: isIOS() }), [])

  if (!device) return null
  if (device.standalone || justInstalled) return { kind: "installed" }
  if (canPrompt) return { kind: "prompt", install }
  return device.ios ? { kind: "ios" } : { kind: "manual" }
}
