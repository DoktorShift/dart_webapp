"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  DEFAULT_LOCALE,
  MESSAGES,
  deviceLocale,
  loadLocalePreference,
  saveLocalePreference,
  type Locale,
  type LocalePreference,
  type Messages,
} from "@/lib/i18n"

interface I18n {
  locale: Locale
  preference: LocalePreference
  t: Messages
  setPreference: (preference: LocalePreference) => void
}

const I18nContext = createContext<I18n | null>(null)

// The language for every screen. Pages render in German first (the standard, and what search
// engines read). Once the app has loaded it follows the device's language, or the one picked
// in Settings.
export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>("system")
  const [device, setDevice] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    setPreferenceState(loadLocalePreference())
    const update = () => setDevice(deviceLocale())
    update()
    window.addEventListener("languagechange", update)
    return () => window.removeEventListener("languagechange", update)
  }, [])

  const locale = preference === "system" ? device : preference

  useEffect(() => {
    document.documentElement.lang = MESSAGES[locale].lang
  }, [locale])

  const setPreference = useCallback((next: LocalePreference) => {
    setPreferenceState(next)
    saveLocalePreference(next)
  }, [])

  const value = useMemo(() => ({ locale, preference, t: MESSAGES[locale], setPreference }), [locale, preference, setPreference])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const context = useContext(I18nContext)
  if (!context) throw new Error("useI18n needs an I18nProvider above it")
  return context
}

// The texts of the current language: `const t = useT()`, then `t.setup.start`.
export const useT = () => useI18n().t
