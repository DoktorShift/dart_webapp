"use client"

import { getSession, loadSession, subscribeSession } from "@/lib/profile/session"

// How an area's store (clubs, tournaments) follows the profile on this device: `start` reads the
// local copies every time and asks relays once per profile, on the first start and again
// whenever another profile signs in (or the profile signs out).
//
//   const start = followProfile(readLocal, refreshAll)
//   useEffect(() => void start(), [])
export function followProfile(load: () => Promise<void>, refresh: () => Promise<void>): () => Promise<void> {
  let following = false
  // Who relays were last asked for (pubkey, "" for a guest); undefined: never.
  let refreshedFor: string | undefined
  const start = async () => {
    if (!following) {
      following = true
      let last = getSession()?.pubkey ?? null
      subscribeSession(() => {
        const next = getSession()?.pubkey ?? null
        if (next === last) return
        last = next
        void start()
      })
    }
    await load()
    const key = (await loadSession())?.pubkey ?? ""
    if (refreshedFor === key) return
    refreshedFor = key
    await refresh()
  }
  return start
}
