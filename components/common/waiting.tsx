import type { ReactNode } from "react"
import { LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"

// A wait of unknown length (a board or another device that has to answer): the words with a
// turning symbol, so the screen is seen to be at work; the symbol stands still under Reduce
// Motion. VoiceOver reads the words when they appear.
export function Waiting({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" className={cn("flex items-center justify-center gap-2 py-12 text-center text-[0.9375rem] text-muted-foreground", className)}>
      <LoaderCircle className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      {children}
    </p>
  )
}
