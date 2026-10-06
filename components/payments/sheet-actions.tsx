import type { ReactNode } from "react"

// The buttons that end a payment step. Inside a sheet that scrolls (iPhone SE, phones in
// landscape) they stay in view at its bottom, so the one action that matters is never scrolled away.
export function SheetActions({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-10 mt-5 flex flex-col gap-2 bg-background pt-3">{children}</div>
}
