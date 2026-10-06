"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/i18n-provider"
import { signOut, type SessionKind } from "@/lib/profile/session"

// "Abmelden": ends the session on this device and removes its keys and connections (session.ts).
// On a device others use too, the games here can go with it. A key that only this device has is
// lost with it, and the dialog says so before it happens.
export function SignOutDialog({ open, onOpenChange, kind }: { open: boolean; onOpenChange: (open: boolean) => void; kind: SessionKind }) {
  const t = useT()
  const s = t.profile.signOut
  const [busy, setBusy] = useState(false)

  const leave = async (keepLocalData: boolean) => {
    setBusy(true)
    try {
      await signOut({ keepLocalData })
    } finally {
      setBusy(false)
      onOpenChange(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{s.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {kind === "local" && <span className="mb-2 block font-medium text-foreground">{s.localWarning}</span>}
            {s.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button disabled={busy} onClick={() => void leave(true)} className="h-11 whitespace-normal">
            {s.keep}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void leave(false)} className="h-11 whitespace-normal font-semibold text-danger">
            {s.wipe}
          </Button>
          <AlertDialogCancel disabled={busy} className="mt-0 h-11">
            {t.common.cancel}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
