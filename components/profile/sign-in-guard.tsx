"use client"

import { lazy, Suspense, useState, type ReactNode } from "react"
import { SessionError, type Session, type SessionOptions } from "@/lib/profile/session"

// Signing in while another profile is signed in on this device (all along, or meanwhile in
// another tab): that profile is signed out, and a key kept only here is lost with it. Nobody is
// signed out without seeing this first: lib/profile/session.ts refuses the start, and the
// person decides here, with the profile named. The dialog loads only when it is asked, so the
// guest's result screen carries this hook without it.

type Commit = (options: SessionOptions) => Promise<unknown>

interface Asking {
  existing: Session
  commit: Commit
  // Settles the sign-in: with the answer, or with the commit's promise so its error reaches
  // the caller.
  settle: (outcome: boolean | Promise<boolean>) => void
}

const ReplaceDialog = lazy(() => import("@/components/profile/replace-dialog"))

// signIn runs the commit; refused for another profile, it asks and runs the commit again with
// replace. Resolves false when the person keeps the profile that is signed in. A commit that
// fails rejects, whether it was asked first or not.
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

  // The dialog answers each question once (./replace-dialog.tsx) and goes away with the answer.
  const answer = (replace: boolean) => {
    if (!asking) return
    setAsking(null)
    asking.settle(replace ? asking.commit({ replace: true }).then(() => true) : false)
  }

  return {
    signIn,
    dialog: asking && (
      <Suspense fallback={null}>
        <ReplaceDialog existing={asking.existing} onAnswer={answer} />
      </Suspense>
    ),
  }
}
