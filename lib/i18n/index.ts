import type { ModeId } from "@/types/game-modes"
// Explicit .ts paths: these modules also run directly in Node for the unit tests.
import { de } from "./de.ts"
import { en } from "./en.ts"

// The app's languages. German is the standard; the app follows the device's language when it
// can, and Settings can pick one.
// Every catalog has the German shape, so a missing text is a type error, not a blank label.

// The German catalog's shape with every text widened to `string`, so other languages can say
// anything as long as each entry exists and each function takes the same arguments.
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly (infer U)[]
      ? Widen<U>[]
      : T extends object
        ? { [K in keyof T]: Widen<T[K]> }
        : T

export type Messages = Widen<typeof de>
export type Locale = "de" | "en"
// The choice in Settings: a language, or "system" to follow the device (the default).
export type LocalePreference = Locale | "system"

export const DEFAULT_LOCALE: Locale = "de"
export const MESSAGES: Record<Locale, Messages> = { de, en }
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "de", label: "Deutsch" },
  { id: "en", label: "English" },
]

const LOCALE_KEY = "dart-scorer.language.v1"

const isLocale = (value: unknown): value is Locale => value === "de" || value === "en"

export function loadLocalePreference(): LocalePreference {
  try {
    const value = window.localStorage.getItem(LOCALE_KEY)
    return isLocale(value) ? value : "system"
  } catch {
    return "system"
  }
}

export function saveLocalePreference(preference: LocalePreference) {
  try {
    if (preference === "system") window.localStorage.removeItem(LOCALE_KEY)
    else window.localStorage.setItem(LOCALE_KEY, preference)
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

// The first of the device's languages the app speaks; German when it speaks none of them.
export function deviceLocale(): Locale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    const base = language?.toLowerCase().split("-")[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

// Numbers as each language writes them: 35,5 and 100 % in German, 35.5 and 100% in English.
// Values arrive rounded already; scores never get thousands separators.
export const formatNumber = (t: Messages, value: number) => value.toLocaleString(t.intl, { maximumFractionDigits: 2, useGrouping: false })

export const formatPercent = (t: Messages, ratio: number) => ratio.toLocaleString(t.intl, { style: "percent", maximumFractionDigits: 0 })

// The mode's name in the current language; saved games and results keep their stored name
// for modes this version doesn't know.
export function modeName(t: Messages, modeId: string, fallback: string) {
  return isModeId(modeId) ? t.modes[modeId].name : fallback
}

const isModeId = (id: string): id is ModeId => Object.hasOwn(de.modes, id)
