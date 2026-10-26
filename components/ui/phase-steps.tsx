import { cn } from "@/lib/utils"

export interface PhaseStep {
  id: string
  label: string
  state: "done" | "now" | "next"
}

// Where a thing with a fixed course stands (a tournament: Anmeldung, Check-in, Auslosung, Läuft,
// Fertig): every step named, the current one emphasised, the past ones filled. Read as a list
// with the current step marked.
export function PhaseSteps({ steps, label, className }: { steps: readonly PhaseStep[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("grid auto-cols-fr grid-flow-col gap-1", className)}>
      {steps.map((step) => (
        <li
          key={step.id}
          aria-current={step.state === "now" ? "step" : undefined}
          className={cn(
            "border-t-[3px] pt-1.5 text-center text-[0.6875rem] leading-tight [overflow-wrap:anywhere]",
            step.state === "next" && "border-secondary text-muted-foreground",
            step.state === "done" && "border-primary/60 text-primary",
            step.state === "now" && "border-primary font-semibold text-foreground",
          )}
        >
          {step.label}
        </li>
      ))}
    </ol>
  )
}
