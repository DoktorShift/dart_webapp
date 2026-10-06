import { isAddressableKind, isReplaceableKind, query } from "../nostr/client.ts"
import { loadCore } from "../nostr/core.ts"
import { generalRelays, mergeRelays, profileRelays } from "../nostr/relays.ts"
import type { EventTemplate, Filter, NostrEvent } from "../nostr/types.ts"
import { ownEvents, ownRelaySettings, rememberOwn } from "../profile/own-events.ts"
import type { LoadStatus } from "../profile/public-profile.ts"
import { ownReadRelays } from "../profile/relay-list.ts"
import { OWN_OBJECT_PREFIX } from "../profile/session.ts"
import { KIND_PROFILE_BADGES_LEGACY, type ProfileBadge } from "../protocol/badges.ts"
import { KIND_BADGE_AWARD, KIND_BADGE_DEFINITION, KIND_PROFILE_BADGES, KIND_RECORD } from "../protocol/kinds.ts"
import { tagValue, tagValues } from "../protocol/tags.ts"
import { dbGetAll, dbWrite, type Keyed } from "../storage/db.ts"
import { publishOwn } from "../sync/publish.ts"
import { validAwards, withoutDeleted, type ValidAward } from "./awards.ts"
import { currentSelection, isSelectionEvent, selectionTemplate, type Selection } from "./selection.ts"

// The badges of the signed-in profile, on this device and on relays: what it was given and what
// it gave, the definitions behind them, its evidence records, deletion requests and its list
// (kind 10008, or the former 30008). Its own replaceable events (its definitions, its list) are
// kept as the profile's own events (lib/profile/own-events.ts); everything else under
// "own:badge:<event id>". So all of it goes with the profile when it signs out (session.ts),
// and with the device's data file (lib/storage/data.ts).
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

const isBadgeKind = (event: NostrEvent) => event.kind === KIND_BADGE_DEFINITION || isSelectionEvent(event)

// Everything this device keeps about the profile's badges, without what was asked to be deleted.
export async function storedBadgeEvents(pubkey: string): Promise<NostrEvent[]> {
  const [stored, own] = await Promise.all([dbGetAll<StoredEvent>("objects"), ownEvents(pubkey)])
  const records = stored.filter((s) => s.id.startsWith(PREFIX)).map((s) => s.event)
  return withoutDeleted(await signedOnly([...records, ...[...own.values()].filter(isBadgeKind)]))
}

async function keep(pubkey: string, events: readonly NostrEvent[]) {
  const replaceable = (e: NostrEvent) => isReplaceableKind(e.kind) || isAddressableKind(e.kind)
  await rememberOwn(pubkey, events.filter((e) => e.pubkey === pubkey && replaceable(e)))
  await dbWrite(events.filter((e) => e.pubkey !== pubkey || !replaceable(e)).map((event) => ({ store: "objects", put: { id: `${PREFIX}${event.id}`, event } as Keyed })))
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
// they arrive, on a known one what changed elsewhere (a badge given, another app's change to the
// list). Deletion requests are kept only for badge events.
export async function fetchBadges(pubkey: string): Promise<LoadStatus> {
  const relays = await relaysOf(pubkey)
  const first = await query(
    [
      { authors: [pubkey], kinds: [KIND_BADGE_AWARD, KIND_BADGE_DEFINITION, KIND_PROFILE_BADGES, KIND_DELETION] },
      { authors: [pubkey], kinds: [KIND_PROFILE_BADGES_LEGACY], "#d": ["profile_badges"] },
      { authors: [pubkey], kinds: [KIND_RECORD], "#l": ["badge.evidence"] },
      { kinds: [KIND_BADGE_AWARD], "#p": [pubkey] },
    ],
    relays,
  )
  const received = first.events.filter((e) => e.kind === KIND_BADGE_AWARD && e.pubkey !== pubkey)
  const second = received.length > 0 ? await query(behind(received), relays) : null
  const found = [...first.events, ...(second?.events ?? [])]
  const badgeIds = new Set(found.filter((e) => e.kind !== KIND_DELETION).map((e) => e.id))
  await keep(
    pubkey,
    found.filter((e) => e.kind !== KIND_DELETION || tagValues(e.tags, "e").some((id) => badgeIds.has(id))),
  )
  return loadStatus(first.answered.length, first.failed.length + (second?.failed.length ?? 0))
}

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
  return { awards: inListOrder(selection, await validAwards([...awards.events, ...more.events], pubkey)).slice(0, limit), status: loadStatus(lists.answered.length, lists.failed.length + awards.failed.length + more.failed.length) }
}

// The valid awards a list names, in the list's order (each once).
export function inListOrder(selection: Selection, awards: readonly ValidAward[]): ValidAward[] {
  const byId = new Map(awards.map((a) => [a.award.id, a]))
  return [...new Set(selection.badges.map((b) => byId.get(b.award)).filter((a): a is ValidAward => a !== undefined))]
}

// ---- Changes ------------------------------------------------------------------------------

// Signs, keeps and publishes new badge events of the profile (definitions, evidence, awards,
// deletion requests, its list); the signed events come back.
export async function publishBadgeEvents(pubkey: string, templates: readonly EventTemplate[]): Promise<NostrEvent[]> {
  if (templates.length === 0) return []
  const events = (await publishOwn(templates)).map((report) => report.event)
  await keep(pubkey, events)
  return events
}

// The profile's list as it is now: the newest of relays and this device. Changes start from it,
// so a change made in another app meanwhile is kept (PLAN.md: "Die globale Profilauswahl wird
// nur nach Lesen und Zusammenführen verändert"). null when no relay answered: then nothing is
// changed.
export async function latestSelection(pubkey: string): Promise<Selection | null> {
  const latest = await query(
    [
      { authors: [pubkey], kinds: [KIND_PROFILE_BADGES] },
      { authors: [pubkey], kinds: [KIND_PROFILE_BADGES_LEGACY], "#d": ["profile_badges"] },
    ],
    await relaysOf(pubkey),
  )
  if (latest.answered.length === 0) return null
  await keep(pubkey, latest.events)
  return currentSelection([...latest.events, ...(await storedBadgeEvents(pubkey))], pubkey)
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
