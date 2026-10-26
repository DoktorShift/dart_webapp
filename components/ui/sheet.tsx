"use client"

import type { ReactNode } from "react"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { cn } from "@/lib/utils"

// A bottom sheet for a focused task that can be dismissed (HIG: sheets). Used during a game
// and for the install guide. Content that can be long brings its own scroll area. While a task
// must not be left half-way (a game moving to another device), `dismissible` false keeps the
// sheet until its own buttons close it, without the grabber that would invite a swipe.
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  dismissible = true,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  dismissible?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} dismissible={dismissible} shouldScaleBackground={false}>
      <DrawerContent handle={dismissible} className={cn("mx-auto max-h-[92dvh] max-w-lg border-border [@media(max-height:500px)]:h-[100dvh] [@media(max-height:500px)]:max-h-[100dvh] [@media(max-height:500px)]:rounded-none", className)}>
        <div className="flex min-h-0 flex-col px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <DrawerHeader className="px-0 text-left">
            <DrawerTitle className="text-xl">{title}</DrawerTitle>
            {description && <DrawerDescription className="text-[0.9375rem]">{description}</DrawerDescription>}
          </DrawerHeader>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

// The sheet's content when it can be longer than the sheet: it scrolls on its own, and buttons
// placed after it stay in view. Room at its end, so a button at the bottom is never cut through
// its label by a pinned one after it on a small phone.
export function SheetBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-h-0 overflow-y-auto overscroll-contain pb-4", className)}>{children}</div>
}

// The sheet's buttons after its body: pinned under the scrolling content, with a fade above them
// that shows there is more, so the one thing to do is always in reach, keyboard or landscape
// notwithstanding. In compact height they stand side by side, the primary one on the right,
// and leave the height to the content.
export function SheetActions({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("relative grid shrink-0 gap-2 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-gradient-to-t before:from-background before:to-transparent [@media(max-height:500px)]:grid-flow-col-dense [@media(max-height:500px)]:auto-cols-fr [@media(max-height:500px)]:[direction:rtl] [@media(max-height:500px)]:*:[direction:ltr]", className)}>{children}</div>
}
