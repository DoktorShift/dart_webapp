"use client"

import { createContext, useContext, type ComponentType, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

// Buttons a screen puts into its navigation bar (HIG: toolbars; the trailing side holds the
// screen's actions, at most one of them prominent). The ScreenFrame owns the bar and offers the
// slot; the screen renders <NavBarItems> anywhere in its tree, and its buttons appear in the bar
// with the screen's own state and handlers. Nothing shows until the frame has mounted the slot.

export const NavBarSlot = createContext<HTMLElement | null>(null)

export function NavBarItems({ children }: { children: ReactNode }) {
  const slot = useContext(NavBarSlot)
  return slot ? createPortal(children, slot) : null
}

// The look of a 44 pt icon button in the bar, shared with the Menu's button (components/ui/menu.tsx).
// A glass circle, as iOS 26 draws toolbar items: 44 pt, the symbol on a translucent disc.
export const NAV_ICON_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/75 text-primary shadow-sm backdrop-blur-xl transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary"

// A 44 pt icon button for the bar: the symbol alone, named for VoiceOver.
export function NavIconButton({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(NAV_ICON_BUTTON, className)}
    >
      <Icon className="h-6 w-6" strokeWidth={1.9} aria-hidden />
    </button>
  )
}

// The one prominent action of a bar ("Leiten"): a filled pill. The target is the bar's full
// 44 pt; the pill itself is drawn a little smaller, as iOS draws it.
export function NavProminentButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex h-11 shrink-0 items-center focus-visible:outline-none">
      <span className="flex h-9 items-center rounded-full bg-primary px-4 text-[0.9375rem] font-semibold text-primary-foreground shadow-sm transition-[filter] group-focus-visible:ring-2 group-focus-visible:ring-ring group-active:brightness-95">
        {label}
      </span>
    </button>
  )
}
