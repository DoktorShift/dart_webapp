// Lists that never lose entries: NIP-51 (public and private items), NIP-65 relay lists and
// NIP-58 profile badges. To be upstreamed to nostr-core (gaps NC-09, NC-15, NC-16):
// - nostr-core's parseList returns an empty private list when it can't decrypt, and its
//   template drops private items when no key is given, so read, edit, publish wipes them. Here
//   the private part has an explicit status, and writing refuses to replace what couldn't be read.
// - parseRelayList throws on one malformed URL; here bad entries are skipped and reported.
// - Profile badges are read from 10008 and the deprecated 30008 "profile_badges", and written as
//   10008 keeping every tag that isn't a badge pair (badge sets, other clients' additions).
// Unknown tags are always kept.
import { createdAt } from "../time.ts"
import { normalizeRelayUrl } from "../relays.ts"
import { isSignerFailure } from "./crypto.ts"
import type { EventTemplate, NostrEvent, Signer } from "../types.ts"

// "none": no private part. "decrypted": read. "undecryptable": there is a private part this
// signer can't read (other key, damaged). "unavailable": the signer didn't decrypt it this time
// (declined, no answer, out of reach); asking again may work. "no-key": there is one, but no
// signer able to decrypt was given.
export type PrivateStatus = "none" | "decrypted" | "undecryptable" | "unavailable" | "no-key"

export interface SafeList {
  kind: number
  identifier: string | undefined
  // Every tag in order, unknown ones included.
  publicTags: string[][]
  privateTags: string[][]
  privateStatus: PrivateStatus
  event: NostrEvent
}

export type ListErrorCode = "private-unreadable" | "cannot-encrypt" | "wrong-author"

export class ListError extends Error {
  code: ListErrorCode
  constructor(code: ListErrorCode, message: string) {
    super(message)
    this.name = "ListError"
    this.code = code
  }
}

const isTagList = (value: unknown): value is string[][] =>
  Array.isArray(value) && value.every((tag) => Array.isArray(tag) && tag.length > 0 && tag.every((part) => typeof part === "string"))

// Reads a list event. Private items are encrypted by the author to themselves, so only the
// author's signer can read them; NIP-04 content (marked by "?iv=") from older clients is read too.
export async function parseListSafe(event: NostrEvent, signer?: Signer | null): Promise<SafeList> {
  const base = {
    kind: event.kind,
    identifier: event.kind >= 30_000 && event.kind < 40_000 ? (event.tags.find((tag) => tag[0] === "d")?.[1] ?? "") : undefined,
    publicTags: event.tags.map((tag) => [...tag]),
    event,
  }
  if (!event.content) return { ...base, privateTags: [], privateStatus: "none" }
  const legacy = event.content.includes("?iv=")
  const decrypt = legacy ? signer?.nip04?.decrypt : signer?.nip44?.decrypt
  if (!signer || !decrypt) return { ...base, privateTags: [], privateStatus: "no-key" }
  const unread = (error: unknown): SafeList => ({ ...base, privateTags: [], privateStatus: isSignerFailure(error) ? "unavailable" : "undecryptable" })
  let pubkey: string
  try {
    pubkey = await signer.getPublicKey()
  } catch (error) {
    return isSignerFailure(error) ? unread(error) : { ...base, privateTags: [], privateStatus: "no-key" }
  }
  if (pubkey !== event.pubkey) return { ...base, privateTags: [], privateStatus: "no-key" }
  let plaintext: string
  try {
    plaintext = await decrypt(event.pubkey, event.content)
  } catch (error) {
    return unread(error)
  }
  try {
    const tags: unknown = JSON.parse(plaintext)
    if (isTagList(tags)) return { ...base, privateTags: tags, privateStatus: "decrypted" }
  } catch {
    // Not JSON: damaged.
  }
  return { ...base, privateTags: [], privateStatus: "undecryptable" }
}

export interface ListDraft {
  kind: number
  // Required for 30000-range sets; put first as the d tag.
  identifier?: string
  publicTags: string[][]
  // Leave out to keep the base's private items unchanged; [] removes them on purpose.
  privateTags?: string[][]
  // The version being replaced, as read. Writing over private items that couldn't be read is
  // refused, so they are never wiped by accident.
  base?: SafeList
  signer?: Signer | null
}

// Builds the event template for a list. Private items are NIP-44 encrypted to the author.
export async function buildListTemplate(draft: ListDraft): Promise<EventTemplate> {
  const { base, signer } = draft
  if (base && (base.privateStatus === "undecryptable" || base.privateStatus === "unavailable" || base.privateStatus === "no-key")) {
    throw new ListError("private-unreadable", "the list has private entries that couldn't be read; writing would erase them")
  }
  const privateTags = draft.privateTags ?? base?.privateTags ?? []
  let content = ""
  if (privateTags.length > 0) {
    if (!signer?.nip44) throw new ListError("cannot-encrypt", "private entries need a signer that can encrypt")
    const pubkey = await signer.getPublicKey()
    if (base && base.event.pubkey !== pubkey) throw new ListError("wrong-author", "this list belongs to another key")
    content = await signer.nip44.encrypt(pubkey, JSON.stringify(privateTags))
  }
  let tags = draft.publicTags.map((tag) => [...tag])
  if (draft.kind >= 30_000 && draft.kind < 40_000) {
    tags = [["d", draft.identifier ?? base?.identifier ?? ""], ...tags.filter((tag) => tag[0] !== "d")]
  }
  return { kind: draft.kind, tags, content, created_at: createdAt(base?.event.created_at) }
}

