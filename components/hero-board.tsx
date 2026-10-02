"use client"

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { motion, useAnimationControls, useReducedMotion } from "framer-motion"
import { Dartboard } from "@/components/dartboard"
import { useT } from "@/components/i18n-provider"
import { BOARD_EXTENT, RADIUS, hitAt, type Hit } from "@/lib/board-geometry"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface ThrownDart {
  id: number
  x: number
  y: number
  hit: Hit
}

// Dart artwork: tip at the origin, pointing up-left into the board.
// Keep TIP_* in sync with the viewBox so the tip lands exactly on the target.
const DART_VIEWBOX = { x: -4, y: -4, w: 104, h: 96 }
const TIP_X = (-DART_VIEWBOX.x / DART_VIEWBOX.w) * 100
const TIP_Y = (-DART_VIEWBOX.y / DART_VIEWBOX.h) * 100

const DART_SILHOUETTE = (
  <>
    <polygon points="0,0 22,-1.8 22,1.8" />
    <rect x="22" y="-4.2" width="32" height="8.4" rx="2.4" />
    <rect x="54" y="-2.3" width="26" height="4.6" />
    <polygon points="74,-0.5 86,-18 114,-16 111,-0.5" />
    <polygon points="74,0.5 88,9 114,8 111,0.5" />
  </>
)

function DartArt({ shadowFilter }: { shadowFilter: string }) {
  return (
    <>
      <g transform="rotate(47)" fill="#000" opacity="0.45" filter={`url(#${shadowFilter})`}>
        {DART_SILHOUETTE}
      </g>
      <g transform="rotate(40)">
        <polygon points="0,0 22,-1.8 22,1.8" fill="#dde2e8" />
        <rect x="22" y="-4.2" width="32" height="8.4" rx="2.4" fill="#5a626d" />
        <g stroke="#2b3139" strokeWidth="1.3">
          {[28, 31.5, 35, 38.5, 42, 45.5].map((x) => (
            <line key={x} x1={x} y1="-3.8" x2={x} y2="3.8" />
          ))}
        </g>
        <rect x="23" y="-3.4" width="30" height="1.6" rx="0.8" fill="#cfd5dd" opacity="0.75" />
        <rect x="54" y="-2.3" width="26" height="4.6" fill="#1c2028" />
        <rect x="55" y="-2.5" width="3.2" height="5" style={{ fill: "hsl(var(--primary))" }} />
        <polygon points="74,0.5 88,9 114,8 111,0.5" style={{ fill: "hsl(var(--primary))" }} />
        <polygon points="74,0.5 88,9 114,8 111,0.5" fill="#000" opacity="0.35" />
        <polygon points="74,-0.5 86,-18 114,-16 111,-0.5" style={{ fill: "hsl(var(--primary))" }} />
        <polygon points="86,-18 114,-16 111,-0.5 106,-0.5 108,-14" fill="#fff" opacity="0.18" />
        <line x1="74" y1="0" x2="112" y2="0" stroke="#0b1220" strokeWidth="1.4" />
      </g>
    </>
  )
}

function Dart({ dart, reduceMotion }: { dart: ThrownDart; reduceMotion: boolean }) {
  const shadowId = `dart-shadow-${dart.id}`
  const left = ((dart.x + BOARD_EXTENT) / (BOARD_EXTENT * 2)) * 100
  const top = ((dart.y + BOARD_EXTENT) / (BOARD_EXTENT * 2)) * 100

  return (
    <div
      className="pointer-events-none absolute w-[29%]"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        aspectRatio: `${DART_VIEWBOX.w} / ${DART_VIEWBOX.h}`,
        transform: `translate(-${TIP_X}%, -${TIP_Y}%)`,
      }}
    >
      <motion.div
        className="h-full w-full"
        style={{ transformOrigin: `${TIP_X}% ${TIP_Y}%` }}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: "80%", y: "130%", scale: 1.9 }}
        animate={
          reduceMotion
            ? { opacity: 1 }
            : { opacity: 1, x: 0, y: 0, scale: 1, rotate: [0, 0, -5, 3, -1.2, 0] }
        }
        transition={
          reduceMotion
            ? { duration: 0.15 }
            : {
                opacity: { duration: 0.1 },
                x: { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] },
                y: { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] },
                scale: { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] },
                rotate: { duration: 0.9, times: [0, 0.33, 0.48, 0.64, 0.8, 1] },
              }
        }
      >
        <svg
          viewBox={`${DART_VIEWBOX.x} ${DART_VIEWBOX.y} ${DART_VIEWBOX.w} ${DART_VIEWBOX.h}`}
          className="h-full w-full overflow-visible"
        >
          <defs>
            <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.8" />
            </filter>
          </defs>
          <DartArt shadowFilter={shadowId} />
        </svg>
      </motion.div>
    </div>
  )
}

