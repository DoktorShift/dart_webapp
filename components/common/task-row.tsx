import { ChevronRight, ListTodo } from "lucide-react"
import { cn } from "@/lib/utils"

// The one thing a club or a tournament wants from this person next, as a tinted row above the
// content: a task symbol, the sentence, a chevron. Tapping it goes straight to the task.
export function TaskRow({ label, onClick, disabled, className }: { label: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-2xl bg-primary/10 px-4 py-3 text-left text-[1.0625rem] font-semibold text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/20 disabled:opacity-60",
        className,
      )}
    >
      <ListTodo className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
      <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
    </button>
  )
}
