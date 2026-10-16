"use client"

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
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { useOwnEvents } from "@/components/profile/use-profile"
import { profilePlayers } from "@/lib/profile/claim"
import { readMetadata } from "@/lib/profile/metadata"
import { OWN } from "@/lib/profile/own-events"
import type { Session } from "@/lib/profile/session"
import { usePlayers } from "@/lib/storage/hooks"

// "Damit wird „Name“ auf diesem Gerät abgemeldet", before another profile signs in
// (./sign-in-guard.tsx). It answers exactly once: Abbrechen, Escape and the backdrop close it
// with no; "Abmelden und wechseln" answers yes and leaves the dialog to the guard, which takes
// it down (left to itself, the action would close the dialog too, and a closing dialog says no).
export default function ReplaceDialog({ existing, onAnswer }: { existing: Session; onAnswer: (replace: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const r = tx.replace
  const events = useOwnEvents(existing.pubkey)
  const directory = usePlayers()
  const name = readMetadata(events?.get(OWN.metadata)).name ?? (directory && profilePlayers(existing.pubkey, directory, []).player?.name) ?? tx.unnamed

  return (
    <AlertDialog open onOpenChange={(open) => !open && onAnswer(false)}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">{r.title(name)}</AlertDialogTitle>
          <AlertDialogDescription>
            {existing.kind === "local" && <span className="mb-2 block font-medium text-foreground">{tx.signOut.localWarning}</span>}
            {r.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              onAnswer(true)
            }}
            className="h-11 bg-danger text-white hover:bg-danger/90"
          >
            {r.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
