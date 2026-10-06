import { isAddressableKind, isReplaceableKind, query } from "../nostr/client.ts"
import { loadCore } from "../nostr/core.ts"
import { generalRelays, mergeRelays, profileRelays } from "../nostr/relays.ts"
import type { EventTemplate, Filter, NostrEvent } from "../nostr/types.ts"
import { changeBase, OWN, ownEvents, OwnEventsError, ownRelaySettings, rememberOwn } from "../profile/own-events.ts"
import type { LoadStatus } from "../profile/public-profile.ts"
import { ownReadRelays } from "../profile/relay-list.ts"
import { onSessionEnd, OWN_OBJECT_PREFIX } from "../profile/session.ts"
import { KIND_PROFILE_BADGES_LEGACY, type ProfileBadge } from "../protocol/badges.ts"
import { KIND_BADGE_AWARD, KIND_BADGE_DEFINITION, KIND_PROFILE_BADGES, KIND_RECORD } from "../protocol/kinds.ts"
import { tagValue, tagValues } from "../protocol/tags.ts"
import { dbGetAll, dbWrite, kvGet, kvSet, type Keyed } from "../storage/db.ts"
import { submitOwn } from "../sync/publish.ts"
import { validAwards, withoutDeleted, type ValidAward } from "./awards.ts"
import { currentSelection, isSelectionEvent, selectionOf, selectionTemplate, type Selection } from "./selection.ts"

// The badges of the signed-in profile, on this device and on relays: what it was given and what
// it gave, the definitions behind them, its evidence records and deletion requests. Its own
// replaceable events (its definitions, its list of shown badges) are the profile's own events
// (lib/profile/own-events.ts); everything else is kept under "own:badge:<event id>". So all of
// it goes with the profile when it signs out (session.ts), and into the device's data file
// (./export.ts).
//
// Everything that is published goes through lib/sync/publish.ts. A change counts once it is
// signed and kept here; relays that can't be reached don't undo it.

const PREFIX = `${OWN_OBJECT_PREFIX}badge:`
export const KIND_DELETION = 5

interface StoredEvent {
  id: string
  event: NostrEvent
}

// Read back from storage, every event's signature is checked (once per page load): a data file
// brings events in that nobody has checked.
const checked = new Set<string>()
async function signedOnly(events: readonly NostrEvent[]): Promise<NostrEvent[]> {
  const unchecked = events.filter((e) => !checked.has(e.id))
  if (unchecked.length > 0) {
    const core = await loadCore()
    for (const event of unchecked) if (core.verifyEventSignature(event)) checked.add(event.id)
  }
  return events.filter((e) => checked.has(e.id))
}

const isReplaceable = (event: NostrEvent) => isReplaceableKind(event.kind) || isAddressableKind(event.kind)
const isBadgeKind = (event: NostrEvent) => event.kind === KIND_BADGE_DEFINITION || isSelectionEvent(event)

// Everything this device keeps about the profile's badges, without what was asked to be deleted.
export async function storedBadgeEvents(pubkey: string): Promise<NostrEvent[]> {
  const [stored, own] = await Promise.all([dbGetAll<StoredEvent>("objects"), ownEvents(pubkey)])
  const records = stored.filter((s) => s.id.startsWith(PREFIX)).map((s) => s.event)
  return withoutDeleted(await signedOnly([...records, ...[...own.values()].filter(isBadgeKind)]))
}

// Keeps events about the profile's badges: its own replaceable ones as its own events, the rest
// as badge records.
export async function keepBadgeEvents(pubkey: string, events: readonly NostrEvent[]) {
  await rememberOwn(pubkey, events.filter((e) => e.pubkey === pubkey && isReplaceable(e)))
  await dbWrite(events.filter((e) => e.pubkey !== pubkey || !isReplaceable(e)).map((event) => ({ store: "objects", put: { id: `${PREFIX}${event.id}`, event } as Keyed })))
}

