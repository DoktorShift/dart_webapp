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
      <DrawerContent handle={dismissible} className={cn("mx-auto max-h-[92dvh] max-w-lg border-border", className)}>
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
// placed after it stay in view.
export function SheetBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">{children}</div>
}
