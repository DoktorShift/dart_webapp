"use client"

import { profileStore } from "@/components/profile/follow-profile"
import { loadFriends, storedFriends } from "@/lib/friends/list"
import { EMPTY_FRIENDS, type Friends } from "@/lib/friends/model"
import { followFriendInbox, onFriendsChange, retryArrivals } from "@/lib/friends/service"
import { loadSession } from "@/lib/profile/session"
import { featureOn } from "@/lib/shell/features"
import { onStorageChange } from "@/lib/storage/db"
import type { RecordState } from "@/lib/sync/small-record"

// The friends of the signed-in profile for every screen that shows them: this device's copy at
// once, the relays' version once per profile, and again after every change made here or arrived
// through the inbox (lib/friends/service.ts).
export interface FriendsSnapshot {
  pubkey: string | null
  // Null until this device has a copy; a guest has none.
  friends: Friends | null
  loaded: boolean
  // Null before the relays were asked; false while the list can't be kept on relays yet.
  available: boolean | null
  state: RecordState | null
}

const EMPTY: FriendsSnapshot = { pubkey: null, friends: null, loaded: false, available: null, state: null }
let watching = false

// Relays are asked once per profile (profileStore), which at app start can be before this
// device's sync entry or a connection is there: then again, after 3 s, then 6, up to a minute,
// until a relay answered with the list available.
const RETRY_MIN_MS = 3_000
const RETRY_MAX_MS = 60_000
let retryIn = RETRY_MIN_MS
let retry: ReturnType<typeof setTimeout> | null = null

function retryLater() {
  if (retry) return
  retry = setTimeout(() => {
    retry = null
    void refresh()
  }, retryIn)
  retryIn = Math.min(retryIn * 2, RETRY_MAX_MS)
}

async function load() {
  const session = await loadSession()
  if (!session || !featureOn("friends")) return store.set({ ...EMPTY, loaded: true })
  const friends = await storedFriends(session.pubkey).catch(() => null)
  const current = store.get()
  const known = current.pubkey === session.pubkey ? current : EMPTY
  // No copy is kept while the record doesn't exist yet: what the relays answered (an empty
  // list) stays, instead of turning unknown again on every change of the store.
  store.set({ ...known, pubkey: session.pubkey, friends: friends ?? (known.available ? known.friends : null), loaded: true })
}

async function refresh() {
  watch()
  const session = await loadSession()
  if (!session || !featureOn("friends")) return
  followFriendInbox()
  const loaded = await loadFriends(session.pubkey).catch(() => null)
  if (!loaded || !loaded.available || loaded.state === "unavailable") retryLater()
  else retryIn = RETRY_MIN_MS
  if (!loaded || store.get().pubkey !== session.pubkey) return
  store.set({ pubkey: session.pubkey, friends: loaded.value ?? (loaded.available ? EMPTY_FRIENDS : null), loaded: true, available: loaded.available, state: loaded.state })
  // Messages that arrived before the record could take them.
  if (loaded.available && loaded.state !== "unavailable") retryArrivals()
}

function watch() {
  if (watching) return
  watching = true
  onFriendsChange(() => void load())
  if (typeof window !== "undefined") window.addEventListener("online", () => void refresh())
  onStorageChange((message) => {
    if (message.type !== "wipe" && !message.stores.includes("kv")) return
    // The list waits for the profile's data key on a device that is still syncing: once more
    // from the relays when something in the store changed, else only this device's copy.
    if (store.get().available === false) void refresh()
    else void load()
  })
}

const store = profileStore<FriendsSnapshot>(EMPTY, load, refresh)

export function useFriends(): FriendsSnapshot & { reload: () => Promise<void> } {
  const snapshot = store.useSnapshot()
  return { ...snapshot, reload: refresh }
}
