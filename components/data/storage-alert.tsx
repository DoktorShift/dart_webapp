"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/i18n-provider"
import { onStorageChange } from "@/lib/storage/db"
import { useSaveState } from "@/lib/storage/hooks"
import { dismissSaveAlert, retrySaves } from "@/lib/storage/save-status"
import { cn } from "@/lib/utils"

// Says plainly when the game could not be saved, with a way to try again, and never a false
// "saved". It sits below the navigation bar (the game screen's controls stay reachable) and
// leaves the board usable: the darts entered stay in the page until a write works.
export function StorageAlert() {
  const t = useT()
  const save = useSaveState()
  const reduceMotion = useReducedMotion()
  const [retrying, setRetrying] = useState(false)
  const [stillFailing, setStillFailing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const visible = save.failing && !save.dismissed

  useEffect(() => {
    if (!visible) setStillFailing(false)
  }, [visible])

  // After a successful retry, the one confirmation the app gives: "Dein Spiel ist gespeichert."
  useEffect(() => {
    if (save.recovered === 0) return
    setConfirmed(true)
    const timer = setTimeout(() => setConfirmed(false), 2500)
    return () => clearTimeout(timer)
  }, [save.recovered])

  // Everything was deleted in another tab: start fresh here too, so this tab can't write the
  // old game back.
  useEffect(
    () =>
      onStorageChange((message) => {
        if (message.type === "wipe") window.location.assign("/")
      }),
    [],
  )

  const retry = async () => {
    setRetrying(true)
    const ok = await retrySaves()
    setRetrying(false)
    setStillFailing(!ok)
  }

  const motionProps = {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 },
    transition: { duration: 0.2 },
  }
  const place =
    "fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.25rem)] z-40 mx-auto max-w-md pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] xshort:top-[calc(env(safe-area-inset-top)+2.25rem)]"

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div key="failed" role="alert" {...motionProps} className={place}>
          {/* Phones held sideways get one compact row, so the keypad below stays in reach. */}
          <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-2xl xshort:items-center xshort:py-2 xshort:pl-3 xshort:pr-1">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning xshort:mt-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[1.0625rem] font-semibold leading-snug">{t.data.saveFailed}</p>
            <button
              type="button"
              aria-label={t.data.hide}
              onClick={dismissSaveAlert}
              className="order-1 -mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-secondary xshort:order-3 xshort:m-0"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            {/* Under the title; sideways only once a retry failed, as a line of its own. */}
            <p
              className={cn(
                "order-2 -mt-2.5 basis-full pl-8 text-[0.8125rem] text-muted-foreground xshort:order-4 xshort:-mt-1",
                !stillFailing && "xshort:hidden",
              )}
            >
              {stillFailing ? t.data.saveStillFailing : t.data.saveFailedHint}
            </p>
            <Button
              onClick={retry}
              disabled={retrying}
              aria-busy={retrying}
              className="order-3 h-11 w-full shrink-0 basis-full rounded-xl text-[1.0625rem] font-semibold xshort:order-2 xshort:w-auto xshort:basis-auto xshort:px-4"
            >
              {t.data.retry}
            </Button>
          </div>
        </motion.div>
      ) : (
        confirmed && (
          <motion.div key="saved" role="status" {...motionProps} className={place}>
            <p className="mx-auto w-fit rounded-full border border-border bg-card px-4 py-2.5 text-[0.9375rem] font-medium shadow-2xl">{t.data.saved}</p>
          </motion.div>
        )
      )}
    </AnimatePresence>
  )
}