// --- NIP-65 ----------------------------------------------------------------------------------

export interface RelayEntry {
  url: string
  read: boolean
  write: boolean
}

export interface SafeRelayList {
  relays: RelayEntry[]
  // "r" tags that couldn't be used (bad URL, unknown marker), as found.
  invalid: string[][]
  // Tags other than "r", kept for writing back.
  otherTags: string[][]
}

// Reads a kind 10002 relay list without failing on one bad entry. The same relay listed twice
// (once "read", once "write") becomes one entry with both.
export function parseRelayListSafe(event: NostrEvent): SafeRelayList {
  const relays = new Map<string, RelayEntry>()
  const invalid: string[][] = []
  const otherTags: string[][] = []
  for (const tag of event.tags) {
    if (tag[0] !== "r") {
      otherTags.push([...tag])
      continue
    }
    const url = typeof tag[1] === "string" ? normalizeRelayUrl(tag[1]) : null
    // No marker (or an empty one, as some clients write) means both.
    const marker = tag[2] || undefined
    if (!url || (marker !== undefined && marker !== "read" && marker !== "write")) {
      invalid.push([...tag])
      continue
    }
    const entry = relays.get(url) ?? { url, read: false, write: false }
    entry.read ||= marker !== "write"
    entry.write ||= marker !== "read"
    relays.set(url, entry)
  }
  return { relays: [...relays.values()], invalid, otherTags }
}

// The kind 10002 template for a relay list. Everything of the previous version that isn't in
// `relays` stays: unknown tags, and "r" entries this app can't use (a ws:// relay in someone's
// home network or on Tor, an unknown marker) but another client wrote on purpose. Pass
// dropUnusable only when the person chose to remove those.
export function buildRelayListTemplate(
  relays: readonly RelayEntry[],
  base?: { list: SafeRelayList; event: NostrEvent },
  options: { dropUnusable?: boolean } = {},
): EventTemplate {
  const rTags = relays
    .filter((relay) => relay.read || relay.write)
    .map((relay) => (relay.read && relay.write ? ["r", relay.url] : ["r", relay.url, relay.read ? "read" : "write"]))
  const unusable = options.dropUnusable ? [] : (base?.list.invalid ?? []).map((tag) => [...tag])
  return { kind: 10002, tags: [...rTags, ...unusable, ...(base?.list.otherTags ?? [])], content: "", created_at: createdAt(base?.event.created_at) }
}

// --- NIP-58 profile badges -------------------------------------------------------------------

export interface BadgePair {
  // "30009:<issuer>:<d>"
  definition: string
  award: string
  relay?: string
}

export interface ProfileBadges {
  pairs: BadgePair[]
  // Everything else in order: badge sets (a tags to 30008), unpaired tags, unknown tags.
  otherTags: string[][]
  // Read from the deprecated kind 30008 "profile_badges".
  legacy: boolean
}

export const isProfileBadgesEvent = (event: NostrEvent) =>
  event.kind === 10008 || (event.kind === 30008 && event.tags.some((tag) => tag[0] === "d" && tag[1] === "profile_badges"))

// Reads profile badges: consecutive pairs of an a tag (a badge definition) and an e tag (its
// award), in display order. Unpaired tags are kept but not shown.
export function parseProfileBadges(event: NostrEvent): ProfileBadges | null {
  if (!isProfileBadgesEvent(event)) return null
  const legacy = event.kind === 30008
  const pairs: BadgePair[] = []
  const otherTags: string[][] = []
  const tags = event.tags.filter((tag) => !(legacy && tag[0] === "d"))
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]
    const next = tags[i + 1]
    if (tag[0] === "a" && tag[1]?.startsWith("30009:") && next?.[0] === "e" && /^[0-9a-f]{64}$/.test(next[1] ?? "")) {
      pairs.push({ definition: tag[1], award: next[1], ...(next[2] ? { relay: next[2] } : {}) })
      i++
    } else {
      otherTags.push([...tag])
    }
  }
  return { pairs, otherTags, legacy }
}

// The current format (kind 10008) for a chosen, ordered set of badges. A legacy 30008 base is
// migrated: its other tags move over, its d tag doesn't.
export function buildProfileBadgesTemplate(pairs: readonly BadgePair[], base?: { badges: ProfileBadges; event: NostrEvent }): EventTemplate {
  const pairTags = pairs.flatMap((pair) => [["a", pair.definition], pair.relay ? ["e", pair.award, pair.relay] : ["e", pair.award]])
  return { kind: 10008, tags: [...pairTags, ...(base?.badges.otherTags ?? [])], content: "", created_at: createdAt(base?.event.created_at) }
}
