import { cn } from "@/lib/utils"

export interface PhaseStep {
  id: string
  label: string
  state: "done" | "now" | "next"
}

// The current phase remains legible on a narrow phone, with progress conveyed in text too.
export function PhaseSteps({ steps, label, progress, className }: { steps: readonly PhaseStep[]; label: string; progress: (current: number, total: number) => string; className?: string }) {
  const current = steps.findIndex((step) => step.state === "now")
  if (current < 0) return null
  return (
    <div aria-label={label} className={cn(className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.9375rem] font-semibold">{steps[current].label}</span>
        <span className="text-[0.8125rem] text-muted-foreground">{progress(current + 1, steps.length)}</span>
      </div>
      <div aria-hidden="true" className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
      </div>
    </div>
  )
}
