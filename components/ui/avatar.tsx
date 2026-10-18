"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { AVATAR_SECTORS, avatarDrawing, safeImageUrl } from "@/lib/shell/avatar"
import { cn } from "@/lib/utils"

// A round picture for a person. Without a photo it draws one from a seed (a pubkey, a player id,
// a name): a little board whose colour and segments are always the same for the same seed
// (lib/shell/avatar.ts). Nothing is uploaded (decision 0001, F5).
//
// A photo is only ever an existing https address. It loads without a referrer, so the image host
// doesn't learn which page shows it, and falls back to the drawing while it loads and when it
// fails. SVG files are not used as photos.

// One ring segment of the board, as an SVG path in a 100 × 100 box.
function sectorPath(index: number, inner: number, outer: number) {
  const step = (Math.PI * 2) / AVATAR_SECTORS
  const a0 = index * step - Math.PI / 2 - step / 2
  const a1 = a0 + step
  const p = (r: number, a: number) => `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`
  return `M${p(outer, a0)}A${outer} ${outer} 0 0 1 ${p(outer, a1)}L${p(inner, a1)}A${inner} ${inner} 0 0 0 ${p(inner, a0)}Z`
}

const OUTER_SECTORS = Array.from({ length: AVATAR_SECTORS }, (_, i) => sectorPath(i, 30, 46))
const INNER_SECTORS = Array.from({ length: AVATAR_SECTORS }, (_, i) => sectorPath(i, 16, 28))

function Drawing({ seed, name }: { seed: string; name?: string }) {
  const id = useId()
  const { from, to, outer, inner, initial } = avatarDrawing(seed, name)
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={to} />
          <stop offset="1" stopColor={from} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id}-bg)`} />
      <g fill="#fff">
        {OUTER_SECTORS.map((d, i) => outer[i] && <path key={`o${i}`} d={d} opacity={initial ? 0.14 : 0.24} />)}
        {!initial && INNER_SECTORS.map((d, i) => !inner[i] && <path key={`i${i}`} d={d} opacity={0.14} />)}
      </g>
      {initial ? (
        <text x="50" y="50" dy="0.35em" textAnchor="middle" fontSize="44" fontWeight="600" fill="#fff" fontFamily="system-ui, -apple-system, sans-serif">
          {initial}
        </text>
      ) : (
        <circle cx="50" cy="50" r="9" fill="#fff" opacity={0.85} />
      )}
    </svg>
  )
}

export function Avatar({
  seed,
  name,
  src,
  size = 40,
  label,
  className,
}: {
  // What the drawing is made from: a pubkey, a player id or a name.
  seed: string
  // Shows its first letter on the drawing.
  name?: string
  // An https photo address, e.g. from a public profile.
  src?: string | null
  size?: number
  // Gives the picture a name for VoiceOver. Leave it out when the name is written next to it.
  label?: string
  className?: string
}) {
  const url = useMemo(() => safeImageUrl(src), [src])
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading")
  useEffect(() => setState("loading"), [url])

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full bg-secondary", className)}
      style={{ width: size, height: size }}
    >
      <Drawing seed={seed} name={name} />
      {url && state !== "failed" && (
        // Remote profile pictures: next/image would proxy or optimise them; here they load as they are.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          loading="lazy"
          draggable={false}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-200", state === "loaded" ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  )
}