const spokenLabel = (hit: Hit, t: Messages) => {
  switch (hit.ring) {
    case "bull":
      return t.play.hit.bull
    case "outer-bull":
      return t.play.hit.outerBull
    case "miss":
      return t.play.hit.miss
    case "triple":
      return t.play.hit.triple(hit.number ?? 0, hit.score)
    case "double":
      return t.play.hit.double(hit.number ?? 0, hit.score)
    default:
      return `${hit.score}`
  }
}

export function HeroBoard({ className }: { className?: string }) {
  const t = useT()
  const [darts, setDarts] = useState<ThrownDart[]>([])
  const nextId = useRef(0)
  const boardRef = useRef<HTMLDivElement>(null)
  const controls = useAnimationControls()
  const reduceMotion = useReducedMotion() ?? false

  const throwAt = (x: number, y: number) => {
    const dart = { id: nextId.current++, x, y, hit: hitAt(x, y) }
    setDarts((prev) => (prev.length >= 3 ? [dart] : [...prev, dart]))
    if (!reduceMotion) {
      controls.start({ scale: [1, 0.985, 1], transition: { delay: 0.26, duration: 0.3, times: [0, 0.35, 1] } })
    }
  }

  // Opening moment: the first dart of the visit lands in treble 20.
  useEffect(() => {
    const timer = setTimeout(() => throwAt(3, -(RADIUS.trebleInner + RADIUS.trebleOuter) / 2), reduceMotion ? 0 : 450)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = boardRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * BOARD_EXTENT * 2 - BOARD_EXTENT
    const y = ((e.clientY - rect.top) / rect.height) * BOARD_EXTENT * 2 - BOARD_EXTENT
    if (Math.hypot(x, y) > RADIUS.rim) return
    throwAt(x, y)
  }

  // Keyboard users get a throw with a realistic spread around treble 20.
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return
    e.preventDefault()
    const angle = (Math.random() - 0.5) * 0.9
    const r = 60 + Math.random() * 90
    throwAt(r * Math.sin(angle), -r * Math.cos(angle))
  }

  const total = darts.reduce((sum, d) => sum + d.hit.score, 0)
  const last = darts.at(-1)

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative w-full">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[18%] rounded-full bg-[radial-gradient(closest-side,hsl(var(--primary)/0.28),hsl(var(--primary)/0.08)_60%,transparent)]"
        />
        <motion.div
          ref={boardRef}
          animate={controls}
          role="button"
          tabIndex={0}
          aria-label={t.play.practiceBoardLabel}
          onClick={handleClick}
          onKeyDown={handleKey}
          className="relative aspect-square w-full cursor-crosshair touch-manipulation select-none rounded-full outline-none focus-visible:ring-4 focus-visible:ring-primary/60 [-webkit-tap-highlight-color:transparent]"
        >
          <Dartboard className="h-full w-full" />
          {darts.map((dart) => (
            <Dart key={dart.id} dart={dart} reduceMotion={reduceMotion} />
          ))}
        </motion.div>
      </div>

      <div className="mt-4 flex items-center gap-2 xshort:mt-2" aria-hidden="true">
        {[0, 1, 2].map((i) => {
          const dart = darts.at(i)
          return (
            <div
              key={i}
              className={cn(
                "flex h-11 min-w-[3.25rem] items-center justify-center rounded-xl border px-2 font-display text-xl font-semibold tabular-nums transition-colors",
                dart ? "border-primary/40 bg-primary/10 text-foreground" : "border-dashed border-border text-muted-foreground/60",
              )}
            >
              {dart ? (dart.hit.ring === "miss" ? t.common.miss : dart.hit.label) : "–"}
            </div>
          )
        })}
        <div className="ml-2 min-w-[3.5rem] text-right font-display text-3xl font-semibold tabular-nums">{total}</div>
      </div>
      <p className="sr-only" aria-live="polite">
        {last ? `${spokenLabel(last.hit, t)}. ${t.play.visitTotal(total)}` : ""}
      </p>
    </div>
  )
}
