// Local calendar arithmetic for periods people name ("today", "this month", "this year"). Days
// start at local midnight; weeks start on Monday, as calendars here do. Everything takes and
// returns milliseconds, so screens format and the library stays free of the clock.

const DAY = 86_400_000

export const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

export const startOfWeek = (ms: number) => {
  const day = startOfDay(ms)
  const weekday = (new Date(day).getDay() + 6) % 7
  return addDays(day, -weekday)
}

export const startOfMonth = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export const startOfYear = (ms: number) => new Date(new Date(ms).getFullYear(), 0, 1).getTime()

export const addDays = (ms: number, days: number) => {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export const addMonths = (ms: number, months: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime()
}

export const daysBetween = (a: number, b: number) => Math.round((startOfDay(b) - startOfDay(a)) / DAY)

// The periods the Rangliste offers. "all" has no bounds.
export type Period = "today" | "days30" | "year" | "all"

export function periodBounds(period: Period, now = Date.now()): { from?: string; to?: string } {
  switch (period) {
    case "today":
      return { from: new Date(startOfDay(now)).toISOString() }
    case "days30":
      return { from: new Date(now - 30 * DAY).toISOString() }
    case "year":
      return { from: new Date(startOfYear(now)).toISOString() }
    default:
      return {}
  }
}
