import { query } from "../nostr/client.ts"
import { createdAt } from "../nostr/time.ts"
import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import { badgeAwardTemplate, badgeD, badgeDefinitionTemplate } from "../protocol/badges.ts"
import { KIND_BADGE_AWARD, KIND_BADGE_DEFINITION } from "../protocol/kinds.ts"
import { buildRecord } from "../protocol/records.ts"
import { tagValue, tagValues } from "../protocol/tags.ts"
import { newObjectId } from "../storage/ids.ts"
import { withoutDeleted } from "./awards.ts"
import { ORGANIZER_BADGES, RECOGNITION_VERSION, type OrganizerBadgeId } from "./catalog.ts"
import { deletionTemplate, KIND_DELETION, publishBadgeEvents, relaysOf, storedBadgeEvents } from "./store.ts"

// Badges an organizer gives (decision 0001, F3; PLAN.md "Cluberfolg", "Turniererfolg",
// "Anerkennung"): from their own device, with their own key, to the players with a profile.
//
// - A tournament: the winner, the finalist (the loser of the final, in formats that end with
//   one) and every participant. Issued by whoever finished it (lib/protocol mayIssueTournamentBadge).
// - A club season: the winner (first in the final table) and everyone who played at least the
//   games the season's rules ask for a place in the table ("Regelmäßig dabei"). Issued by whoever
//   ended the season, an owner or admin then (mayIssueClubBadge).
//
// The record that ended it is every award's evidence, and the tournament's or season's id its
// occasion, so a badge counts once per player however often it is sent (A23). Before sending,
// what was already given is read from this device and from relays, and only what is missing goes
// out. When a correction changes the result afterwards, the awards that no longer fit can be
// withdrawn with a deletion request; the ones now missing are given like before.

// The end of a tournament or a club season, as the tournaments and clubs areas hand it over
// from their closing screens (issueAwards).
export interface BadgeOccasion {
  scope: "tournament" | "club"
  // The tournament id, or the club id.
  scopeId: string
  // What the awards are for: the tournament id again, or the season id.
  occasionId: string
  // The tournament's or the season's name, for the badges' texts.
  name: string
  // The record that ended it (tournament.phase "finished", club.season.end) and who signed it.
  ended: { event: string; by: string; at: number }
  // Final places of the players with a profile (place 1 is the winner), with the games counted
  // for them.
  places: { pubkey: string; place: number; games: number }[]
  // A tournament whose format ends with a final: place 2 lost it.
  final?: boolean
  // A season: counted games its rules ask for a place in the table.
  minGames?: number
}

export interface PlannedAward {
  badge: OrganizerBadgeId
  recipient: string
}

// Who gets which badge for the occasion, from its final places.
export function plannedAwards(o: BadgeOccasion): PlannedAward[] {
  const badgesOf = (p: BadgeOccasion["places"][number]): OrganizerBadgeId[] => {
    if (o.scope === "tournament")
      return [...(p.place === 1 ? (["tournament-winner"] as const) : []), ...(p.place === 2 && o.final ? (["tournament-finalist"] as const) : []), "tournament-participant"]
    if (p.games < Math.max(1, o.minGames ?? 0)) return []
    return [...(p.place === 1 ? (["season-winner"] as const) : []), "season-regular"]
  }
  return o.places.flatMap((p) => badgesOf(p).map((badge) => ({ badge, recipient: p.pubkey })))
}

const occasionBadges = (o: BadgeOccasion) => (Object.keys(ORGANIZER_BADGES) as OrganizerBadgeId[]).filter((b) => ORGANIZER_BADGES[b].scope === o.scope)
const dOf = (o: BadgeOccasion, badge: OrganizerBadgeId) => badgeD({ badge, version: ORGANIZER_BADGES[badge].version, scope: o.scope, scopeId: o.scopeId })

export interface IssuedAward {
  award: NostrEvent
  badge: OrganizerBadgeId
  recipient: string
}

// The awards `issuer` gave for this occasion, among `events`.
function issuedFor(events: readonly NostrEvent[], issuer: string, o: BadgeOccasion): IssuedAward[] {
  const byAddress = new Map(occasionBadges(o).map((badge) => [`${KIND_BADGE_DEFINITION}:${issuer}:${dOf(o, badge)}`, badge]))
  return events.flatMap((award) => {
    const badge = byAddress.get(tagValue(award.tags, "a") ?? "")
    const recipients = tagValues(award.tags, "p")
    if (award.kind !== KIND_BADGE_AWARD || award.pubkey !== issuer || !badge || tagValue(award.tags, "occasion") !== o.occasionId || recipients.length !== 1) return []
    return [{ award, badge, recipient: recipients[0] }]
  })
}

