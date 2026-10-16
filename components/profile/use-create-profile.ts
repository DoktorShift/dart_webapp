"use client"

import { useState } from "react"
import { createProfile } from "@/components/profile/create-profile"
import { useSignInGuard } from "@/components/profile/sign-in-guard"

// The "Profil anlegen" button's work, shared by the Profile tab (./create-screen.tsx) and the
// result screen's offer (./keep-sheet.tsx): asks first when another profile is signed in here,
// stays busy until the profile exists (the screen moves on then), and reports a failure plainly.
// `create` resolves true once the profile exists; a second tap while busy does nothing.
// `dialog` is rendered by the caller.
export function useCreateProfile() {
  const { signIn, dialog } = useSignInGuard()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const create = async (input: Parameters<typeof createProfile>[0]) => {
    if (busy) return false
    setBusy(true)
    setFailed(false)
    try {
      const done = await signIn((options) => createProfile(input, options))
      if (!done) setBusy(false)
      return done
    } catch {
      setFailed(true)
      setBusy(false)
      return false
    }
  }

  return { create, busy, failed, dialog }
}
