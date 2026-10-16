"use client"

import { useEffect, useSyncExternalStore } from "react"
import type { NostrEvent } from "@/lib/nostr/types"
import { readMetadata } from "@/lib/profile/metadata"
import { OWN } from "@/lib/profile/own-events"
import { cachedProfile, loadProfiles } from "@/lib/profile/public-profile"
import { getSession } from "@/lib/profile/session"
import { OWN_OBJECT_PREFIX } from "@/lib/profile/storage-keys"
import { dbGet, type Keyed } from "@/lib/storage/db"

// Names and pictures of people a club or a tournament names only by key, from their public
// profiles, asked for all at once (loadProfiles). What this device has shows first; the relays
// are asked once per person and page load. A key no relay had a profile for yet (a player who
// just made one) is asked again when a screen needs it next, when the device is back online and
// when the app is back in view. The signed-in profile's own name comes from its own metadata as
// kept here (lib/profile/own-events.ts), read anew whenever a screen needs it: the player sees
// their own name at once, as they last set it. Unknown stays unknown ("Ohne Namen" with the start
// of the key), never a made-up name.

export interface NameInfo {
  name: string | null
  picture: string | null
}

const UNKNOWN: NameInfo = { name: null, picture: null }
const known = new Map<string, NameInfo>()
// Keys being looked up now, and keys relays had no profile for.
const asking = new Set<string>()
const unanswered = new Set<string>()
let version = 0
const listeners = new Set<() => void>()
let retrying = false

function remember(pubkey: string, metadata: Parameters<typeof readMetadata>[0]) {
  const { name, picture } = readMetadata(metadata)
  known.set(pubkey, { name: name ?? null, picture: picture ?? null })
  version += 1
  for (const listener of listeners) listener()
}

async function ownMetadata(pubkey: string): Promise<NostrEvent | null> {
  const stored = await dbGet<Keyed & { event: NostrEvent }>("objects", `${OWN_OBJECT_PREFIX}${OWN.metadata}`).catch(() => undefined)
  return stored?.event.pubkey === pubkey ? stored.event : null
}

async function lookup(pubkeys: string[]) {
  for (const p of pubkeys) asking.add(p)
  const self = getSession()?.pubkey
  const others: string[] = []
  for (const pubkey of pubkeys) {
    const own = pubkey === self ? await ownMetadata(pubkey) : null
    if (own) {
      remember(pubkey, own)
      continue
    }
    const cached = await cachedProfile(pubkey).catch(() => null)
    if (cached?.metadata) remember(pubkey, cached.metadata)
    others.push(pubkey)
  }
  const profiles = others.length > 0 ? await loadProfiles(others).catch(() => new Map()) : new Map()
  for (const [pubkey, profile] of profiles) if (profile.metadata) remember(pubkey, profile.metadata)
  for (const p of pubkeys) {
    asking.delete(p)
    if (known.has(p)) unanswered.delete(p)
    else unanswered.add(p)
  }
}

// From the first screen that asks on: the keys relays had no profile for are asked again once
// the device is online and the app in view.
function retryUnanswered() {
  if (retrying) return
  retrying = true
  const again = () => {
    const keys = [...unanswered].filter((p) => !asking.has(p))
    if (document.visibilityState === "visible" && keys.length > 0) void lookup(keys)
  }
  window.addEventListener("online", again)
  document.addEventListener("visibilitychange", again)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The keys among `people` that share their shown name with another key (letter case and spaces
// around do not tell them apart): they get the start of the key as a hint (lib/nostr/pointers.ts).
export function sameNames(people: readonly { pubkey: string; name: string }[]): ReadonlySet<string> {
  const byName = new Map<string, Set<string>>()
  for (const { pubkey, name } of people) {
    const key = name.normalize("NFC").trim().toLowerCase()
    byName.set(key, (byName.get(key) ?? new Set()).add(pubkey))
  }
  return new Set([...byName.values()].filter((keys) => keys.size > 1).flatMap((keys) => [...keys]))
}

// The name and picture of each key, as far as known.
export function useProfileNames(pubkeys: readonly string[]): (pubkey: string) => NameInfo {
  useSyncExternalStore(subscribe, () => version, () => 0)
  const key = pubkeys.join(",")
  useEffect(() => {
    retryUnanswered()
    const self = getSession()?.pubkey
    const missing = key.split(",").filter((p) => p && !asking.has(p) && (!known.has(p) || p === self))
    if (missing.length > 0) void lookup(missing)
  }, [key])
  return (pubkey) => known.get(pubkey) ?? UNKNOWN
}
