import { createdAt } from "../nostr/time.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { KIND_BADGE_DEFINITION, KIND_RECORD } from "../protocol/kinds.ts"
import { tagValue } from "../protocol/tags.ts"
import { validAwards, type ValidAward } from "./awards.ts"
import type { Milestone } from "./catalog.ts"
import type { Achievement } from "./milestones.ts"
import { reordered, withBadge, withoutBadges } from "./selection.ts"
import { evidenceFor, milestoneAwardTemplate, milestoneD, milestoneDefinitionTemplate, milestoneEvidenceTemplate } from "./self-award.ts"
import { deletionTemplate, latestSelection, publishBadgeEvents, storedBadgeEvents, writeSelection } from "./store.ts"

// What the person does with their badges (PLAN.md: "„Im Profil zeigen“, „Ausblenden“ und
// „Anordnen“ sind einfache Nutzeraktionen"). Each reads the profile's list from relays first and
// returns "offline" without changing anything when none answered. Signing is asked for one step
// at a time; a step that was done already (a definition, the evidence, the award) is not repeated
// when the person tries again.

export type Outcome = "done" | "offline"

const addressOf = (award: NostrEvent) => tagValue(award.tags, "a") as string

// "Im Profil zeigen" for a milestone reached on this device: the player's own award, marked
// "Selbst erreicht", with the game as evidence (./self-award.ts), first in the profile's list.
export async function showMilestone(pubkey: string, milestone: Milestone, achieved: Achievement, texts: { name: string; description: string }): Promise<Outcome> {
  const selection = await latestSelection(pubkey)
  if (!selection) return "offline"
  const events = await storedBadgeEvents(pubkey)
  let award = (await validAwards(events, pubkey)).find((a) => a.issuer === pubkey && a.blueline?.scope === "self" && a.blueline.badge === milestone.id && a.blueline.version === milestone.version)?.award
  if (!award) {
    const d = milestoneD(milestone)
    const defined = events.some((e) => e.kind === KIND_BADGE_DEFINITION && e.pubkey === pubkey && tagValue(e.tags, "d") === d)
    const evidence = evidenceFor(events, pubkey, milestone, achieved.matchId)?.event
    const written = await publishBadgeEvents(pubkey, [
      ...(defined ? [] : [milestoneDefinitionTemplate(milestone, texts, createdAt())]),
      ...(evidence ? [] : [milestoneEvidenceTemplate(milestone, achieved, createdAt())]),
    ])
    const evidenceId = evidence?.id ?? (written.find((e) => e.kind === KIND_RECORD) as NostrEvent).id
    ;[award] = await publishBadgeEvents(pubkey, [milestoneAwardTemplate(milestone, pubkey, evidenceId, createdAt())])
  }
  await writeSelection(pubkey, selection, withBadge(selection, { address: addressOf(award), award: award.id }))
  return "done"
}

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
