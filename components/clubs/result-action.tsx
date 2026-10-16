"use client"

import { lazyScreen } from "@/components/nav/lazy-screen"
import { clubOf } from "@/lib/clubs/extra"
import type { FinishedMatch, SlotListProps } from "@/lib/shell/registry"

// On the result of a finished game ("result.actions"): nothing at all unless the game was
// started from a club, so a guest's result never loads the clubs' code.
const RecordForClub = lazyScreen<{ club: string; match: FinishedMatch; placement: SlotListProps["result.actions"]["placement"] }>(() => import("@/components/clubs/result-record"))

export default function ClubResultAction({ match, placement }: SlotListProps["result.actions"]) {
  const club = clubOf(match.config)
  if (!club || match.solo) return null
  return <RecordForClub club={club} match={match} placement={placement} />
}
