import { createdAt, latestEvents } from "../nostr/client.ts"
import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import { KIND_PROFILE_BADGES_LEGACY, otherProfileTags, profileBadgesTemplate, readProfileBadges, type ProfileBadge } from "../protocol/badges.ts"
import { KIND_PROFILE_BADGES } from "../protocol/kinds.ts"

// The badges a profile shows (NIP-58 kind 10008), in their order. The list belongs to every app
// of the profile: BlueLine shows the first three valid ones on the profile card, and when it
// changes the list (show, hide, arrange), every other entry and tag stays as it was (PLAN.md:
// "bestehende Auswahl und Reihenfolge anderer Apps erhalten").
//
// A profile that only has the former list (kind 30008 with d=profile_badges) shows that one; the
// first change writes it as kind 10008, with everything it held (lib/protocol/badges.ts drops
// only the old d tag). The former list itself is left alone for apps that still read it.

export const SHOWN_ON_CARD = 3

export interface Selection {
  badges: ProfileBadge[]
  // Tags of the list that are no readable badge pair; written back unchanged.
  other: string[][]
  // The list this was read from: the current one, or the former one when there is no current.
  base: NostrEvent | null
}

export const EMPTY_SELECTION: Selection = { badges: [], other: [], base: null }

export const isSelectionEvent = (event: NostrEvent) => readProfileBadges(event) !== null

// The list in its base event; empty without one.
export const selectionOf = (base: NostrEvent | null): Selection => (base ? { badges: readProfileBadges(base) ?? [], other: otherProfileTags(base) ?? [], base } : EMPTY_SELECTION)

// The profile's list among `events` (any copies, both formats): the newest current one, else
// the newest former one.
export function currentSelection(events: readonly NostrEvent[], pubkey: string): Selection {
  const own = events.filter((e) => e.pubkey === pubkey && isSelectionEvent(e))
  return selectionOf(latestEvents(own.filter((e) => e.kind === KIND_PROFILE_BADGES))[0] ?? latestEvents(own.filter((e) => e.kind === KIND_PROFILE_BADGES_LEGACY))[0] ?? null)
}

// First in the list, so it shows on the card right away.
export const withBadge = (selection: Selection, badge: ProfileBadge): ProfileBadge[] => [badge, ...selection.badges.filter((b) => b.award !== badge.award)]

export const withoutBadges = (selection: Selection, awardIds: readonly string[]): ProfileBadge[] => selection.badges.filter((b) => !awardIds.includes(b.award))

// The list with these badges in this order. They take the places they had among themselves;
// every other entry (another app's, one that couldn't be read) stays where it is.
export function reordered(selection: Selection, awardIds: readonly string[]): ProfileBadge[] {
  const byId = new Map(selection.badges.map((b) => [b.award, b]))
  const order = awardIds.filter((id) => byId.has(id))
  let next = 0
  return selection.badges.map((b) => (order.includes(b.award) ? (byId.get(order[next++]) as ProfileBadge) : b))
}

// The new list as a kind 10008 template, after the one it changes.
export const selectionTemplate = (selection: Selection, badges: readonly ProfileBadge[]): EventTemplate =>
  profileBadgesTemplate(badges, createdAt(selection.base?.created_at), selection.other)
