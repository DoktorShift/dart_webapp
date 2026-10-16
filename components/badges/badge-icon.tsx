"use client"

import { useEffect, useState } from "react"
import { Award } from "lucide-react"
import { cn } from "@/lib/utils"

// The picture of a badge: its image (an https address another app or an organizer gave it,
// loaded without a referrer like profile pictures) on a round background, or the award symbol.
// Decorative: the badge's name is always written next to it.
export function BadgeIcon({ image, size = 40, className }: { image?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [image])
  const show = image && !failed
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400", className)}
      style={{ width: size, height: size }}
    >
      {show ? (
        // Badge images are loaded as they are, like profile pictures (components/ui/avatar.tsx).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" referrerPolicy="no-referrer" decoding="async" loading="lazy" draggable={false} onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <Award style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={1.75} />
      )}
    </span>
  )
}
