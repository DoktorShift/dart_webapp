import type { GameType } from "../game/types.ts"
import { kvGet, kvSet } from "../storage/db.ts"

// A training goal (proposal 2026-10-26, M18): the monthly figure the player wants to reach in
// a game type, drawn as a line through the training chart. Set by the player, kept on this
// device only, never published or synced: it is a note to oneself.

export type TrainingGoals = Partial<Record<GameType, number>>

export const GOALS_KEY = "training-goals"

// What a goal may be: a 3-dart average, marks per round, a hit rate (entered in percent).
export const GOAL_RANGE: Record<GameType, { min: number; max: number }> = {
  x01: { min: 10, max: 180 },
  cricket: { min: 0.5, max: 9 },
  clock: { min: 0.01, max: 1 },
}

// One tap on − or +: a point of average, a quarter mark, five percent (Apple Fitness steps its
// goals the same way: coarse enough to be set in a few taps).
export const GOAL_STEP: Record<GameType, number> = { x01: 1, cricket: 0.25, clock: 0.05 }

const clampGoal = (type: GameType, value: number) => {
  const { min, max } = GOAL_RANGE[type]
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100
}

// A goal to start from when none is set: the month's figure rounded up to the next step, a
// little above where the player stands; without a figure, the type's usual goal.
export function suggestedGoal(type: GameType, current: number | null): number {
  if (current === null) return type === "x01" ? 60 : type === "cricket" ? 2.5 : 0.5
  const step = GOAL_STEP[type]
  const up = Math.ceil(current / step - 1e-9) * step
  return clampGoal(type, up - current < 1e-9 ? up + step : up)
}

// One step up or down from where the number stands, decimals kept, within the range.
export const stepGoal = (type: GameType, value: number, direction: 1 | -1) => clampGoal(type, value + direction * GOAL_STEP[type])

export async function readGoals(): Promise<TrainingGoals> {
  const goals = await kvGet<TrainingGoals>(GOALS_KEY).catch(() => undefined)
  return goals && typeof goals === "object" ? goals : {}
}

// Sets or removes (null) the goal of one type.
export async function saveGoal(type: GameType, value: number | null) {
  const goals = await readGoals()
  const next = { ...goals }
  if (value === null) delete next[type]
  else next[type] = value
  await kvSet(GOALS_KEY, next)
  return next
}

// What the player typed, as a goal: a comma or a dot for decimals, a hit rate in percent. Null
// when it isn't a number in the type's range.
export function parseGoal(type: GameType, text: string): number | null {
  const n = Number(text.trim().replace(",", "."))
  if (!Number.isFinite(n)) return null
  const value = type === "clock" ? n / 100 : n
  const { min, max } = GOAL_RANGE[type]
  return value >= min && value <= max ? Math.round(value * 100) / 100 : null
}

// The goal back as the text to edit: one decimal for an average, two for marks, whole percent.
export function goalText(type: GameType, value: number, locale = "en"): string {
  const digits = type === "clock" ? 0 : type === "cricket" ? 2 : 1
  const shown = type === "clock" ? value * 100 : value
  return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: digits }).format(shown)
}

// How many of the periods with a figure reached the goal.
export const reachedCount = (values: readonly (number | null)[], goal: number) => values.filter((v): v is number => v !== null && v >= goal).length
