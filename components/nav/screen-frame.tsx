"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useMediaQuery, XSHORT } from "@/components/common/use-media-query"
import { NavBarSlot } from "@/components/nav/nav-bar-items"
import { NavHeader } from "@/components/nav/nav-header"
import { cn } from "@/lib/utils"

// One screen inside a tab: its own scroll area with the navigation bar on top and, by default,
// a large title that moves into the bar as it scrolls away (HIG: large titles on root screens and
// where they help orientation). Content is centred at reading width on iPad and desktop. Besides
// `trailing` (the frame's own buttons), the screen inside may put buttons into the bar with
// <NavBarItems> (nav-bar-items.tsx): they land in the slot after `trailing`.
export function ScreenFrame({
  title,
  largeTitle = true,
  backLabel,
  onBack,
  trailing,
  children,
}: {
  title: string
  largeTitle?: boolean
  backLabel?: string
  onBack?: () => void
  trailing?: ReactNode
  children: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [titleAway, setTitleAway] = useState(false)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const isRoot = !onBack
  // A phone in landscape has no room for a large title on a pushed screen: as on iOS in compact
  // height, the title sits in the bar and the content starts right below it.
  const compactHeight = useMediaQuery(XSHORT)
  const large = largeTitle && !(compactHeight && !isRoot)
  // A root without buttons lets its bar float over the content, so the large title sits exactly
  // where the Leaderboard has its own.
  const overlay = isRoot && largeTitle && !trailing

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setScrolled(el.scrollTop > 1)
    onScroll()
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    const heading = titleRef.current
    if (!large || !el || !heading) return
    // The title counts as gone once most of it has moved under the bar, or, where the bar floats
    // over the title (roots), out of the top of the screen.
    const bar = overlay ? 0 : (el.querySelector("header")?.getBoundingClientRect().height ?? 44)
    const observer = new IntersectionObserver(
      ([entry]) => {
        // A hidden screen (another tab, a screen pushed over it, setup or a game over the tabs)
        // reports its title as gone. That isn't scrolling: taken as such, the bar would flash its
        // title and background each time the screen shows again.
        if (entry.boundingClientRect.height === 0 || !entry.rootBounds?.height) return
        setTitleAway(entry.intersectionRatio < 0.4)
      },
      {
        root: el,
        rootMargin: `-${Math.round(bar)}px 0px 0px 0px`,
        threshold: [0, 0.4, 1],
      },
    )
    observer.observe(heading)
    return () => observer.disconnect()
  }, [large, overlay])

  return (
    <div ref={scrollRef} data-scroll-container className="absolute inset-0 overflow-y-auto overscroll-contain">
      <NavHeader
        title={title}
        backLabel={backLabel}
        onBack={onBack}
        trailing={
          <>
            {trailing}
            <div ref={setSlot} className="contents" />
          </>
        }
        showTitle={!large || titleAway}
        solid={overlay ? titleAway : scrolled}
        overlay={overlay}
      />
      <div
        className={cn(
          "mx-auto max-w-2xl px-4 pb-12 pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)]",
          overlay ? "pt-[max(env(safe-area-inset-top),0.5rem)] lg:pt-10" : "pt-1",
        )}
      >
        <h1
          ref={titleRef}
          tabIndex={-1}
          data-screen-title
          className={cn(large ? "pt-3 font-display text-4xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]" : "sr-only", "outline-none")}
        >
          {title}
        </h1>
        <NavBarSlot.Provider value={slot}>{children}</NavBarSlot.Provider>
      </div>
    </div>
  )
}
