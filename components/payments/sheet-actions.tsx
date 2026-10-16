import type { ReactNode } from "react"
import { useMediaQuery } from "@/components/common/use-media-query"
import { cn } from "@/lib/utils"

// Phones in landscape (Tailwind's xshort): a sheet is about 300 px tall there, so the payment
// sheets drop their description and set their buttons side by side, and the result row says less.
export const useLandscapePhone = () => useMediaQuery("(max-height: 500px)")

// The buttons that end a payment step, with the note that belongs to them (what went wrong, what
// a check found). Inside a sheet that scrolls (iPhone SE, phones in landscape) they stay in view
// at its bottom, so the message and the one action that matters are never scrolled away. On a
// phone in landscape the buttons share one row: the first child (the main action) on the right,
// the dismissal on the left, as in an alert.
export function SheetActions({ note, className, children }: { note?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 mt-5 flex flex-col gap-2 bg-background pt-3 xshort:mt-3 xshort:flex-row-reverse xshort:flex-wrap xshort:pt-2 xshort:*:min-w-[calc(50%-0.25rem)] xshort:*:flex-1",
        className,
      )}
    >
      {note && <div className="xshort:basis-full">{note}</div>}
      {children}
    </div>
  )
}
