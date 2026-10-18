import type { Transition } from "framer-motion"

// The app's one push and pop, as on iOS: a pushed screen slides in from the right over the one
// below, which moves a little to the left and dims. Reduce Motion cross-fades instead. Shared by
// the tab stacks (stack-view.tsx), the tabs under setup and the game (tabs-layer.tsx), and setup
// and the game themselves (app/page.tsx), so all of them always move alike. Each position takes
// whether Reduce Motion is on.

export const onTop = { x: 0, opacity: 1 }

// Right of the stack: about to be pushed, or popped.
export const offRight = (reduce: boolean) => (reduce ? { opacity: 0 } : { x: "100%", opacity: 1 })

// Under the screen on top.
export const behind = (reduce: boolean) => (reduce ? { opacity: 0 } : { x: "-25%", opacity: 0.6 })

export const pushTransition = (reduce: boolean): Transition => ({ type: "tween", duration: reduce ? 0.15 : 0.32, ease: [0.32, 0.72, 0, 1] })
