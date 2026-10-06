"use client"

import { useEffect, useState } from "react"
import { readMetadata } from "@/lib/profile/metadata"
import { cachedProfile, loadPublicProfile } from "@/lib/profile/public-profile"

export interface PublicName {
  name: string | null
  picture: string | null
}

// The names and pictures the connected players' profiles show, by pubkey: the copy kept on this
// device at once, the relays' answer when it comes. Nothing for guests or while nothing is
// known: the seat's own name stands in meanwhile, and nothing waits for it.
export function usePublicNames(pubkeys: readonly (string | null)[]): ReadonlyMap<string, PublicName> {
  const [found, setFound] = useState<ReadonlyMap<string, PublicName>>(new Map())
  const wanted = pubkeys.filter((p): p is string => p !== null).join(",")
  useEffect(() => {
    let current = true
    const show = (pubkey: string, event: Parameters<typeof readMetadata>[0]) => {
      if (current && event) setFound((before) => new Map(before).set(pubkey, readMetadata(event)))
    }
    for (const pubkey of wanted ? wanted.split(",") : []) {
      void cachedProfile(pubkey).then((p) => show(pubkey, p?.metadata), () => {})
      void loadPublicProfile(pubkey).then(({ profile }) => show(pubkey, profile.metadata), () => {})
    }
    return () => {
      current = false
    }
  }, [wanted])
  return found
}

// The first characters of a key, shown next to the picture to tell apart two people who show the
// same name (nostrdesign.org, impostor prevention): "1a2b 3c4d".
export const shortKey = (pubkey: string) => `${pubkey.slice(0, 4)} ${pubkey.slice(4, 8)}`

// The keys among `people` that share their shown name with someone else's key.
export function sameNamed(people: readonly { pubkey: string; name: string }[]): ReadonlySet<string> {
  const byName = new Map<string, Set<string>>()
  for (const { pubkey, name } of people) {
    const key = name.normalize("NFC").trim().toLowerCase()
    byName.set(key, (byName.get(key) ?? new Set()).add(pubkey))
  }
  return new Set([...byName.values()].filter((keys) => keys.size > 1).flatMap((keys) => [...keys]))
}
