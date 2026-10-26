import type { ComponentType } from "react"
import { cn } from "@/lib/utils"

export interface Action {
  id: string
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>
  label: string
  onClick: () => void
  disabled?: boolean
}

// The row of quick actions under a head (Contacts, Maps, Music): up to four tiles of equal
// width, a symbol over one word, each at least 44 pt tall. Nouns, not sentences.
export function ActionRow({ actions, className }: { actions: readonly Action[]; className?: string }) {
  if (actions.length === 0) return null
  return (
    <div className={cn("grid auto-cols-fr grid-flow-col gap-2", className)}>
      {actions.map(({ id, icon: Icon, label, onClick, disabled }) => (
        <button
          key={id}
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card px-1 py-2 text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary/70 disabled:opacity-50"
        >
          <Icon className="h-6 w-6" strokeWidth={1.9} aria-hidden />
          <span className="max-w-full text-[0.75rem] font-semibold leading-tight [overflow-wrap:anywhere]">{label}</span>
        </button>
      ))}
    </div>
  )
}