// Where the profile's badges may be: every relay its own events may be on.
export const relaysOf = async (pubkey: string) => ownReadRelays(ownRelaySettings(await ownEvents(pubkey)))

// The definitions awards point at, and their issuers' deletion requests.
function behind(awards: readonly NostrEvent[]): Filter[] {
  if (awards.length === 0) return []
  const byIssuer = new Map<string, Set<string>>()
  for (const award of awards) {
    const [, issuer, ...d] = (tagValue(award.tags, "a") ?? "").split(":")
    if (issuer === award.pubkey) (byIssuer.get(issuer) ?? byIssuer.set(issuer, new Set()).get(issuer)!).add(d.join(":"))
  }
  return [
    ...[...byIssuer].map(([issuer, ds]): Filter => ({ kinds: [KIND_BADGE_DEFINITION], authors: [issuer], "#d": [...ds] })),
    { kinds: [KIND_DELETION], authors: [...new Set(awards.map((a) => a.pubkey))], "#e": awards.map((a) => a.id) },
  ]
}

const loadStatus = (answered: number, failed: number): LoadStatus => (answered === 0 ? "offline" : failed > 0 ? "partial" : "complete")

// Looks for the profile's badges on relays and keeps what it finds: on a new device this is how
// they arrive, on a known one what changed elsewhere (a badge given). The list of shown badges
// comes with the profile's own events (own-events.ts lookupOwnEvents). Deletion requests are
// kept only for badge events.
export async function fetchBadges(pubkey: string): Promise<LoadStatus> {
  const relays = await relaysOf(pubkey)
  const first = await query(
    [
      { authors: [pubkey], kinds: [KIND_BADGE_AWARD, KIND_BADGE_DEFINITION, KIND_DELETION] },
      { authors: [pubkey], kinds: [KIND_RECORD], "#l": ["badge.evidence"] },
      { kinds: [KIND_BADGE_AWARD], "#p": [pubkey] },
    ],
    relays,
  )
  const received = first.events.filter((e) => e.kind === KIND_BADGE_AWARD && e.pubkey !== pubkey)
  const second = received.length > 0 ? await query(behind(received), relays) : null
  const found = [...first.events, ...(second?.events ?? [])]
  const badgeIds = new Set(found.filter((e) => e.kind !== KIND_DELETION).map((e) => e.id))
  await keepBadgeEvents(
    pubkey,
    found.filter((e) => e.kind !== KIND_DELETION || tagValues(e.tags, "e").some((id) => badgeIds.has(id))),
  )
  return loadStatus(first.answered.length, first.failed.length + (second?.failed.length ?? 0))
}

// Fetched once per profile and page load, like the profile's own events; again when nothing
// answered, or when asked (`again`, on opening the badges).
const fetched = new Map<string, Promise<LoadStatus>>()
onSessionEnd(() => fetched.clear())
export function lookupBadges(pubkey: string, { again = false } = {}): Promise<LoadStatus> {
  const running = fetched.get(pubkey)
  if (running && !again) return running
  const next = fetchBadges(pubkey).then(
    (status) => {
      if (status === "offline") fetched.delete(pubkey)
      return status
    },
    (): LoadStatus => {
      fetched.delete(pubkey)
      return "offline"
    },
  )
  fetched.set(pubkey, next)
  return next
}

// ---- Other players' badges --------------------------------------------------------------------

// Other profiles' badges shown on this page (their profile cards), for a badge's own screen.
// Never stored.
const shownElsewhere = new Map<string, ValidAward>()
export const shownElsewhereAward = (id: string): ValidAward | undefined => shownElsewhere.get(id)

