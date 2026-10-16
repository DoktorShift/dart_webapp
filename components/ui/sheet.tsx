"use client"

import type { ReactNode } from "react"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { cn } from "@/lib/utils"

// A bottom sheet for a focused task that can be dismissed (HIG: sheets). Used during a game
// and for the install guide. Content that can be long brings its own scroll area.
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent className={cn("mx-auto max-h-[92dvh] max-w-lg border-border", className)}>
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
