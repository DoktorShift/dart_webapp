import type { ReactNode } from "react"
import { CircleAlert, CircleCheck, Info } from "lucide-react"
import { cn } from "@/lib/utils"

// A confirmation or problem shown in place, right where it happened, instead of a toast: an icon
// and a sentence, never colour alone. VoiceOver reads it when it appears ("status" waits for a
// pause, "alert" interrupts, for problems that block the next step).
//
//   <InlineStatus tone="success">Dein Spiel ist gespeichert.</InlineStatus>
//   <InlineStatus tone="error">Das ist kein BlueLine-Link.</InlineStatus>
const TONES = {
  success: { icon: CircleCheck, className: "bg-success/10 text-success", role: "status" },
  info: { icon: Info, className: "bg-secondary/70 text-foreground", role: "status" },
  error: { icon: CircleAlert, className: "bg-danger/10 text-danger", role: "alert" },
} as const

export function InlineStatus({ tone = "info", children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  const { icon: Icon, className: toneClass, role } = TONES[tone]
  return (
    <p role={role} className={cn("flex items-start gap-2 rounded-xl px-3 py-2.5 text-[0.9375rem] leading-snug", toneClass, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  )
}
