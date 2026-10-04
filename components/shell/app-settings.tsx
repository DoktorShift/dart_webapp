"use client"

import { createContext, useContext } from "react"
import type { AppSettings } from "@/lib/game/storage"

interface AppSettingsValue {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
}

const AppSettingsContext = createContext<AppSettingsValue | null>(null)

// The game settings owned by app/page.tsx, for screens pushed inside the tabs (Settings).
export const AppSettingsProvider = AppSettingsContext.Provider

export function useAppSettings(): AppSettingsValue {
  const value = useContext(AppSettingsContext)
  if (!value) throw new Error("useAppSettings needs the app shell above it")
  return value
}
