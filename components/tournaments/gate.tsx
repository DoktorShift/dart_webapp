"use client"

import { lazyScreen } from "@/components/nav/lazy-screen"
import type { SavedMatch } from "@/lib/game/types"
import type { SlotListProps } from "@/lib/shell/registry"
import { tournamentGame, type TournamentExtra } from "@/lib/tournaments/extra"

// The always-loaded part of the tournaments area on the game and result screens: it decides by
// the game's config alone (lib/tournaments/extra.ts) whether the tournaments' code is needed at
// all. Any other game, a guest's above all, a rematch of a tournament game too, loads nothing of
// it: no reporter, outbox, store or texts.

const Reporter = lazyScreen<{ extra: TournamentExtra; match: SavedMatch }>(() => import("@/components/tournaments/reporter"))
const ReportRow = lazyScreen<{ extra: TournamentExtra; placement: SlotListProps["result.actions"]["placement"] }>(() => import("@/components/tournaments/report-row"))

// While the game is played nothing shows; once it is won, its result goes to the tournament.
export function TournamentGate({ match }: SlotListProps["game.attachments"]) {
  const extra = tournamentGame(match)
  return extra ? <Reporter extra={extra} match={match} /> : null
}

// On the result: how far that got.
export function TournamentResultGate({ match, placement }: SlotListProps["result.actions"]) {
  const extra = tournamentGame(match)
  return extra ? <ReportRow extra={extra} placement={placement} /> : null
}
