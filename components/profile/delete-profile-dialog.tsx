"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { deleteProfile, type DeleteOutcome } from "@/lib/profile/delete-profile"

// "Profil löschen" (lib/profile/delete-profile.ts): says what goes and what nobody can promise,
// then deletes. Cancel is the safe default (HIG). Without a connection or a signature nothing is
// deleted, and the dialog says so; when this device couldn't be emptied completely it says that
// with Daten › Löschen's words. Lives in ./profile-root.tsx, which stays when the session ends.
export default function DeleteProfileDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const d = useAreaT(PROFILE_TEXTS).deleteProfile
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Exclude<DeleteOutcome, "deleted"> | null>(null)

  const run = async () => {
    setBusy(true)
    const outcome = await deleteProfile().catch((): DeleteOutcome => "offline")
    setBusy(false)
    if (outcome === "deleted") onClose()
    else setProblem(outcome)
  }

  if (problem) {
    const [title, text] =
      problem === "partly" ? [t.data.wipeFailedTitle, t.data.wipeFailed] : problem === "signer" ? [d.signerTitle, d.signer] : [d.offlineTitle, d.offline]
    return (
      <AlertDialog open onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="h-11">{t.data.ok}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{d.title}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block">{d.description}</span>
            <span className="mt-2 block text-[0.8125rem]">{d.note}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button variant="secondary" disabled={busy} onClick={() => void run()} className="h-11 whitespace-normal font-semibold text-danger" aria-live="polite">
            {busy ? d.busy : d.confirm}
          </Button>
          <AlertDialogCancel disabled={busy} className="mt-0 h-11 border-0 bg-primary font-semibold text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground">
            {t.common.cancel}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
