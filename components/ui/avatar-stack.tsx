"use client"

import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export interface StackPerson {
  seed: string
  name?: string | null
  src?: string | null
}

// The people of a club or a tournament as overlapping faces, then "+8": people instead of a
// number. With `onClick` the stack is a button named by `label` ("12 Spieler"), which also
// stands beside the faces.
export function AvatarStack({
  people,
  label,
  max = 4,
  size = 26,
  onClick,
  className,
}: {
  people: readonly StackPerson[]
  // What the stack means, written beside it and read by VoiceOver.
  label: string
  max?: number
  size?: number
  onClick?: () => void
  className?: string
}) {
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  const faces = (
    <>
      <span className="flex items-center" aria-hidden>
        {shown.map((p, i) => (
          <Avatar key={`${p.seed}-${i}`} seed={p.seed} name={p.name ?? undefined} src={p.src} size={size} className={cn("ring-2 ring-card", i > 0 && "-ml-2")} />
        ))}
        {more > 0 && (
          <span
            style={{ width: size, height: size }}
            className={cn("flex shrink-0 items-center justify-center rounded-full bg-secondary text-[0.6875rem] font-semibold text-muted-foreground ring-2 ring-card", shown.length > 0 && "-ml-2")}
          >
            +{more}
          </span>
        )}
      </span>
      <span className="min-w-0 text-[0.8125rem] font-medium text-muted-foreground wrap-anywhere">{label}</span>
    </>
  )
  if (!onClick) return <span className={cn("inline-flex items-center gap-2", className)}>{faces}</span>
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full pr-2 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:opacity-70", className)}>
      {faces}
    </button>
  )
}
