import { useId } from "react"
import { BOARD_COLORS, BOARD_EXTENT, BOARD_NUMBERS, RADIUS, SEGMENTS, polar, type Bed } from "@/lib/board-geometry"
import type { GameType } from "@/lib/game/types"
import { cn } from "@/lib/utils"

// Opacity 0–1 per bed; beds below 1 fade toward the muted colour.
export type BoardHighlight = (target: number | "bull", bed: Bed | "outer-bull" | "bull") => number

const CRICKET_NUMBERS = [15, 16, 17, 18, 19, 20]

// Each game's mini board lights up the beds it is played on: all of them for X01, 15 to 20
// and the bull for Cricket, the first numbers for Around the Clock.
export const GAME_HIGHLIGHTS: Record<GameType, BoardHighlight> = {
  x01: () => 1,
  cricket: (target) => (target === "bull" || CRICKET_NUMBERS.includes(target) ? 1 : 0),
  clock: (target) => (target === 1 ? 1 : target === 2 ? 0.6 : target === 3 ? 0.35 : 0),
}

interface DartboardProps {
  className?: string
  // "hero" draws the number ring, wire spider, sisal grain and light halo.
  variant?: "hero" | "mini"
  // Omit to show the whole board in full colour.
  highlight?: BoardHighlight
  // A number to aim for: the board stays in its own colours, dimmed, and the
  // target lights up in the accent colour.
  target?: number | "bull"
}

const fade = (strength: number) => ({ fill: "hsl(var(--muted-foreground))", fillOpacity: 0.12 + strength * 0.6 })

export function Dartboard({ className, variant = "hero", highlight, target }: DartboardProps) {
  const id = useId().replace(/:/g, "")
  const hero = variant === "hero"
  const extent = hero ? BOARD_EXTENT : RADIUS.doubleOuter + 2
  const strength = (target: number | "bull", bed: Bed | "outer-bull" | "bull") => (highlight ? highlight(target, bed) : 1)

  return (
    <svg viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`} className={cn("block overflow-visible", className)} aria-hidden="true">
      {hero && (
        <defs>
          <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
          <filter id={`${id}-halo`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <radialGradient id={`${id}-light`} cx="0.42" cy="0.3" r="0.75">
            <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.38" />
          </radialGradient>
        </defs>
      )}

      {hero && (
        <>
          {/* LED surround light, in the app's accent colour */}
          <circle r={RADIUS.rim + 12} fill="none" strokeWidth="10" filter={`url(#${id}-halo)`} style={{ stroke: "hsl(var(--primary))", opacity: 0.85 }} />
          <circle r={RADIUS.rim + 8} fill="none" strokeWidth="2.5" style={{ stroke: "hsl(var(--primary))" }} />
          <circle r={RADIUS.rim} fill={BOARD_COLORS.rim} />
        </>
      )}

      {SEGMENTS.map((segment) => {
        const s = strength(segment.number, segment.bed)
        return <path key={segment.key} d={segment.d} fill={s >= 1 ? segment.color : undefined} style={s >= 1 ? undefined : fade(s)} />
      })}

      {(["outer-bull", "bull"] as const).map((bed) => {
        const s = strength("bull", bed)
        const color = bed === "bull" ? BOARD_COLORS.red : BOARD_COLORS.green
        return <circle key={bed} r={bed === "bull" ? RADIUS.bull : RADIUS.outerBull} fill={s >= 1 ? color : undefined} style={s >= 1 ? undefined : fade(s)} />
      })}

      {target !== undefined && (
        <g>
          <circle r={RADIUS.doubleOuter} fill="#000" opacity="0.5" />
          {target === "bull" ? (
            <circle r={RADIUS.outerBull} style={{ fill: "hsl(var(--primary))", stroke: "#fff", strokeWidth: 3 }} />
          ) : (
            SEGMENTS.filter((segment) => segment.number === target).map((segment) => (
              <path key={segment.key} d={segment.d} style={{ fill: "hsl(var(--primary))", stroke: "#fff", strokeWidth: 3 }} />
            ))
          )}
        </g>
      )}

      {hero && (
        <>
          <circle r={RADIUS.doubleOuter} fill="#000" filter={`url(#${id}-grain)`} opacity="0.35" />

          <g stroke={BOARD_COLORS.wire} strokeWidth="1.1" fill="none" opacity="0.9">
            {[RADIUS.bull, RADIUS.outerBull, RADIUS.trebleInner, RADIUS.trebleOuter, RADIUS.doubleInner, RADIUS.doubleOuter].map((r) => (
              <circle key={r} r={r} />
            ))}
            {BOARD_NUMBERS.map((_, i) => {
              const [x1, y1] = polar(RADIUS.outerBull, i * 18 - 9)
              const [x2, y2] = polar(RADIUS.doubleOuter, i * 18 - 9)
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
            })}
          </g>

          <circle r={RADIUS.doubleOuter} fill={`url(#${id}-light)`} />

          <g
            fill={BOARD_COLORS.numeral}
            fontSize="30"
            fontWeight="600"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
          >
            {BOARD_NUMBERS.map((number, i) => {
              const [x, y] = polar(RADIUS.numbers, i * 18)
              return (
                <text key={number} x={x} y={y}>
                  {number}
                </text>
              )
            })}
          </g>
        </>
      )}
    </svg>
  )
}
