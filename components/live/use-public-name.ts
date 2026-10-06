"use client"

import { useEffect, useState } from "react"
import { readMetadata } from "@/lib/profile/metadata"
import { cachedProfile, loadPublicProfile } from "@/lib/profile/public-profile"

// The name and picture a connected player's profile shows, for their row: the copy kept on this
// device at once, the relays' answer when it comes. Null for a guest, and while nothing is known;
// the seat's own name stands in meanwhile, and nothing waits for it.
export function usePublicName(pubkey: string | null): { name: string | null; picture: string | null } | null {
  const [found, setFound] = useState<{ pubkey: string; name: string | null; picture: string | null } | null>(null)
  useEffect(() => {
    if (!pubkey) return
    let current = true
    const show = (event: Parameters<typeof readMetadata>[0]) => {
      if (current && event) setFound({ pubkey, ...readMetadata(event) })
    }
    void cachedProfile(pubkey).then((p) => show(p?.metadata), () => {})
    void loadPublicProfile(pubkey).then(({ profile }) => show(profile.metadata), () => {})
    return () => {
      current = false
    }
  }, [pubkey])
  return found && found.pubkey === pubkey ? { name: found.name, picture: found.picture } : null
}
