import type { GameType } from "../game/types.ts"
import type { ArchivedMatch } from "../storage/archive.ts"
import { addDays, addMonths, daysBetween, startOfDay, startOfMonth, startOfWeek } from "../calendar.ts"
import { gamePoints, headline, summarizePlayer, type GamePoint, type PlayerSummary, type StatsOptions } from "../storage/stats.ts"
import { bestsOf, type Bests } from "./bests.ts"

// Training: the games someone played alone. They are kept apart from every figure against
// others, and this is where they add up, so that practice shows as growth over time: a mean per
// week or month, the month against the one before, the days in a row, the bests in training.

export type Grain = "week" | "month"

// A week's or month's mean needs this many trainings; fewer show as "too few", never as a mean
// of one game.
export const TRAINING_MIN = 3

export interface TrainingBucket {
  // Local start of the week or month (ms), and the start of the next one.
  start: number
  end: number
  games: number
  // Pooled headline figure of the bucket's games; null under TRAINING_MIN games or without data.
  value: number | null
}

export interface TrainingMonth {
  start: number
  games: number
  // Days with at least one training this month.
  days: number
  value: number | null
  summary: PlayerSummary | null
}

export interface Training {
  type: GameType
  // Every training of the type, newest first.
  points: GamePoint[]
  // This month and the month before, as the card compares them.
  month: TrainingMonth
  previous: TrainingMonth
  // Days in a row with a training, ending today or yesterday.
  streak: number
  bests: Bests
}

type Options = Pick<StatsOptions, "aliases" | "sameAs"> & { type: GameType; now?: number }

const pooled = (matches: ArchivedMatch[], key: string, options: Options) =>
  matches.length > 0 ? summarizePlayer(matches, key, { aliases: options.aliases, sameAs: options.sameAs, type: options.type, scope: "training" }) : null

const finished = (p: GamePoint) => Date.parse(p.match.finishedAt) || 0

function monthOf(points: GamePoint[], start: number, key: string, options: Options): TrainingMonth {
  const end = addMonths(start, 1)
  const mine = points.filter((p) => finished(p) >= start && finished(p) < end)
  const summary = pooled(
    mine.map((p) => p.match),
    key,
    options,
  )
  return {
    start,
    games: mine.length,
    days: new Set(mine.map((p) => startOfDay(finished(p)))).size,
    value: mine.length >= TRAINING_MIN ? headline(summary, options.type) : null,
    summary,
  }
}

function streakOf(points: GamePoint[], now: number) {
  const days = [...new Set(points.map((p) => startOfDay(finished(p))))].sort((a, b) => b - a)
  if (days.length === 0) return 0
  const today = startOfDay(now)
  if (daysBetween(days[0], today) > 1) return 0
  let streak = 1
  for (let i = 1; i < days.length && daysBetween(days[i], days[i - 1]) === 1; i++) streak++
  return streak
}

export function trainingOf(matches: readonly ArchivedMatch[], key: string, options: Options): Training {
  const now = options.now ?? Date.now()
  const points = gamePoints(matches, key, { aliases: options.aliases, sameAs: options.sameAs, type: options.type, scope: "training" })
  const thisMonth = startOfMonth(now)
  return {
    type: options.type,
    points,
    month: monthOf(points, thisMonth, key, options),
    previous: monthOf(points, addMonths(thisMonth, -1), key, options),
    streak: streakOf(points, now),
    bests: bestsOf(points),
  }
}

// The trainings of a span, pooled per week or month, every bucket of the span present so that
// a chart shows the gaps. Weeks run Monday to Sunday.
export function trainingBuckets(points: GamePoint[], key: string, options: Options, grain: Grain, from: number, to: number): TrainingBucket[] {
  const startOf = grain === "week" ? startOfWeek : startOfMonth
  const next = (ms: number) => (grain === "week" ? addDays(ms, 7) : addMonths(ms, 1))
  const buckets: TrainingBucket[] = []
  for (let start = startOf(from); start < to; start = next(start)) {
    const end = next(start)
    const mine = points.filter((p) => finished(p) >= start && finished(p) < end)
    const value =
      mine.length >= TRAINING_MIN ?
        headline(
          pooled(
            mine.map((p) => p.match),
            key,
            options,
          ),
          options.type,
        )
      : null
    buckets.push({ start, end, games: mine.length, value })
  }
  return buckets
}