export interface AwardPlan {
  // Given already and still right.
  given: IssuedAward[]
  // Still to give.
  missing: PlannedAward[]
  // Given, but the result changed since: these no longer fit.
  stale: IssuedAward[]
}

export function awardPlan(events: readonly NostrEvent[], issuer: string, o: BadgeOccasion): AwardPlan {
  const planned = plannedAwards(o)
  const issued = issuedFor(events, issuer, o)
  const fits = (i: IssuedAward) => planned.some((p) => p.badge === i.badge && p.recipient === i.recipient)
  const given = issued.filter(fits)
  return {
    given: [...new Map(given.map((i) => [`${i.badge}|${i.recipient}`, i])).values()],
    missing: planned.filter((p) => !given.some((i) => i.badge === p.badge && i.recipient === p.recipient)),
    stale: issued.filter((i) => !fits(i)),
  }
}

// What the issuer's device and relays know about the awards for this occasion. null: no relay
// answered, so what was given from another device can't be told apart from what is missing.
export async function currentPlan(issuer: string, o: BadgeOccasion): Promise<AwardPlan | null> {
  const addresses = occasionBadges(o).map((badge) => `${KIND_BADGE_DEFINITION}:${issuer}:${dOf(o, badge)}`)
  const found = await query(
    [
      { authors: [issuer], kinds: [KIND_BADGE_AWARD], "#a": addresses },
      { authors: [issuer], kinds: [KIND_DELETION], "#k": [String(KIND_BADGE_AWARD)] },
    ],
    await relaysOf(issuer),
  )
  if (found.answered.length === 0) return null
  return awardPlan(withoutDeleted([...found.events, ...(await storedBadgeEvents(issuer))]), issuer, o)
}

export type BadgeTexts = (badge: OrganizerBadgeId, occasionName: string) => { name: string; description: string }

// Gives what is missing for the occasion, with the definitions not yet published. Only who ended
// the tournament or season gives its badges. null when no relay answered (nothing was sent).
export async function issueAwards(issuer: string, o: BadgeOccasion, texts: BadgeTexts): Promise<{ given: number; known: number } | null> {
  if (o.ended.by !== issuer) throw new Error("only who ended it gives its badges")
  const plan = await currentPlan(issuer, o)
  if (!plan) return null
  if (plan.missing.length === 0) return { given: 0, known: plan.given.length }
  const events = await storedBadgeEvents(issuer)
  const defined = (badge: OrganizerBadgeId) => events.some((e) => e.kind === KIND_BADGE_DEFINITION && e.pubkey === issuer && tagValue(e.tags, "d") === dOf(o, badge))
  const badges = [...new Set(plan.missing.map((p) => p.badge))]
  const templates: EventTemplate[] = [
    ...badges.filter((b) => !defined(b)).map((badge) => badgeDefinitionTemplate({ badge, version: ORGANIZER_BADGES[badge].version, scope: o.scope, scopeId: o.scopeId, ...texts(badge, o.name) }, createdAt())),
    ...plan.missing.map(({ badge, recipient }) => badgeAwardTemplate({ issuer, d: dOf(o, badge), recipient, evidence: o.ended.event, occasion: o.occasionId }, createdAt())),
  ]
  await publishBadgeEvents(issuer, templates)
  return { given: plan.missing.length, known: plan.given.length }
}

// Withdraws awards that no longer fit the result, with one deletion request.
export async function withdrawAwards(issuer: string, stale: readonly IssuedAward[], reason: string) {
  if (stale.length > 0) await publishBadgeEvents(issuer, [deletionTemplate(stale.map((s) => s.award), reason, createdAt())])
}

// A recognition ("Helfer beim Clubabend"): a badge of the issuer's own naming for one person, with
// the issuer's words as evidence. Its id is new each time, so it is its own badge and occasion.
export async function giveRecognition(issuer: string, recipient: string, texts: { name: string; description: string; note: string }) {
  const id = newObjectId()
  const badge = { badge: `recognition-${id}`, version: RECOGNITION_VERSION, scope: "recognition" as const }
  const d = badgeD(badge)
  const [, evidence] = await publishBadgeEvents(issuer, [
    badgeDefinitionTemplate({ ...badge, name: texts.name, description: texts.description }, createdAt()),
    buildRecord("badge.evidence", { badge: d, note: texts.note }, { created_at: createdAt() }),
  ])
  const [award] = await publishBadgeEvents(issuer, [badgeAwardTemplate({ issuer, d, recipient, evidence: evidence.id, occasion: id }, createdAt())])
  return award
}
