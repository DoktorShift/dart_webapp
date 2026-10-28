import { useId } from "react"
import type { GameType } from "@/lib/game/types"
import { cn } from "@/lib/utils"

// Three distinct, dart-specific symbols. They are decorative: the adjacent mode name is the label.
export function GameModeIcon({ type, className }: { type: GameType; className?: string }) {
  const id = useId().replace(/:/g, "")
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("block", className)} fill="none">
      <defs>
        <linearGradient id={`${id}-shine`} x1="8" y1="7" x2="55" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity=".34" /><stop offset="1" stopColor="currentColor" stopOpacity=".04" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="19" fill={`url(#${id}-shine)`} stroke="currentColor" strokeOpacity=".28" />
      {type === "x01" && <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="30" cy="34" r="16" strokeWidth="2" opacity=".85" /><circle cx="30" cy="34" r="9" strokeWidth="1.5" opacity=".65" /><circle cx="30" cy="34" r="2.5" fill="currentColor" stroke="none" />
        <path d="m30 34 17-17m-7 0 7 0 0 7m-5-7 4-5 6 0 0 6-5 4" strokeWidth="2.1" />
      </g>}
      {type === "cricket" && <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 21h6m-6 10h6m-6 10h6" strokeWidth="2" opacity=".65" /><path d="m29 24 7-7m-7 17 7-7m-7 17 7-7" strokeWidth="2.6" /><path d="m37 17 7 7m-7 3 7 7m-7 3 7 7" strokeWidth="2.6" /><circle cx="37" cy="44" r="7" strokeWidth="2" />
      </g>}
      {type === "clock" && <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="32" cy="32" r="17" strokeWidth="2" opacity=".75" /><path d="M32 20v12l8 5" strokeWidth="2.7" /><path d="M32 12v3m20 17h-3m-17 20v-3M12 32h3" strokeWidth="1.7" /><path d="M43 13a23 23 0 0 1 9 9m-1-7 1 7-7-1" strokeWidth="1.8" />
      </g>}
    </svg>
  )
}