// Another profile's shown badges, in its order, each checked before it is shown; at most `limit`.
export async function shownBadges(pubkey: string, hints: readonly string[] = [], limit = Infinity): Promise<{ awards: ValidAward[]; status: LoadStatus }> {
  const relays = mergeRelays(profileRelays(), generalRelays(), hints)
  const lists = await query(
    [
      { authors: [pubkey], kinds: [KIND_PROFILE_BADGES] },
      { authors: [pubkey], kinds: [KIND_PROFILE_BADGES_LEGACY], "#d": ["profile_badges"] },
    ],
    relays,
  )
  const selection = currentSelection(lists.events, pubkey)
  if (selection.badges.length === 0) return { awards: [], status: loadStatus(lists.answered.length, lists.failed.length) }
  const awards = await query([{ ids: selection.badges.map((b) => b.award), kinds: [KIND_BADGE_AWARD] }], mergeRelays(relays, selection.badges.flatMap((b) => b.awardRelay ?? [])))
  const more = await query(behind(awards.events), mergeRelays(relays, selection.badges.flatMap((b) => b.addressRelay ?? [])))
  const shown = inListOrder(selection, await validAwards([...awards.events, ...more.events], pubkey)).slice(0, limit)
  for (const award of shown) shownElsewhere.set(award.award.id, award)
  return { awards: shown, status: loadStatus(lists.answered.length, lists.failed.length + awards.failed.length + more.failed.length) }
}

// The valid awards a list names, in the list's order (each once).
export function inListOrder(selection: Selection, awards: readonly ValidAward[]): ValidAward[] {
  const byId = new Map(awards.map((a) => [a.award.id, a]))
  return [...new Set(selection.badges.map((b) => byId.get(b.award)).filter((a): a is ValidAward => a !== undefined))]
}

// ---- What the person has seen -----------------------------------------------------------------

// Awards from others the person has looked at (kv, gone with the profile): the rest are new.
const SEEN_KEY = "profile.badges.seen"
export const seenAwardIds = async (): Promise<string[]> => (await kvGet<string[]>(SEEN_KEY).catch(() => undefined)) ?? []
export const markAwardsSeen = (ids: readonly string[]) => kvSet(SEEN_KEY, [...ids])

// ---- Changes ----------------------------------------------------------------------------------

// Signs, keeps and sends new badge events of the profile (definitions, evidence, awards, deletion
// requests, its list); the signed events come back as soon as they are signed and kept.
export async function publishBadgeEvents(pubkey: string, templates: readonly EventTemplate[]): Promise<NostrEvent[]> {
  if (templates.length === 0) return []
  const { events } = await submitOwn(templates)
  await keepBadgeEvents(pubkey, events)
  return events
}

// The profile's list as a change builds on it: the current one once relays were asked (own-events.ts
// changeBase, so a change made in another app meanwhile is kept, PLAN.md: "Die globale
// Profilauswahl wird nur nach Lesen und Zusammenführen verändert"), else the former one. null
// when nothing is known here and no relay answered: then nothing is changed.
export async function latestSelection(pubkey: string): Promise<Selection | null> {
  try {
    const base = (await changeBase(pubkey, OWN.profileBadges)) ?? (await ownEvents(pubkey)).get(OWN.legacyProfileBadges) ?? null
    return selectionOf(base)
  } catch (error) {
    if (error instanceof OwnEventsError) return null
    throw error
  }
}

// Publishes the list with these badges, if that changes it.
export async function writeSelection(pubkey: string, selection: Selection, badges: readonly ProfileBadge[]) {
  const same = badges.length === selection.badges.length && badges.every((b, i) => b.award === selection.badges[i].award)
  if (!same) await publishBadgeEvents(pubkey, [selectionTemplate(selection, badges)])
}

// A deletion request (NIP-09) for the profile's own badge events: relays and apps that honour it
// drop them; nobody can be made to (decision 0001, "Was ohne Backend nicht möglich ist", 3).
export function deletionTemplate(events: readonly NostrEvent[], reason: string, created_at: number): EventTemplate {
  return {
    kind: KIND_DELETION,
    created_at,
    tags: [...events.map((e) => ["e", e.id]), ...[...new Set(events.map((e) => String(e.kind)))].map((k) => ["k", k])],
    content: reason,
  }
}
