"use client"

import { Component, Suspense, memo, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { behind, offRight, onTop, pushTransition } from "@/components/nav/motion"
import { ScreenFrame } from "@/components/nav/screen-frame"
import { useFocusReturn } from "@/components/nav/use-focus-return"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { useT } from "@/components/i18n-provider"
import { getScreen, type ScreenProps } from "@/lib/shell/registry"
import type { ScreenParams, StackEntry, TabId } from "@/lib/shell/nav"
import { cn } from "@/lib/utils"

// The same push and pop as the app's full-screen flows (motion.ts).
const VARIANTS = { enter: offRight, top: onTop, covered: behind, exit: offRight }

// The large title of a screen (ScreenFrame), where focus goes when the screen appears.
const SCREEN_TITLE = "[data-screen-title]"

// Pushed screens are opaque, with the board-light glow of the page behind them in dark mode.
const PUSHED_SURFACE =
  "bg-background shadow-[-10px_0_28px_-16px_rgba(0,0,0,0.45)] dark:[background-image:radial-gradient(circle_at_bottom_left,rgba(29,78,216,0.15),transparent_50%),radial-gradient(circle_at_top_right,rgba(29,78,216,0.15),transparent_50%)]"

function StackLayer({
  index,
  isTop,
  active,
  reduceMotion,
  children,
}: {
  index: number
  isTop: boolean
  active: boolean
  reduceMotion: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // A covered screen stays in place (with its scroll position and input) but is taken out of
  // layout once the push animation has finished.
  const [coveredDone, setCoveredDone] = useState(false)
  if (isTop && coveredDone) setCoveredDone(false)
  const visible = active && (isTop || !coveredDone)

  // Scroll positions of everything that scrolls inside this screen, put back whenever it shows
  // again (another tab, a screen pushed over it, or setup and the game over all tabs, whose
  // reveal runs this layout effect again): browsers forget them while an element is display: none.
  const scrolls = useRef(new Map<Element, number>())
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const remember = (event: Event) => {
      if (event.target instanceof Element) scrolls.current.set(event.target, event.target.scrollTop)
    }
    el.addEventListener("scroll", remember, { capture: true, passive: true })
    return () => el.removeEventListener("scroll", remember, { capture: true })
  }, [])
  useLayoutEffect(() => {
    if (!visible) return
    for (const [el, top] of scrolls.current) {
      if (el.isConnected && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top
    }
  }, [visible])

  // VoiceOver and keyboard focus follow navigation: a new screen announces its title; going back
  // returns to the control that opened the screen above.
  useFocusReturn(ref, isTop, SCREEN_TITLE)
  useEffect(() => {
    if (index > 0 && active) ref.current?.querySelector<HTMLElement>(SCREEN_TITLE)?.focus({ preventScroll: true })
    // Only when the screen first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div
      ref={ref}
      custom={reduceMotion}
      variants={VARIANTS}
      initial="enter"
      animate={isTop ? "top" : "covered"}
      exit="exit"
      transition={pushTransition(reduceMotion)}
      onAnimationComplete={(name) => {
        if (name === "covered") setCoveredDone(true)
      }}
      inert={!isTop}
      aria-hidden={isTop ? undefined : true}
      style={{ zIndex: index, display: isTop || visible ? undefined : "none" }}
      className={cn("absolute inset-0 overflow-hidden", index > 0 && PUSHED_SURFACE)}
    >
      {children}
    </motion.div>
  )
}

function Loading() {
  const t = useT()
  // Quiet for the first moment: most screens arrive before anyone would notice.
  const [show, setShow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 400)
    return () => clearTimeout(timer)
  }, [])
  return (
    <p role="status" className={cn("py-12 text-center text-[0.9375rem] text-muted-foreground transition-opacity", show ? "opacity-100" : "opacity-0")}>
      {t.shell.loading}
    </p>
  )
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useT()
  return (
    <div role="alert" className="flex flex-col items-center py-12 text-center">
      <p className="max-w-xs text-[0.9375rem] text-muted-foreground">{t.shell.loadFailed}</p>
      <Button variant="secondary" onClick={onRetry} className="mt-4 h-11 rounded-xl px-5 text-[1.0625rem]">
        {t.shell.retry}
      </Button>
    </div>
  )
}

// Catches a screen whose code didn't arrive (offline before it was ever opened) or that failed,
// so the rest of the app keeps working and the screen can be tried again.
class LoadBoundary extends Component<{ screen: ComponentType<ScreenProps>; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  retry = () => {
    ;(this.props.screen as { reset?: () => void }).reset?.()
    this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? <LoadFailed onRetry={this.retry} /> : this.props.children
  }
}

// A part of a screen whose code may still be on its way (lazyScreen): a quiet "loading" line, and
// "try again" if it can't be fetched.
export function LazyContent<P extends object>({ component: Screen, props }: { component: ComponentType<P>; props: P }) {
  return (
    <LoadBoundary screen={Screen as ComponentType<ScreenProps>}>
      <Suspense fallback={<Loading />}>
        <Screen {...props} />
      </Suspense>
    </LoadBoundary>
  )
}

export interface StackRoot {
  // The root's title, for the first pushed screen's back button.
  title: string
  // The root renders its own frame: ScreenFrame, or its own header (Play, Leaderboard).
  content: ReactNode
}

// One tab: its root and the screens pushed onto it. Every tab stays mounted once it has been
// opened, so switching tabs keeps each one exactly where it was (HIG: tab bars). Memoised: with a
// stable root and entries, nothing outside the tab re-renders it.
export const StackView = memo(function StackView({
  tab,
  active,
  root,
  entries,
  onBack,
  onUpdate,
}: {
  tab: TabId
  active: boolean
  root: StackRoot
  entries: readonly StackEntry[]
  onBack: () => void
  // Merges params into the entry with that key (ScreenProps.setParams).
  onUpdate: (key: string, params: ScreenParams) => void
}) {
  const t = useT()
  useRegistryVersion()
  const reduceMotion = useReducedMotion() ?? false

  const layers: { key: string; title: string; node: ReactNode }[] = [{ key: `root:${tab}`, title: root.title, node: root.content }]
  for (const entry of entries) {
    const definition = getScreen(entry.screen)
    if (!definition) continue
    const title = definition.title(t, entry.params)
    const Screen = definition.Component
    layers.push({
      key: entry.key,
      title,
      node: (
        <ScreenFrame title={title} largeTitle={definition.largeTitle ?? true} backLabel={layers[layers.length - 1].title} onBack={onBack}>
          <LazyContent component={Screen} props={{ params: entry.params, setParams: (params: ScreenParams) => onUpdate(entry.key, params) }} />
        </ScreenFrame>
      ),
    })
  }

  return (
    <div data-tab-panel={tab} hidden={!active} className="absolute inset-0 overflow-hidden">
      <AnimatePresence initial={false} custom={reduceMotion}>
        {layers.map((layer, index) => (
          <StackLayer key={layer.key} index={index} isTop={index === layers.length - 1} active={active} reduceMotion={reduceMotion}>
            {layer.node}
          </StackLayer>
        ))}
      </AnimatePresence>
    </div>
  )
})
