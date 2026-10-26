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

// A chart of bars drawn in CSS, one per game or per week or month, in the style Apple's Health
// and Fitness use: no axes, the best bar carries its value, first and last label below with the
// range between them. The scale starts a little under the lowest value, never so high that
// small differences look large (HIG: charting data). Colour never carries the meaning alone:
// VoiceOver gets a one-sentence summary plus the table.
export function Bars({ bars, summary, range, legend, height = 88, className }: { bars: readonly Bar[]; summary: string; range?: string; legend?: string; height?: number; className?: string }) {
  const id = useId()
  const values = bars.map((b) => b.value).filter((v): v is number => v !== null)
  const lo = values.length > 0 ? Math.min(...values) : 0
  const hi = values.length > 0 ? Math.max(...values) : 1
  const span = hi - lo
  const base = Math.max(0, Math.min(lo * 0.8, lo - span))
  const scale = hi > base ? hi - base : 1
  const heightOf = (v: number) => 12 + 88 * ((v - base) / scale)
  const first = bars[0]?.label
  const last = bars.length > 1 ? bars[bars.length - 1]?.label : undefined
  const bestAt = bars.findIndex((b) => b.tone === "best")
  return (
    <figure className={cn("min-w-0", className)}>
      <div role="img" aria-label={summary} aria-describedby={id} className="flex items-end gap-[3px] pt-5" style={{ height: height + 20 }}>
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
              <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[0.75rem] font-semibold tabular-nums text-[#c25e00] dark:text-[#ff9500]" style={{ bottom: `calc(${heightOf(bar.value ?? hi)}% + 2px)` }}>
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
        </tbody>
      </table>
    </figure>
  )
}
