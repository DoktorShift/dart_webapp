"use client"

import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Check, ChevronDown } from "lucide-react"
import { NAV_ICON_BUTTON } from "@/components/nav/nav-bar-items"
import { cn } from "@/lib/utils"

export interface MenuItem {
  id: string
  label: string
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  destructive?: boolean
  // A choice among a few (sort order, period): the chosen one carries a checkmark.
  checked?: boolean
  onSelect: () => void
}

// A pull-down menu (HIG: menus): a few related actions, the important ones first, a destructive
// one last and red. It opens from its button, closes on a choice, Escape, a tap outside, Tab or
// when the screen scrolls; keyboard focus moves through it with the arrows, Home and End
// (WAI-ARIA menu pattern). Two buttons open one: the icon button of a navigation bar (Menu) and
// the pill that names its current choice (ChipMenu), the way Files and Photos filter a list.
function usePullDown() {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    const items = () => Array.from(root?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])
    const first = items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0]
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
      const all = items()
      if (all.length === 0) return
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault()
        all[event.key === "Home" ? 0 : all.length - 1]?.focus()
        return
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
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

  return { id, rootRef, buttonRef, open, setOpen }
}

function PullDown({ id, label, open, align, items, onClose }: { id: string; label: string; open: boolean; align: "left" | "right"; items: readonly MenuItem[]; onClose: () => void }) {
  const reduceMotion = useReducedMotion()
  const choices = items.some((item) => item.checked !== undefined)
  return (
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
          style={{ transformOrigin: align === "right" ? "top right" : "top left" }}
          className={cn(
            "absolute top-full z-30 mt-1 min-w-[14rem] max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card/95 py-1 shadow-xl backdrop-blur-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => {
            const ItemIcon = item.icon
            const choice = item.checked !== undefined
            return (
              <button
                key={item.id}
                type="button"
                role={choice ? "menuitemradio" : "menuitem"}
                aria-checked={choice ? item.checked : undefined}
                tabIndex={-1}
                onClick={() => {
                  onClose()
                  item.onSelect()
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-[1.0625rem] transition-colors focus-visible:bg-secondary/60 focus-visible:outline-none active:bg-secondary/70",
                  index > 0 && "border-t border-border/70",
                  item.destructive ? "text-danger" : "text-foreground",
                )}
              >
                {choices && <Check className={cn("h-5 w-5 shrink-0 text-primary", !item.checked && "invisible")} aria-hidden />}
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.label}</span>
                {ItemIcon && <ItemIcon className="h-5 w-5 shrink-0 opacity-80" aria-hidden />}
              </button>
            )
          })}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// The menu behind an icon button in the navigation bar ("Mehr").
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
  const { id, rootRef, buttonRef, open, setOpen } = usePullDown()
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
      <PullDown id={id} label={label} open={open} align="right" items={items} onClose={() => setOpen(false)} />
    </div>
  )
}

export interface ChipMenuOption<T extends string> {
  value: T
  label: string
}

// A pill that names the current choice and opens the others (HIG: a pull-down button for a
// filter, so a list keeps one segmented control for its main views and the rest in menus).
// 44 pt tall; the words are the control, never colour alone.
export function ChipMenu<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  // What is being chosen ("Zeitraum"), for VoiceOver.
  label: string
  options: readonly ChipMenuOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const { id, rootRef, buttonRef, open, setOpen } = usePullDown()
  const current = options.find((o) => o.value === value)
  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label}: ${current?.label ?? ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-h-11 max-w-full items-center gap-1 rounded-full border border-border bg-card px-3.5 text-[0.9375rem] font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary/70",
          open && "bg-secondary/60",
        )}
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{current?.label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <PullDown
        id={id}
        label={label}
        open={open}
        align="left"
        items={options.map((o) => ({ id: o.value, label: o.label, checked: o.value === value, onSelect: () => onChange(o.value) }))}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}

// A row of chip menus under a segmented control, wrapping on narrow screens.
export function ChipMenus({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
}
