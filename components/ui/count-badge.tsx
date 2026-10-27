import { cn } from "@/lib/utils"

// The red count on a tab bar symbol (HIG badges): what waits for the person there. `label` is
// what VoiceOver reads for it ("1 Anfrage"; the number alone says too little), under `id`, which
// the control names as its description (aria-describedby reaches a hidden element): the control
// keeps its own name, and the words come after it.
export function CountBadge({ count, label, id, className }: { count: number; label: string; id: string; className?: string }) {
  if (count <= 0) return null
  return (
    <span aria-hidden="true" className={cn("absolute -right-2 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[0.6875rem] font-semibold leading-none text-white ring-2 ring-background", className)}>
      {count > 99 ? "99+" : count}
      <span id={id} className="sr-only">
        {label}
      </span>
    </span>
  )
}
