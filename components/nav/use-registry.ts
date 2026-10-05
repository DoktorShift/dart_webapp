"use client"

import { useSyncExternalStore } from "react"
import { registryVersion, subscribeRegistry } from "@/lib/shell/registry"

// Re-renders when an area registers a screen, action, link handler or slot after the first render
// (for example once its lazily loaded code has arrived).
export function useRegistryVersion() {
  return useSyncExternalStore(subscribeRegistry, registryVersion, registryVersion)
}
