"use client"

import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { warmProfileScreens } from "@/components/profile/register"
import { useSession } from "@/lib/profile/session"

// The Profile tab (registry slot "profile.root"): the signed-in profile, or the shell's guest
// view. Nothing at all while the session is still being read, so a guest never flashes by. The
// signed-in view loads with the first profile on this device, never with a guest's tab.
const SignedInProfile = lazy(() => import("@/components/profile/own-profile"))

export default function ProfileRoot({ fallback }: { fallback: ReactNode }) {
  const session = useSession()
  const signedIn = !!session
  // Once a profile is here, its screens that work from this device's data are fetched for
  // offline use.
  useEffect(() => {
    if (signedIn) void warmProfileScreens().catch(() => {})
  }, [signedIn])
  if (session === undefined) return null
  if (session === null) return fallback
  return (
    <Suspense fallback={null}>
      <SignedInProfile />
    </Suspense>
  )
}
