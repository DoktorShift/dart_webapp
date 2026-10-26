import { HEX64 } from "../protocol/tags.ts"

// Who is a friend, as the profile's private record "friends" holds it (./list.ts): one entry per
// person, by profile key, in one of three states. A friendship is mutual, like Game Center's:
// one side asks, the other accepts; until then the asking side has "sent" and the asked side
// "received". Either side may end it. Names are never kept here; they come from the person's
// public profile when shown.
//
// Messages arrive late, twice, or out of order (relays replay the last days at every start), so
// the record also remembers, per person, the time of the last word that counted: a message
// older than that is stale and changes nothing. Every function hands back the same `friends`
// object when nothing changed, so callers can skip the write.

export type FriendState = "friend" | "sent" | "received"

export interface FriendEntry {
  pubkey: string
  state: FriendState
  // When the entry got this state (unix seconds).
  since: number
  // Relays the person's profile link named, so a message finds them (at most two).
  relays?: string[]
  // The line that came with a received request.
  message?: string
}

export interface Friends {
  entries: FriendEntry[]
  // Per person: the time of the last message from them or action of mine that counted.
  handled: Record<string, number>
}

export const EMPTY_FRIENDS: Friends = { entries: [], handled: {} }
export const MAX_FRIENDS = 500
// People remembered beyond the entries (declined, removed), newest kept.
const MAX_HANDLED = 1000
const MAX_RELAYS = 2
const MAX_MESSAGE = 140
const STATES: readonly FriendState[] = ["friend", "sent", "received"]

export type Change<S extends string | null = null> = { friends: Friends; send: S | null; full?: true }

// The entries of a record's data, those that have the shape; the rest is left out.
export function friendsOf(data: Record<string, unknown> | null): Friends {
  const raw = (data as { friends?: unknown; handled?: unknown } | null)?.friends
  if (!Array.isArray(raw)) return EMPTY_FRIENDS
  const seen = new Set<string>()
  const entries: FriendEntry[] = []
  for (const f of raw as Partial<FriendEntry>[]) {
    if (typeof f?.pubkey !== "string" || !HEX64.test(f.pubkey) || seen.has(f.pubkey)) continue
    if (!STATES.includes(f.state as FriendState) || !Number.isInteger(f.since)) continue
    seen.add(f.pubkey)
    const relays = Array.isArray(f.relays) ? f.relays.filter((r): r is string => typeof r === "string" && r.startsWith("wss://")).slice(0, MAX_RELAYS) : []
    entries.push({ pubkey: f.pubkey, state: f.state as FriendState, since: f.since as number, ...(relays.length > 0 ? { relays } : {}), ...(typeof f.message === "string" && f.message.trim() ? { message: f.message.trim().slice(0, MAX_MESSAGE) } : {}) })
    if (entries.length === MAX_FRIENDS) break
  }
  const handled: Record<string, number> = {}
  const rawHandled = (data as { handled?: unknown }).handled
  if (rawHandled && typeof rawHandled === "object") {
    for (const [pubkey, at] of Object.entries(rawHandled as Record<string, unknown>)) if (HEX64.test(pubkey) && Number.isInteger(at)) handled[pubkey] = at as number
  }
  return { entries, handled: prune(handled, entries) }
}

export const friendsData = (friends: Friends): Record<string, unknown> => ({ friends: friends.entries, handled: friends.handled })

export const findFriend = (friends: Friends, pubkey: string) => friends.entries.find((f) => f.pubkey === pubkey) ?? null

export const byState = (friends: Friends, state: FriendState) => friends.entries.filter((f) => f.state === state)

// Keeps the people with an entry and, of the rest, the newest.
function prune(handled: Record<string, number>, entries: readonly FriendEntry[]): Record<string, number> {
  const keys = Object.keys(handled)
  if (keys.length <= MAX_HANDLED) return handled
  const kept = new Set(entries.map((f) => f.pubkey))
  const rest = keys.filter((k) => !kept.has(k)).sort((a, b) => handled[b] - handled[a])
  const keep = new Set([...kept, ...rest.slice(0, Math.max(0, MAX_HANDLED - kept.size))])
  return Object.fromEntries(keys.filter((k) => keep.has(k)).map((k) => [k, handled[k]]))
}

