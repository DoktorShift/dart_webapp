"use client"

import { startInbox, stopInbox } from "@/lib/profile/inbox"
import { getSession, getSigner, loadSession, subscribeSession } from "@/lib/profile/session"
import { featureOn } from "@/lib/shell/features"

// Opens the profile's inbox (lib/profile/inbox.ts) for as long as a profile with a key on this
// device is signed in, and closes it when it signs out. Started by the profile area's start
// task once a profile is stored (./register.ts). The areas that read from it register their
// readers themselves; the friends' reader is started here too, so a request arriving while no
// friends screen was ever opened still lands in the list.
export function followSessionInbox() {
  // One change of session at a time: a sign-out can't be overtaken by the start it interrupted.
  let run: Promise<void> = Promise.resolve()
  const apply = () => {
    run = run.then(async () => {
      const session = await loadSession()
      if (!session || session.kind !== "local") return stopInbox()
      const signer = await getSigner().catch(() => null)
      if (!signer?.nip44 || getSession()?.pubkey !== session.pubkey) return stopInbox()
      if (featureOn("friends")) {
        const { followFriendInbox } = await import("@/lib/friends/service")
        followFriendInbox()
      }
      if (getSession()?.pubkey === session.pubkey) startInbox({ pubkey: session.pubkey, signer })
    }).catch(() => {
      // A failed start (a chunk that didn't load offline) must not keep later changes from running.
    })
  }
  subscribeSession(apply)
  apply()
}
