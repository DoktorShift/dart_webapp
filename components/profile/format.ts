import type { GameType } from "@/lib/game/types"
import { formatNumber, formatPercent, type Messages } from "@/lib/i18n"

// How the profile writes its figures: one decimal for averages, two for marks per round, a
// percentage for rates. Rounding happens here, nowhere in the libraries.

export const fixed = (t: Messages, value: number, digits = 1) => formatNumber(t, Math.round(value * 10 ** digits) / 10 ** digits)

// The headline figure of a game type (lib/storage/stats.ts headline), written out.
export function measure(t: Messages, type: GameType, value: number | null): string | null {
  if (value === null) return null
  if (type === "x01") return fixed(t, value)
  if (type === "cricket") return fixed(t, value, 2)
  return formatPercent(t, value)
}

// A difference between two such figures, always positive; the words say the direction.
export function measureDiff(t: Messages, type: GameType, diff: number): string {
  const d = Math.abs(diff)
  if (type === "x01") return fixed(t, d)
  if (type === "cricket") return fixed(t, d, 2)
  return formatPercent(t, d)
}

// "Oktober", "October".
export const monthName = (t: Messages, ms: number) => new Date(ms).toLocaleDateString(t.intl, { month: "long" })

// "14. Okt.", "Oct 14".
export const shortDate = (t: Messages, iso: string) => new Date(iso).toLocaleDateString(t.intl, { day: "numeric", month: "short" })

// "März 2025", "March 2025".
export const monthYear = (t: Messages, ms: number) => new Date(ms).toLocaleDateString(t.intl, { month: "long", year: "numeric" })
