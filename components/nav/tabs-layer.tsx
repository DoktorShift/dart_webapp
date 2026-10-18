"use client"

import { Suspense, memo, use, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { behind, onTop, pushTransition } from "@/components/nav/motion"
import { useFocusReturn } from "@/components/nav/use-focus-return"

// Covering moves the tabs a little to the left and dims them, like the screen under a pushed one.
const VARIANTS = { shown: onTop, covered: behind }

// Never settles: suspending on it keeps the tabs hidden until they are shown again.
const hold = new Promise<never>(() => {})

// While frozen, the tabs are suspended: React keeps their state and DOM, and whatever changes in
// them meanwhile (a finished game reaching the Rangliste, an area's live data) is rendered only
// when the browser is idle, never in the way of a throw. Shown again, React runs their layout
// effects once more. Like React's <Activity mode="hidden">, which the React build inside Next.js
// 15 doesn't export yet.
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
  useFocusReturn(ref, !covered)

  return (
    <motion.div
      ref={ref}
      custom={reduceMotion}
      variants={VARIANTS}
      initial={false}
      animate={covered ? "covered" : "shown"}
      transition={pushTransition(reduceMotion)}
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
  )
})
