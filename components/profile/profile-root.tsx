"use client"

import type { ReactNode } from "react"
import { OwnProfileView } from "@/components/profile/own-profile"
import { useOwnProfile } from "@/components/profile/use-profile"

// The Profile tab (registry slot "profile.root"): the signed-in profile, or the shell's guest
// view. Nothing at all while the session is still being read, so a guest never flashes by.
export default function ProfileRoot({ fallback }: { fallback: ReactNode }) {
  const own = useOwnProfile()
  if (own === undefined) return null
  if (own === null) return fallback
  // Name and figures come from this device: wait for them rather than show "no name" first.
  if (!own.events || !own.history.loaded) return null
  return <OwnProfileView own={own} />
}
