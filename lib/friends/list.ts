import { nowSeconds } from "../nostr/time.ts"
import { smallRecord, type Loaded } from "../sync/small-record.ts"
import { EMPTY_FRIENDS, friendsData, friendsOf, type Friends } from "./model.ts"

// The profile's friends as a private record on its relays (docs/protocol/families/private-records.md,
// type "friends"; lib/sync/small-record.ts), so every device of the profile shows the same
// people and the same open requests. Relays see an opaque record, never who is whose friend.
// This device keeps its last copy in kv "profile.friends", which goes with the profile.

export const FRIENDS_RECORD = "friends"
export const FRIENDS_KEY = "profile.friends"

const record = smallRecord<Friends, Record<string, never>>({
  id: FRIENDS_RECORD,
  key: FRIENDS_KEY,
  read: friendsOf,
  write: friendsData,
  emptyLocal: {},
})

export type FriendsLoaded = Loaded<Friends, Record<string, never>>

export const loadFriends = (pubkey: string) => record.load(pubkey)

// This device's copy, without asking relays: what a screen shows first.
export const storedFriends = async (pubkey: string): Promise<Friends | null> => (await record.copy(pubkey))?.value ?? null

// Changes the list on the version the relays hold now; `edit` gets it and the time, and hands
// back the same object when nothing is to change (then nothing is written).
export const changeFriends = (pubkey: string, edit: (friends: Friends, now: number) => Friends | Promise<Friends>) =>
  record.change(pubkey, async ({ value }) => {
    const current = value ?? EMPTY_FRIENDS
    const next = await edit(current, nowSeconds())
    return next === current ? null : { value: next }
  })

export { SmallRecordError as FriendsError } from "../sync/small-record.ts"
