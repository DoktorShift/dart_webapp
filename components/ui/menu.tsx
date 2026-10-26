"use client"

import { useEffect, useId, useRef, useState, type ComponentType } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { NAV_ICON_BUTTON } from "@/components/nav/nav-bar-items"
import { cn } from "@/lib/utils"

export interface MenuItem {
  id: string
  label: string
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  destructive?: boolean
  onSelect: () => void
}

// A pull-down menu from an icon button (HIG: menus): a few related actions, the important ones
// first, a destructive one last and red. It opens from its button, closes on a choice, Escape,
// a tap outside, Tab or when the screen scrolls; keyboard focus moves through it with the arrows,
// Home and End (WAI-ARIA menu pattern).
export function Menu({
  icon: Icon,
  label,
  items,
  className,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>
  // The button's accessible name ("Mehr", "Hinzufügen").
  label: string
  items: readonly MenuItem[]
  className?: string
}) {
  const id = useId()
  const reduceMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    const first = root?.querySelector<HTMLElement>("[role=menuitem]")
    first?.focus()
    const onPointer = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        setOpen(false)
        if (event.key === "Escape") buttonRef.current?.focus()
        return
      }
      if (event.key === "Home" || event.key === "End") {
        const all = Array.from(root?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])
        event.preventDefault()
        all[event.key === "Home" ? 0 : all.length - 1]?.focus()
        return
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      const all = Array.from(root?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])
      if (all.length === 0) return
      event.preventDefault()
      const at = all.indexOf(document.activeElement as HTMLElement)
      const next = event.key === "ArrowDown" ? (at + 1) % all.length : (at - 1 + all.length) % all.length
      all[next].focus()
    }
    const close = () => setOpen(false)
    document.addEventListener("pointerdown", onPointer, true)
    document.addEventListener("keydown", onKey)
    document.addEventListener("scroll", close, true)
    return () => {
      document.removeEventListener("pointerdown", onPointer, true)
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("scroll", close, true)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(NAV_ICON_BUTTON, open && "bg-primary/10")}
      >
        <Icon className="h-6 w-6" strokeWidth={1.9} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="menu"
            aria-label={label}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -2 }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-30 mt-1 min-w-[14rem] max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card/95 py-1 shadow-xl backdrop-blur-xl"
          >
            {items.map((item, index) => {
              const ItemIcon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-4 px-4 py-2 text-left text-[1.0625rem] transition-colors focus-visible:bg-secondary/60 focus-visible:outline-none active:bg-secondary/70",
                    index > 0 && "border-t border-border/70",
                    item.destructive ? "text-danger" : "text-foreground",
                  )}
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span>
                  {ItemIcon && <ItemIcon className="h-5 w-5 shrink-0 opacity-80" aria-hidden />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
