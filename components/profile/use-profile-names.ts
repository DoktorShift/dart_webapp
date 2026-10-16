"use client"

import { useEffect, useSyncExternalStore } from "react"
import { readMetadata } from "@/lib/profile/metadata"
import { cachedProfile, loadProfiles } from "@/lib/profile/public-profile"

// Names and pictures of the people in a club, from their public profiles: a club's records name
// only keys. What this device has shows first; the relays are asked once per person and page
// load. Unknown stays unknown ("Ohne Namen" with the start of the key), never a made-up name.

export interface NameInfo {
  name: string | null
  picture: string | null
}

const UNKNOWN: NameInfo = { name: null, picture: null }
const known = new Map<string, NameInfo>()
const asked = new Set<string>()
let version = 0
const listeners = new Set<() => void>()

function remember(pubkey: string, metadata: Parameters<typeof readMetadata>[0]) {
  const { name, picture } = readMetadata(metadata)
  known.set(pubkey, { name: name ?? null, picture: picture ?? null })
  version += 1
  for (const listener of listeners) listener()
}

async function lookup(pubkeys: string[]) {
  for (const pubkey of pubkeys) {
    const cached = await cachedProfile(pubkey).catch(() => null)
    if (cached?.metadata) remember(pubkey, cached.metadata)
  }
  const profiles = await loadProfiles(pubkeys).catch(() => new Map())
  for (const [pubkey, profile] of profiles) if (profile.metadata) remember(pubkey, profile.metadata)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The name and picture of each key, as far as known.
export function useNames(pubkeys: readonly string[]): (pubkey: string) => NameInfo {
  useSyncExternalStore(subscribe, () => version, () => 0)
  const key = pubkeys.join(",")
  useEffect(() => {
    const missing = key.split(",").filter((p) => p && !asked.has(p))
    if (missing.length === 0) return
    for (const p of missing) asked.add(p)
    void lookup(missing)
  }, [key])
  return (pubkey) => known.get(pubkey) ?? UNKNOWN
}
