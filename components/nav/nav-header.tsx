"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

// The back button: chevron and the previous screen's title, like UINavigationBar. When that title
// doesn't fit next to this screen's title it says "Zurück", and where even that doesn't fit only
// the chevron remains (VoiceOver still hears "Zurück zu …"). Nothing is cut off.
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useT()
  const cellRef = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLSpanElement>(null)
  const shortRef = useRef<HTMLSpanElement>(null)
  const [mode, setMode] = useState<"full" | "short" | "icon">("full")

  useLayoutEffect(() => {
    const cell = cellRef.current
    if (!cell) return
    // 28 px chevron, 2 px gap, 12 px trailing padding.
    const check = () => {
      const room = cell.clientWidth - 42
      setMode((fullRef.current?.offsetWidth ?? 0) <= room ? "full" : (shortRef.current?.offsetWidth ?? 0) <= room ? "short" : "icon")
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(cell)
    return () => observer.disconnect()
  }, [label, t.common.back])

  return (
    <div ref={cellRef} className="relative col-start-1 row-start-1 flex min-w-0 justify-start">
      <span ref={fullRef} aria-hidden="true" className="invisible absolute whitespace-nowrap text-[1.0625rem]">
        {label}
      </span>
      <span ref={shortRef} aria-hidden="true" className="invisible absolute whitespace-nowrap text-[1.0625rem]">
        {t.common.back}
      </span>
      <button
        type="button"
        onClick={onClick}
        aria-label={t.shell.backTo(label)}
        className="-ml-1 flex min-h-11 min-w-11 items-center gap-0.5 whitespace-nowrap rounded-lg pr-3 text-[1.0625rem] text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-60"
      >
        <ChevronLeft className="h-7 w-7 shrink-0" aria-hidden="true" />
        {mode === "full" ? label : mode === "short" ? t.common.back : null}
      </button>
    </div>
  )
}

// The navigation bar of a screen inside a tab (HIG: navigation bars). It sits at the top of the
// screen's own scroll area: see-through while the large title is visible, a blurred bar with the
// title in the middle once the content scrolls under it.
export function NavHeader({
  title,
  backLabel,
  onBack,
  trailing,
  showTitle,
  solid,
  overlay,
}: {
  title: string
  // The previous screen's title; no back button on a tab's root.
  backLabel?: string
  onBack?: () => void
  // Buttons on the right, e.g. "Fertig". Icon-only buttons need an aria-label.
  trailing?: ReactNode
  showTitle: boolean
  solid: boolean
  // Root screens: the bar floats over the top of the content, so their large title sits where the
  // other tabs have theirs.
  overlay?: boolean
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)] transition-[background-color,border-color] duration-200",
        solid ? "border-border/60 bg-background/80 backdrop-blur-xl" : "border-transparent",
        overlay && "-mb-[calc(2.75rem+env(safe-area-inset-top)+1px)]",
      )}
    >
      <div className="mx-auto grid h-11 max-w-2xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 pl-[max(env(safe-area-inset-left),0.5rem)] pr-[max(env(safe-area-inset-right),0.5rem)]">
        {onBack && backLabel ? <BackButton label={backLabel} onClick={onBack} /> : <div className="col-start-1 row-start-1" />}
        {/* While the large title is on screen, the bar's title takes no room, so the back button
            can show the previous title in full. */}
        <div
          aria-hidden={!showTitle}
          className={cn(
            "col-start-2 row-start-1 w-max max-w-[min(56vw,22rem)] text-center text-[1.0625rem] font-semibold transition-opacity duration-200",
            showTitle ? "opacity-100" : "pointer-events-none absolute opacity-0",
          )}
        >
          <FitText minScale={0.75} className="leading-tight">
            {title}
          </FitText>
        </div>
        <div className="col-start-3 row-start-1 flex min-w-0 items-center justify-end gap-1">{trailing}</div>
      </div>
    </header>
  )
}
