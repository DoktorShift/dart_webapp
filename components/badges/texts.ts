import type { ValidAward } from "@/lib/badges/awards"
import { milestoneById, type Milestone } from "@/lib/badges/catalog"
import type { MilestoneStatus } from "@/lib/badges/milestones"
import { formatNumber, type Messages } from "@/lib/i18n"
import type { BadgesTexts } from "@/lib/i18n/features/badges.screens"

// Words for what lib/badges knows by id.

type MilestoneText = BadgesTexts["milestones"][keyof BadgesTexts["milestones"]]

// What a milestone is called and means in the current language. A milestone these texts don't
// know (a newer catalog than this version's texts) shows its id.
export const milestoneTexts = (tx: BadgesTexts, milestone: Milestone): MilestoneText =>
  (tx.milestones as Record<string, MilestoneText | undefined>)[milestone.id] ?? { name: milestone.id, description: "", condition: "" }

// The catalog's milestone a self-earned award is for, when this version knows its rule.
export function milestoneOf(award: ValidAward): Milestone | undefined {
  const milestone = award.blueline?.scope === "self" ? milestoneById(award.blueline.badge) : undefined
  return milestone && milestone.version === award.blueline?.version ? milestone : undefined
}

// A badge's name and meaning as shown: the catalog's words for a milestone, else as published.
export function awardTexts(tx: BadgesTexts, award: ValidAward): { name: string; description: string } {
  const milestone = milestoneOf(award)
  return milestone ? milestoneTexts(tx, milestone) : { name: award.name, description: award.description }
}

// "7 von 10 Spielen": how far a milestone not reached yet is.
export function progressText(t: Messages, tx: BadgesTexts, { milestone, progress }: MilestoneStatus): string {
  const p = tx.progress
  const hundredths = (value: number | null) => (value === null ? null : formatNumber(t, Math.floor(value) / 100))
  switch (milestone.measure) {
    case "games":
      return p.games(progress ?? 0, milestone.target)
    case "wins":
      return p.wins
    case "highestVisit":
      return p.highestVisit(progress)
    case "highestCheckout":
      return p.highestCheckout(progress)
    case "perfectLeg":
      return p.perfectLeg
    case "average":
      return p.average(hundredths(progress))
    case "marksPerRound":
      return p.marksPerRound(hundredths(progress))
    case "marksInVisit":
      return p.marksInVisit(progress)
    case "clockDarts":
      return p.clockDarts(progress)
  }
}

// What to tell the person when a change didn't go through: no relay answered ("offline" from
// lib/badges/actions.ts), the signer declined, or anything else.
export function problemText(tx: BadgesTexts, problem: unknown): string {
  if (problem === "offline") return tx.problems.offline
  return (problem as { code?: unknown } | null)?.code === "rejected" ? tx.problems.rejected : tx.problems.failed
}
