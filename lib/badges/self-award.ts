import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import { badgeAwardTemplate, badgeD, badgeDefinitionTemplate } from "../protocol/badges.ts"
import { buildRecord, parseRecord, type BlueLineRecord } from "../protocol/records.ts"
import type { ArchivedMatch } from "../storage/archive.ts"
import type { StatsOptions } from "../storage/stats.ts"
import { milestoneById, type Milestone } from "./catalog.ts"
import type { ValidAward } from "./awards.ts"
import { holdsIn, type Achievement } from "./milestones.ts"

// "Im Profil zeigen" for a personal milestone (decision 0001, F3): the player awards it to
// themselves, which its scope marks as "Selbst erreicht", and the award points at the game it was
// reached in (a badge.evidence record: the game's id, date, mode and figure, nothing about
// opponents). Three events: the badge's definition (once per badge and rule version), the
// evidence, the award. The occasion is "once": a milestone counts once per person, however often
// it is shown.

export const milestoneD = (m: Milestone) => badgeD({ badge: m.id, version: m.version, scope: "self" })

export const milestoneDefinitionTemplate = (m: Milestone, texts: { name: string; description: string }, created_at: number): EventTemplate =>
  badgeDefinitionTemplate({ badge: m.id, version: m.version, scope: "self", name: texts.name, description: texts.description }, created_at)

export const milestoneEvidenceTemplate = (m: Milestone, achieved: Achievement, created_at: number): EventTemplate =>
  buildRecord(
    "badge.evidence",
    { badge: milestoneD(m), result: { game: achieved.matchId, finishedAt: Math.floor(Date.parse(achieved.finishedAt) / 1000), mode: achieved.modeId, value: achieved.value } },
    { created_at },
  )

export const milestoneAwardTemplate = (m: Milestone, pubkey: string, evidence: string, created_at: number): EventTemplate =>
  badgeAwardTemplate({ issuer: pubkey, d: milestoneD(m), recipient: pubkey, evidence, occasion: "once" }, created_at)

export type Evidence = BlueLineRecord<"badge.evidence">

// The evidence in a signed event, or null when it is none (another type, invalid content).
export function readEvidence(event: NostrEvent): Evidence | null {
  const parsed = parseRecord(event)
  return parsed.status === "ok" && parsed.record.type === "badge.evidence" ? (parsed.record as Evidence) : null
}

// The player's own evidence of reaching a milestone in this game, if they wrote one already (a
// second try after the award was refused reuses it).
export const evidenceFor = (events: readonly NostrEvent[], pubkey: string, m: Milestone, matchId: string): Evidence | null =>
  events
    .filter((e) => e.pubkey === pubkey)
    .map(readEvidence)
    .find((r) => r !== null && r.content.badge === milestoneD(m) && r.content.result?.game === matchId) ?? null

// Whether the game a shown milestone rests on still meets it after a correction on this device
// (PLAN.md: "Korrigierte oder aufgehobene Resultate lösen eine erneute fachliche Bewertung aus").
// null when that can't be said here: the game is on another device, or the rule is not this
// version's.
export function selfAwardHolds(award: ValidAward, evidence: Evidence | null, matches: readonly ArchivedMatch[], key: string, options: Pick<StatsOptions, "aliases" | "sameAs"> = {}): boolean | null {
  const milestone = award.blueline?.scope === "self" ? milestoneById(award.blueline.badge) : undefined
  const game = evidence?.content.result?.game
  if (!milestone || milestone.version !== award.blueline?.version || !game || evidence?.id !== award.blueline.evidence) return null
  return holdsIn(milestone, matches, key, game, options)
}
