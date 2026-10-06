"use client"

import { useState, type ReactNode } from "react"
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
import { SessionError, type Session, type SessionOptions } from "@/lib/profile/session"
import { usePlayers } from "@/lib/storage/hooks"

// Signing in while another profile is signed in on this device (all along, or meanwhile in
// another tab): that profile is signed out, and a key kept only here is lost with it. Nobody is
// signed out without seeing this first: lib/profile/session.ts refuses the start, and the
// person decides here, with the profile named.

type Commit = (options: SessionOptions) => Promise<unknown>

interface Asking {
  existing: Session
  commit: Commit
  settle: (done: boolean) => void
}

// signIn runs the commit; refused for another profile, it asks and runs the commit again with
// replace. Resolves false when the person keeps the profile that is signed in. Other errors of
// the commit are the caller's.
export function useSignInGuard(): { signIn: (commit: Commit) => Promise<boolean>; dialog: ReactNode } {
  const [asking, setAsking] = useState<Asking | null>(null)

  const signIn = async (commit: Commit) => {
    try {
      await commit({})
      return true
    } catch (error) {
      if (!(error instanceof SessionError)) throw error
      return new Promise<boolean>((settle) => setAsking({ existing: error.session, commit, settle }))
    }
  }

  const answer = async (replace: boolean) => {
    const current = asking
    setAsking(null)
    if (!current) return
    try {
      if (replace) await current.commit({ replace: true })
      current.settle(replace)
    } catch {
      // The commit failed after all: told where it was started, not here.
      current.settle(false)
    }
  }

  return {
    signIn,
    dialog: asking && <ReplaceDialog existing={asking.existing} onAnswer={(replace) => void answer(replace)} />,
  }
}

function ReplaceDialog({ existing, onAnswer }: { existing: Session; onAnswer: (replace: boolean) => void }) {
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
          <AlertDialogAction onClick={() => onAnswer(true)} className="h-11 bg-danger text-white hover:bg-danger/90">
            {r.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
