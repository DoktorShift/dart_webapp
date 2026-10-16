"use client"

import { useEffect, useSyncExternalStore } from "react"
import { getSession, loadSession, subscribeSession } from "@/lib/profile/session"

// How an area's store (clubs, tournaments) follows the profile on this device: `start` reads the
// local copies every time and asks relays once per profile, on the first start and again
// whenever another profile signs in (or the profile signs out). Used through profileStore below.
function followProfile(load: () => Promise<void>, refresh: () => Promise<void>): () => Promise<void> {
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

// An area's store that follows the profile: its snapshot, and the hook every screen of the area
// reads it with. The first screen to read it starts it (followProfile); every `set` re-renders
// them all.
export function profileStore<S>(empty: S, load: () => Promise<void>, refresh: () => Promise<void>) {
  const start = followProfile(load, refresh)
  const listeners = new Set<() => void>()
  let snapshot = empty
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  return {
    get: () => snapshot,
    set(next: S) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    useSnapshot(): S {
      useEffect(() => {
        void start()
      }, [])
      return useSyncExternalStore(subscribe, () => snapshot, () => empty)
    },
  }
}
