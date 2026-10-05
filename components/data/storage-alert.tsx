"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { CircleCheck, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import { onStorageChange } from "@/lib/storage/db"
import { useSaveState } from "@/lib/storage/hooks"
import { dismissSaveAlert, retrySaves } from "@/lib/storage/save-status"

// A box in page coordinates.
interface Area {
  left: number
  top: number
  width: number
  height: number
}

// Where an element is laid out, without the slide of a screen change (offsets ignore transforms).
function layoutBox(el: HTMLElement): Area {
  let left = 0
  let top = 0
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft
    top += node.offsetTop
  }
  return { left, top, width: el.offsetWidth, height: el.offsetHeight }
}

const sameArea = (a: Area | null, b: Area | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)

// The game's scoreboard area (components/game/game-screen.tsx, data-area="scores"): the part of
// the game screen the alert may cover. The keys are never under it. It starts right below the
// navigation bar, so its top is also where that bar ends.
function useScoreArea(active: boolean) {
  const [area, setArea] = useState<Area | null>(null)
  useLayoutEffect(() => {
    if (!active) {
      setArea(null)
      return
    }
    let observed: HTMLElement | null = null
    const measure = () => {
      // Looked up each time: a rematch replaces the game screen.
      const scores = document.querySelector<HTMLElement>('[data-area="scores"]')
      if (scores !== observed) {
        if (observed) observer.unobserve(observed)
        if (scores) observer.observe(scores)
        observed = scores
      }
      const next = scores ? layoutBox(scores) : null
      setArea((prev) => (sameArea(prev, next) ? prev : next))
    }
    const observer = new ResizeObserver(measure)
    measure()
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [active])
  return area
}

// Space between the navigation bar and the alert.
const TOP_GAP = 4

// "full": title, the calming hint and "Erneut versuchen". "compact": without the hint. "bar": one
// line in the navigation bar's band, for a game with no room above its keys (a phone held
// sideways). The next smaller form is tried before the screen is painted, so only the one that
// fits is ever seen.
type Fit = "full" | "compact" | "bar"

// Says plainly when the game could not be saved, with a way to try again, and never a false
// "saved". In the game it sits over the scoreboard and never over a key, so darts can still be
// entered: they stay in the page until a write works. A retry that fails again explains why in
// an alert, in direct answer to the tap.
export function StorageAlert({ inGame }: { inGame: boolean }) {
  const t = useT()
  const save = useSaveState()
  const reduceMotion = useReducedMotion()
  const [retrying, setRetrying] = useState(false)
  const [stillFailing, setStillFailing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const visible = save.failing && !save.dismissed
  const kind = visible ? "failed" : confirmed ? "saved" : null

  const area = useScoreArea(inGame && kind !== null)
  const key = area && kind ? `${kind}:${area.width}x${area.height}` : ""
  const [sized, setSized] = useState<{ key: string; fit: Fit }>({ key: "", fit: "full" })
  const fit: Fit = sized.key === key ? sized.fit : "full"
  const content = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = content.current
    if (!area || !el || fit === "bar") return
    if (el.offsetHeight > area.height - TOP_GAP) setSized({ key, fit: fit === "full" && kind === "failed" ? "compact" : "bar" })
  }, [area, fit, key, kind])

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

  const bar = area !== null && fit === "bar"
  const motionProps = {
    initial: reduceMotion || bar ? { opacity: 0 } : { opacity: 0, y: -16 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion || bar ? { opacity: 0 } : { opacity: 0, y: -16 },
    transition: { duration: 0.2 },
  }
  // Outside the game: centred below the navigation bar.
  const floating =
    "fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.25rem)] z-40 mx-auto max-w-md pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] xshort:top-[calc(env(safe-area-inset-top)+2.25rem)]"
  const place = !area
    ? { className: floating }
    : bar
      ? {
          className:
            "fixed inset-x-0 top-0 z-40 border-b border-border bg-card pl-[max(env(safe-area-inset-left),0.75rem)] pr-[max(env(safe-area-inset-right),0.25rem)] pt-[env(safe-area-inset-top)]",
          style: { height: area.top },
        }
      : { className: "fixed z-40", style: { left: area.left, top: area.top + TOP_GAP, width: area.width } }

  const closeButton = (className: string) => (
    <button
      type="button"
      aria-label={t.data.hide}
      onClick={dismissSaveAlert}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary ${className}`}
    >
      <X className="h-5 w-5" aria-hidden="true" />
    </button>
  )

  let body = null
  if (kind === "failed" && bar) {
    body = (
      <div className="flex h-full items-center gap-2">
        <TriangleAlert className="h-[18px] w-[18px] shrink-0 text-warning" aria-hidden="true" />
        <FitText minScale={0.75} className="flex-1 text-[0.9375rem] font-semibold">
          {t.data.saveFailed}
        </FitText>
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          aria-busy={retrying}
          className="flex h-11 shrink-0 items-center rounded-lg px-2 text-[0.9375rem] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-60 disabled:opacity-40"
        >
          {t.data.retry}
        </button>
        {closeButton("")}
      </div>
    )
  } else if (kind === "failed") {
    body = (
      <div ref={content} className="mx-auto flex max-w-md flex-wrap items-start gap-x-3 rounded-2xl border border-border bg-card p-3 shadow-2xl">
        <TriangleAlert className="mt-px h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[0.9375rem] font-semibold leading-5">{t.data.saveFailed}</p>
        {closeButton("-mr-3 -mt-3")}
        {fit === "full" && <p className="basis-full pl-8 pt-0.5 text-[0.8125rem] leading-[1.125rem] text-muted-foreground">{t.data.saveFailedHint}</p>}
        <Button
          onClick={retry}
          disabled={retrying}
          aria-busy={retrying}
          className="mt-2.5 h-11 w-full basis-full rounded-xl text-[1.0625rem] font-semibold"
        >
          {t.data.retry}
        </Button>
      </div>
    )
  } else if (kind === "saved" && bar) {
    body = (
      <p className="flex h-full items-center justify-center gap-2 text-[0.9375rem] font-medium">
        <CircleCheck className="h-[18px] w-[18px] shrink-0 text-success" aria-hidden="true" />
        {t.data.saved}
      </p>
    )
  } else if (kind === "saved") {
    body = (
      <div ref={content} className="mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-[0.9375rem] font-medium shadow-2xl">
        <CircleCheck className="h-[18px] w-[18px] shrink-0 text-success" aria-hidden="true" />
        {t.data.saved}
      </div>
    )
  }

  return (
    <>
      <AnimatePresence>
        {kind && (
          <motion.div key={kind} role={kind === "failed" ? "alert" : "status"} {...motionProps} {...place}>
            {body}
          </motion.div>
        )}
      </AnimatePresence>

      <AlertDialog open={stillFailing} onOpenChange={setStillFailing}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.data.saveStillFailingTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.data.saveStillFailing}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="h-11">{t.data.ok}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
