"use client"

import type { ReactNode } from "react"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

// One person in a list: face, name, a line under it, and on the right an action (a pill button)
// or nothing. The row itself opens the person when `onClick` is given; the action stays its own
// 44 pt target beside it.
export function PersonRow({ pubkey, name, picture, subtitle, action, onClick }: { pubkey: string; name: string; picture: string | null; subtitle?: ReactNode; action?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <Avatar seed={pubkey} name={name} src={picture} size={40} />
      <span className="block min-w-0 flex-1 text-left">
        <span className="block text-[1.0625rem] leading-snug wrap-anywhere">{name}</span>
        {subtitle && <span className="block text-[0.8125rem] leading-snug text-muted-foreground wrap-anywhere">{subtitle}</span>}
      </span>
    </>
  )
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-1.5">
      {onClick ? (
        <button type="button" onClick={onClick} className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:opacity-70")}>
          {body}
        </button>
      ) : (
        body
      )}
      {action && <span className="shrink-0">{action}</span>}
    </div>
  )
}
