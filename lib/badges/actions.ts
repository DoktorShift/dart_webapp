import { createdAt } from "../nostr/time.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { KIND_BADGE_AWARD, KIND_BADGE_DEFINITION } from "../protocol/kinds.ts"
import { tagValue } from "../protocol/tags.ts"
import { validAwards, type ValidAward } from "./awards.ts"
import type { Milestone } from "./catalog.ts"
import type { Achievement } from "./milestones.ts"
import { reordered, withBadge, withoutBadges } from "./selection.ts"
import { awardRestsOn, evidenceFor, milestoneAwardTemplate, milestoneD, milestoneDefinitionTemplate, milestoneEvidenceTemplate } from "./self-award.ts"
import { deletionTemplate, latestSelection, publishBadgeEvents, storedBadgeEvents, writeSelection } from "./store.ts"

// What the person does with their badges (PLAN.md: "„Im Profil zeigen“, „Ausblenden“ und
// „Anordnen“ sind einfache Nutzeraktionen"). Each reads the profile's list from relays first and
// returns "offline" without changing anything when none answered. Signing is asked for one step
// at a time; a step that was done already (a definition, the evidence, the award) is not repeated
// when the person tries again.

export type Outcome = "done" | "offline"

const addressOf = (award: NostrEvent) => tagValue(award.tags, "a") as string

export interface MilestoneToShow {
  milestone: Milestone
  achieved: Achievement
  // The badge's name and meaning, as its definition is published.
  texts: { name: string; description: string }
}

// "Im Profil zeigen" for milestones reached on this device, in one go: the player's own awards,
// marked "Selbst erreicht", each with its game as evidence (./self-award.ts), and the profile's
// list written once with them in front, the rarest first (catalog.ts rank). An award that rests
// on another game (corrected since, and the milestone reached again now) is replaced: one
// deletion request for it and its evidence, saying `reason`, and a new evidence and award.
export async function showMilestones(pubkey: string, items: readonly MilestoneToShow[], reason: string): Promise<Outcome> {
  const selection = await latestSelection(pubkey)
  if (!selection) return "offline"
  const events = await storedBadgeEvents(pubkey)
  const awards = await validAwards(events, pubkey)
  const plans = items.map((item) => {
    const { milestone, achieved } = item
    const d = milestoneD(milestone)
    const award = awards.find((a) => a.issuer === pubkey && a.blueline?.scope === "self" && a.blueline.badge === milestone.id && a.blueline.version === milestone.version) ?? null
    const evidence = evidenceFor(events, pubkey, milestone, achieved.matchId)
    const keep = award && awardRestsOn(award, evidence, achieved.matchId) ? award.award : null
    const defined = events.some((e) => e.kind === KIND_BADGE_DEFINITION && e.pubkey === pubkey && tagValue(e.tags, "d") === d)
    return { ...item, d, evidence, keep, stale: award && !keep ? award : null, defined }
  })
  // First what the awards rest on, then the awards, which name the evidence by id.
  const written = await publishBadgeEvents(
    pubkey,
    plans.flatMap((p) => (p.keep ? [] : [...(p.defined ? [] : [milestoneDefinitionTemplate(p.milestone, p.texts, createdAt())]), ...(p.evidence ? [] : [milestoneEvidenceTemplate(p.milestone, p.achieved, createdAt())])])),
  )
  const stale = plans.flatMap((p) => (p.stale ? [p.stale] : []))
  const staleEvidence = events.filter((e) => e.pubkey === pubkey && stale.some((a) => a.blueline?.evidence === e.id))
  const given = await publishBadgeEvents(pubkey, [
    ...plans.flatMap((p) => {
      if (p.keep) return []
      const evidence = p.evidence ?? evidenceFor(written, pubkey, p.milestone, p.achieved.matchId)
      if (!evidence) throw new Error("the evidence was not written")
      return [milestoneAwardTemplate(p.milestone, pubkey, evidence.id, createdAt())]
    }),
    ...(stale.length > 0 ? [deletionTemplate([...stale.map((a) => a.award), ...staleEvidence], reason, createdAt())] : []),
  ])
  let badges = withoutBadges(selection, stale.map((a) => a.award.id))
  for (const p of [...plans].sort((a, b) => b.milestone.rank - a.milestone.rank)) {
    const award = p.keep ?? given.find((e) => e.kind === KIND_BADGE_AWARD && addressOf(e) === `${KIND_BADGE_DEFINITION}:${pubkey}:${p.d}`)
    if (award) badges = withBadge({ ...selection, badges }, { address: addressOf(award), award: award.id })
  }
  await writeSelection(pubkey, selection, badges)
  return "done"
}

// "Im Profil zeigen" for one milestone.
export const showMilestone = (pubkey: string, milestone: Milestone, achieved: Achievement, texts: MilestoneToShow["texts"], reason: string): Promise<Outcome> =>
  showMilestones(pubkey, [{ milestone, achieved, texts }], reason)

// "Im Profil zeigen" for a badge someone gave the player.
export async function showAward(pubkey: string, award: ValidAward): Promise<Outcome> {
  const selection = await latestSelection(pubkey)
  if (!selection) return "offline"
  await writeSelection(pubkey, selection, withBadge(selection, { address: addressOf(award.award), award: award.award.id }))
  return "done"
}

// "Aus dem Profil nehmen": the award itself stays given, only the list changes (PLAN.md: the
// choice in the profile never makes a published award private again).
export async function hideAwards(pubkey: string, awardIds: readonly string[]): Promise<Outcome> {
  const selection = await latestSelection(pubkey)
  if (!selection) return "offline"
  await writeSelection(pubkey, selection, withoutBadges(selection, awardIds))
  return "done"
}

// "Anordnen": the profile's badges in this order (the first three show on the card).
export async function arrangeAwards(pubkey: string, awardIds: readonly string[]): Promise<Outcome> {
  const selection = await latestSelection(pubkey)
  if (!selection) return "offline"
  await writeSelection(pubkey, selection, reordered(selection, awardIds))
  return "done"
}

// "Löschung anfragen" for awards the player gave (to themselves, or as organizer to others)
// whose result no longer holds: one deletion request for them and the evidence records of their
// own milestones, and those in the player's list leave it. Relays and apps may honour the
// request; none has to (decision 0001, "Was ohne Backend nicht möglich ist", 3).
export async function requestDeletion(pubkey: string, awards: readonly ValidAward[], reason: string): Promise<Outcome> {
  const own = awards.filter((a) => a.recipient === pubkey).map((a) => a.award.id)
  const selection = own.length > 0 ? await latestSelection(pubkey) : null
  if (own.length > 0 && !selection) return "offline"
  const evidenceIds = new Set(awards.flatMap((a) => (a.blueline?.scope === "self" ? [a.blueline.evidence] : [])))
  const evidence = (await storedBadgeEvents(pubkey)).filter((e) => evidenceIds.has(e.id) && e.pubkey === pubkey)
  await publishBadgeEvents(pubkey, [deletionTemplate([...awards.map((a) => a.award), ...evidence], reason, createdAt())])
  if (selection) await writeSelection(pubkey, selection, withoutBadges(selection, own))
  return "done"
}
