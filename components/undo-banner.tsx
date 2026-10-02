"use client"

import { useEffect } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useT } from "@/components/i18n-provider"

// A short-lived "Game ended, Undo" bar above the tab bar, so a mis-tap on "End game" never
// costs a match. It disappears by itself after a few seconds.
export function UndoBanner({
  message,
  visible,
  onUndo,
  onExpire,
}: {
  message: string
  visible: boolean
  onUndo: () => void
  onExpire: () => void
}) {
  const t = useT()
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(onExpire, 8000)
    return () => clearTimeout(timer)
  }, [visible, onExpire])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-x-3 bottom-[calc(3.0625rem+env(safe-area-inset-bottom)+0.75rem)] z-40 mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-border bg-card py-1.5 pl-4 pr-1.5 shadow-2xl xshort:bottom-[calc(2.5rem+env(safe-area-inset-bottom)+0.5rem)] lg:bottom-6"
        >
          <span className="min-w-0 flex-1 text-[0.9375rem]">{message}</span>
          <button
            type="button"
            onClick={onUndo}
            className="min-h-11 shrink-0 rounded-xl px-4 text-[1.0625rem] font-semibold text-primary active:bg-secondary"
          >
            {t.common.undo}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
