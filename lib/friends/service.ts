import { onInboxRecord, type Opened } from "../profile/inbox.ts"
import { getSession, getSigner } from "../profile/session.ts"
import { changeFriends, FriendsError } from "./list.ts"
import { readFriendMessage, sendFriendMessage, unsendFriendMessage } from "./messages.ts"
import { acceptFriend, acceptReceived, askFriend, findFriend, removeFriend, removeReceived, requestReceived, type Change, type Friends } from "./model.ts"

// What the person does with friends (ask, accept, decline, end) and what arrives for them: each
// a change of the private record (./list.ts) by the rules in ./model.ts, with the message the
// rules call for (./messages.ts). The message is handed to the outbox (which keeps and retries
// it) inside the change, once the version on the relays was read and before it is written: so
// nothing goes out while the record can't be changed, and if the write fails after all, the
// message is taken back. Screens learn of changes through onFriendsChange.

const listeners = new Set<() => void>()

export function onFriendsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const changed = () => {
  for (const listener of listeners) listener()
}

async function me() {
  const session = getSession()
  if (!session) throw new FriendsError("switched", "no profile is signed in")
  return { pubkey: session.pubkey, signer: await getSigner() }
}

// Whether the message went out now, or waits in the outbox for a connection; null when the
// change called for none.
export type Sent = { published: boolean | null }

type Plan<S extends string> = (friends: Friends, now: number) => Change<S>

async function act<S extends "request" | "accept" | "remove">(pubkey: string, plan: Plan<S>, relays: readonly string[]): Promise<Sent> {
  const self = await me()
  // Set inside the change (a callback: the type system doesn't follow it, a box does).
  const out: { sent: { published: boolean; id: string } | null } = { sent: null }
  try {
    await changeFriends(self.pubkey, async (friends, now) => {
      const next = plan(friends, now)
      if (next.full) throw new FriendsError("full", "the list holds as many people as it can")
      if (next.friends === friends) return friends
      if (next.send) out.sent = await sendFriendMessage(`friend.${next.send}` as const, { pubkey, relays: [...relays, ...(findFriend(friends, pubkey)?.relays ?? [])] }, self.signer)
      return next.friends
    })
  } catch (error) {
    if (out.sent) await unsendFriendMessage(out.sent.id).catch(() => {})
    throw error
  }
  changed()
  retryArrivals()
  return { published: out.sent?.published ?? null }
}

// "Als Freund hinzufügen": a request, or the accept when the person asked first.
export const requestFriend = (pubkey: string, relays: readonly string[] = []) => act(pubkey, (friends, now) => askFriend(friends, pubkey, now, relays), relays)

export const acceptFriendRequest = (pubkey: string) => act(pubkey, (friends, now) => acceptFriend(friends, pubkey, now), [])

// Declining a request, withdrawing one's own, ending a friendship: the entry goes; the other
// side hears of it unless it was their request (./model.ts removeFriend).
export const removeFriendship = (pubkey: string) => act(pubkey, (friends, now) => removeFriend(friends, pubkey, now), [])

// ---- What arrives ----------------------------------------------------------------------------

// Messages the record couldn't take yet (this device hasn't synced, no relay answered, the clock
// was behind): once more when the record is there (retryArrivals: after a load or a change of
// the list, and when the connection comes back).
const STALLED_MAX = 100
const STALLS: ReadonlySet<string> = new Set(["no-key", "offline", "clock"])
const stalled: Opened[] = []
let following = false

async function arrived(opened: Opened) {
  const { rumor, sender, reader } = opened
  if (getSession()?.pubkey !== reader.pubkey) return
  const message = readFriendMessage(rumor, sender, reader.pubkey)
  if (!message) return
  const out: { sent: { id: string } | null } = { sent: null }
  try {
    await changeFriends(reader.pubkey, async (friends) => {
      const next =
        message.type === "friend.request" ? requestReceived(friends, sender, rumor.created_at, message.message)
        : message.type === "friend.accept" ? acceptReceived(friends, sender, rumor.created_at)
        : removeReceived(friends, sender, rumor.created_at)
      if (next.friends === friends) return friends
      // A failed accept aborts the change (no entry without the word to the other side); the
      // arrival is kept and tried again.
      if (next.send) out.sent = await sendFriendMessage("friend.accept", { pubkey: sender, relays: findFriend(next.friends, sender)?.relays ?? [] }, reader.signer)
      return next.friends
    })
  } catch (error) {
    if (out.sent) await unsendFriendMessage(out.sent.id).catch(() => {})
    if (!(error instanceof FriendsError) || STALLS.has(error.problem)) {
      stalled.push(opened)
      if (stalled.length > STALLED_MAX) stalled.shift()
    }
    return
  }
  changed()
}

export function retryArrivals() {
  for (const opened of stalled.splice(0)) void arrived(opened)
}

// Reads the friend messages the profile's inbox hands over (lib/profile/inbox.ts); once.
export function followFriendInbox() {
  if (following) return
  following = true
  for (const type of ["friend.request", "friend.accept", "friend.remove"]) onInboxRecord(type, (opened) => arrived(opened))
  if (typeof window !== "undefined") window.addEventListener("online", retryArrivals)
}
