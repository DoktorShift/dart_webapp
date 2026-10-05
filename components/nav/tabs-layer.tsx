"use client"

import { Suspense, createContext, memo, use, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"

// Whether the tabs are on screen, i.e. not covered by game setup or a game. A screen inside them
// puts its scroll positions back when this turns true again (StackLayer in stack-view.tsx).
const TabsShownContext = createContext(true)
export const useTabsShown = () => useContext(TabsShownContext)

// Covering moves the tabs a little to the left and dims them, like the screen under a pushed one;
// Reduce Motion fades. The same values the app's full-screen flows always used.
const VARIANTS = {
  shown: { x: 0, opacity: 1 },
  covered: (reduce: boolean) => (reduce ? { opacity: 0 } : { x: "-25%", opacity: 0.6 }),
}

// Never settles: suspending on it keeps the tabs hidden until they are shown again.
const hold = new Promise<never>(() => {})

// While frozen, the tabs are suspended: React keeps their state and DOM, and whatever changes in
// them meanwhile (a finished game reaching the Rangliste, an area's live data) is rendered only
// when the browser is idle, never in the way of a throw. Like React's <Activity mode="hidden">,
// which the React build inside Next.js 15 doesn't export yet.
function Freeze({ frozen, children }: { frozen: boolean; children: ReactNode }) {
  if (frozen) use(hold)
  return children
}

// The tabs under setup and the game. They stay mounted the whole time, so every tab comes back
// exactly as it was left: its pushed screens, their scroll positions and whatever was typed in
// them (PLAN: returning keeps filters, scroll position and drafts). While covered they are inert
// for focus and VoiceOver, and once the cover has slid in they are taken out of layout and frozen.
// Pass memoised children: a game re-renders on every throw and must not reach them.
export const TabsLayer = memo(function TabsLayer({ covered, children }: { covered: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement>(null)
  const [gone, setGone] = useState(false)
  if (!covered && gone) setGone(false)
  const shown = !covered || !gone

  // Coming back, focus returns to the control that opened setup or the game.
  const lastFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const track = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocus.current = event.target
    }
    el.addEventListener("focusin", track)
    return () => el.removeEventListener("focusin", track)
  }, [])
  const wasCovered = useRef(covered)
  useEffect(() => {
    if (wasCovered.current && !covered && lastFocus.current?.isConnected) lastFocus.current.focus({ preventScroll: true })
    wasCovered.current = covered
  }, [covered])

  return (
    <TabsShownContext.Provider value={shown}>
      <motion.div
        ref={ref}
        custom={reduceMotion}
        variants={VARIANTS}
        initial={false}
        animate={covered ? "covered" : "shown"}
        transition={{ type: "tween", duration: reduceMotion ? 0.15 : 0.32, ease: [0.32, 0.72, 0, 1] }}
        onAnimationComplete={(name) => {
          if (name === "covered") setGone(true)
        }}
        inert={covered}
        aria-hidden={covered || undefined}
        style={{ display: shown ? undefined : "none" }}
        className="absolute inset-0 overflow-hidden"
      >
        <Suspense fallback={null}>
          <Freeze frozen={!shown}>{children}</Freeze>
        </Suspense>
      </motion.div>
    </TabsShownContext.Provider>
  )
})