// Older than the last word that counted. The same second is not older: two sides acting at once
// (crossed requests) must still hear each other; an exact replay then changes nothing below.
const stale = (friends: Friends, pubkey: string, at: number) => at < (friends.handled[pubkey] ?? -Infinity)
function withEntries(friends: Friends, entries: FriendEntry[], pubkey: string, at: number): Friends {
  const stamp = Math.max(at, friends.handled[pubkey] ?? 0)
  if (entries === friends.entries && friends.handled[pubkey] === stamp) return friends
  return { entries, handled: prune({ ...friends.handled, [pubkey]: stamp }, entries) }
}
// The entries without the person; the same array when they weren't in it (then nothing changed).
const without = (friends: Friends, pubkey: string) => (findFriend(friends, pubkey) ? friends.entries.filter((f) => f.pubkey !== pubkey) : friends.entries)
const put = (friends: Friends, entry: FriendEntry, at: number): Friends => withEntries(friends, [...without(friends, entry.pubkey), entry], entry.pubkey, at)
const drop = (friends: Friends, pubkey: string, at: number): Friends => withEntries(friends, without(friends, pubkey), pubkey, at)
const full = (friends: Friends, pubkey: string) => friends.entries.length >= MAX_FRIENDS && !findFriend(friends, pubkey)

// ---- What I do ----------------------------------------------------------------------------------

// I ask: the person is "sent". Asking someone who asked me is accepting.
export function askFriend(friends: Friends, pubkey: string, now: number, relays: readonly string[] = []): Change<"request" | "accept"> {
  const known = findFriend(friends, pubkey)
  if (known?.state === "friend" || known?.state === "sent") return { friends, send: null }
  if (known?.state === "received") return { friends: put(friends, { pubkey, state: "friend", since: now, ...(known.relays ? { relays: known.relays } : {}) }, now), send: "accept" }
  if (full(friends, pubkey)) return { friends, send: null, full: true }
  const hints = relays.slice(0, MAX_RELAYS)
  return { friends: put(friends, { pubkey, state: "sent", since: now, ...(hints.length > 0 ? { relays: hints } : {}) }, now), send: "request" }
}

// I accept a received request.
export function acceptFriend(friends: Friends, pubkey: string, now: number): Change<"accept"> {
  const known = findFriend(friends, pubkey)
  if (known?.state !== "received") return { friends, send: null }
  // The line that came with the request has done its part.
  return { friends: put(friends, { pubkey, state: "friend", since: now, ...(known.relays ? { relays: known.relays } : {}) }, now), send: "accept" }
}

// I end it, withdraw my request, or decline theirs. Only a friendship or my own request is
// worth telling the other side; a declined request stays quiet, as Game Center's does.
export function removeFriend(friends: Friends, pubkey: string, now: number): Change<"remove"> {
  const known = findFriend(friends, pubkey)
  if (!known) return { friends, send: null }
  return { friends: drop(friends, pubkey, now), send: known.state === "received" ? null : "remove" }
}

// ---- What arrives (`at`: when the sender wrote it) ------------------------------------------------

// A request arrived: the person is "received", unless I asked them too (then we are friends and
// I answer with an accept) or we are friends already.
export function requestReceived(friends: Friends, pubkey: string, at: number, message?: string): Change<"accept"> {
  if (stale(friends, pubkey, at)) return { friends, send: null }
  const known = findFriend(friends, pubkey)
  if (known?.state === "friend" || known?.state === "received") return { friends: withEntries(friends, friends.entries, pubkey, at), send: null }
  if (known?.state === "sent") return { friends: put(friends, { ...known, state: "friend", since: at }, at), send: "accept" }
  if (full(friends, pubkey)) return { friends, send: null, full: true }
  return { friends: put(friends, { pubkey, state: "received", since: at, ...(message?.trim() ? { message: message.trim().slice(0, MAX_MESSAGE) } : {}) }, at), send: null }
}

// An accept arrived for a request I sent.
export function acceptReceived(friends: Friends, pubkey: string, at: number): Change {
  if (stale(friends, pubkey, at)) return { friends, send: null }
  const known = findFriend(friends, pubkey)
  return { friends: known?.state === "sent" ? put(friends, { ...known, state: "friend", since: at }, at) : withEntries(friends, friends.entries, pubkey, at), send: null }
}

// The other side ended it, or withdrew their request.
export function removeReceived(friends: Friends, pubkey: string, at: number): Change {
  if (stale(friends, pubkey, at)) return { friends, send: null }
  return { friends: drop(friends, pubkey, at), send: null }
}
