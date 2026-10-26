"use client"

import { useId } from "react"
import { cn } from "@/lib/utils"

export interface Bar {
  // null: no figure (a game without data, a month without enough trainings, a month to come).
  value: number | null
  label: string
  // What the bar says besides its height: the best one is orange, the rest blue; "faint" for
  // the weakest, "tooFew" for a slot with games but no figure, "empty" for one without games.
  tone?: "best" | "normal" | "faint" | "tooFew" | "empty"
  // The figure as written, for the value above the best bar and the hidden table.
  text?: string
}

export interface Goal {
  value: number
  // "Ziel 60": written at the line's end and read in the table.
  label: string
  // The goal as the figure is written ("60,0", "50 %"), for the table.
  text: string
}

// A chart of bars drawn in CSS, one per game or per week or month, in the style Apple's Health
// and Fitness use: no axes, the best bar carries its value, first and last label below with the
// range between them. The scale starts a little under the lowest value, never so high that
// small differences look large (HIG: charting data), and always holds the goal line when there
// is one. Colour never carries the meaning alone: VoiceOver gets a one-sentence summary plus
// the table.
export function Bars({ bars, summary, range, legend, goal, height = 88, className }: { bars: readonly Bar[]; summary: string; range?: string; legend?: string; goal?: Goal; height?: number; className?: string }) {
  const id = useId()
  const values = bars.map((b) => b.value).filter((v): v is number => v !== null)
  const lo = Math.min(...(values.length > 0 ? values : [0]), goal?.value ?? Infinity)
  const hi = Math.max(...(values.length > 0 ? values : [1]), goal?.value ?? -Infinity)
  const span = hi - lo
  const base = Math.max(0, Math.min(lo * 0.8, lo - span))
  const scale = hi > base ? hi - base : 1
  const heightOf = (v: number) => 12 + 88 * ((v - base) / scale)
  const first = bars[0]?.label
  const last = bars.length > 1 ? bars[bars.length - 1]?.label : undefined
  const bestAt = bars.findIndex((b) => b.tone === "best")
  // The goal's label keeps clear of the best bar's value: at the other end of the line, and not
  // at all in a chart too low to hold it (the table still names the goal).
  const goalLabel = goal && height >= 60 ? (bestAt >= (bars.length * 2) / 3 ? "left-0" : "right-0") : null
  return (
    <figure className={cn("min-w-0", className)}>
      <div role="img" aria-label={summary} aria-describedby={id} className="relative flex items-end gap-[3px] pt-5" style={{ height: height + 20 }}>
        {goal && (
          // Under the bars, in a layer as tall as they are, so its height means the same as theirs.
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height }}>
            <span className="absolute inset-x-0 border-t-2 border-dashed border-muted-foreground/70" style={{ bottom: `${heightOf(goal.value)}%` }}>
              {goalLabel && <span className={cn("absolute bottom-0.5 whitespace-nowrap rounded bg-card/80 px-1 text-[0.6875rem] font-semibold tabular-nums text-muted-foreground", goalLabel)}>{goal.label}</span>}
            </span>
          </span>
        )}
        {bars.map((bar, i) => (
          <span key={i} className="relative flex h-full min-w-0 flex-1 items-end">
            {bar.value === null ? (
              <span className={cn("block w-full rounded-t-sm", bar.tone === "tooFew" ? "h-[12%] border border-dashed border-muted-foreground/50" : "h-[5%] bg-secondary")} />
            ) : (
              <span
                className={cn("block w-full rounded-t-sm transition-[height]", bar.tone === "best" ? "bg-[#ff9500]" : bar.tone === "faint" ? "bg-primary/40" : "bg-primary")}
                style={{ height: `${heightOf(bar.value)}%` }}
              />
            )}
            {i === bestAt && bar.text && (
              <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-card/80 px-0.5 text-[0.75rem] font-semibold tabular-nums text-[#c25e00] dark:text-[#ff9500]" style={{ bottom: `calc(${heightOf(bar.value ?? hi)}% + 2px)` }}>
                {bar.text}
              </span>
            )}
          </span>
        ))}
      </div>
      {(first || last || range) && (
        <figcaption className="mt-1 flex justify-between gap-2 text-[0.75rem] tabular-nums text-muted-foreground">
          <span>{first}</span>
          {range && <span className="min-w-0 text-center">{range}</span>}
          <span>{last}</span>
        </figcaption>
      )}
      {legend && <p className="mt-1 text-[0.75rem] leading-snug text-muted-foreground">{legend}</p>}
      <table id={id} className="sr-only">
        <tbody>
          {bars.map((bar, i) => (
            <tr key={i}>
              <th scope="row">{bar.label}</th>
              <td>{bar.text ?? (bar.value === null ? "—" : String(Math.round(bar.value * 100) / 100))}</td>
            </tr>
          ))}
          {goal && (
            <tr>
              <th scope="row">{goal.label}</th>
              <td>{goal.text}</td>
            </tr>
          )}
        </tbody>
      </table>
    </figure>
  )
}
