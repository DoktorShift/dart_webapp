"use client"

import { createContext, useContext } from "react"
import type { ShellNavigator } from "@/lib/shell/registry"

const NavContext = createContext<ShellNavigator | null>(null)

export const NavProvider = NavContext.Provider

// The app's navigation for any screen inside the tabs: push, pop, switch tabs, open game setup.
export function useNav(): ShellNavigator {
  const nav = useContext(NavContext)
  if (!nav) throw new Error("useNav needs the app shell above it")
  return nav
}
