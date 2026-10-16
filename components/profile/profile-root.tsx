"use client"

import { lazy, Suspense, useEffect, useState, type ReactNode } from "react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { warmProfileScreens } from "@/components/profile/register"
import { useSession, type SessionKind } from "@/lib/profile/session"

// The Profile tab (registry slot "profile.root"): the signed-in profile, or the shell's guest
// view. Nothing at all while the session is still being read, so a guest never flashes by. The
// signed-in view loads with the first profile on this device, never with a guest's tab. The
// sign-out dialog lives here, not in the signed-in view: that goes the moment the session ends,
// and the dialog may still have to say that not everything was deleted.
const SignedInProfile = lazy(() => import("@/components/profile/own-profile"))
const SignOutDialog = lazyScreen<{ kind: SessionKind; onClose: () => void }>(() => import("@/components/profile/sign-out-dialog"))

export default function ProfileRoot({ fallback }: { fallback: ReactNode }) {
  const session = useSession()
  const signedIn = !!session
  // The kind of the profile being signed out while the dialog is open.
  const [signingOut, setSigningOut] = useState<SessionKind | null>(null)
  // Once a profile is here, its screens that work from this device's data, and the sign-out
  // dialog, are fetched for offline use.
  useEffect(() => {
    if (signedIn) void Promise.all([warmProfileScreens(), SignOutDialog.preload()]).catch(() => {})
  }, [signedIn])
  if (session === undefined) return null
  return (
    <>
      {session === null ? (
        fallback
      ) : (
        <Suspense fallback={null}>
          <SignedInProfile onSignOut={() => setSigningOut(session.kind)} />
        </Suspense>
      )}
      {signingOut && (
        <Suspense fallback={null}>
          <SignOutDialog kind={signingOut} onClose={() => setSigningOut(null)} />
        </Suspense>
      )}
    </>
  )
}
