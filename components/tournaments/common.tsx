"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { signerProblem } from "@/components/profile/signer-status"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { act, type Entry } from "@/components/tournaments/use-tournaments"
import type { EventTemplate } from "@/lib/nostr/types"
import { formatClock } from "@/lib/i18n"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import type { Widen } from "@/lib/i18n"
import type { tournamentsScreensDe } from "@/lib/i18n/features/tournaments.screens.de"
import type { TournamentState } from "@/lib/protocol/tournament-state"
import { sameNames } from "@/lib/storage/players"
import type { MatchView } from "@/lib/tournaments/engine"
import { roundLabel } from "@/lib/tournaments/labels"
import type { Reason } from "@/lib/protocol/reasons"
import { shortKey } from "@/lib/nostr/pointers"
import { isGuestPlace, type TournamentRead } from "@/lib/tournaments/read"
import { TournamentError } from "@/lib/tournaments/types"

// Small pieces every tournament screen shares: how times, people and matches are written,
// what to say when signing fails, and the honest lines about the local copy.

export type TournamentTexts = Widen<typeof tournamentsScreensDe>

export type Names = ReturnType<typeof useParticipantNames>

// What a participant is called: their public profile's name, else the alias they gave, else
// the start of their key. Guests are the alias the organizer entered. Two people showing the
// same name get the start of the key as a hint (design rules, impostor prevention).
export function useParticipantNames(read: TournamentRead | undefined): { nameOf: (id: string | null) => string; hintOf: (id: string) => string | null; pictureOf: (id: string) => string | null } {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const state = read?.state
  const pubkeys = state ? Object.values(state.participants).filter((p) => !isGuestPlace(p)).map((p) => p.id) : []
  const info = useProfileNames(pubkeys)
  const shown = (id: string) => (state?.participants[id] && !isGuestPlace(state.participants[id]) ? info(id).name : null) ?? read?.names[id] ?? tx.unnamed
  const twins = sameNames(Object.keys(state?.participants ?? {}).map((id) => ({ id, name: shown(id) })))
  return {
    nameOf: (id) => (id ? shown(id) : tx.tournament.tbd),
    hintOf: (id) => (twins.has(id) ? tx.tournament.sameName(shortKey(id)) : null),
    pictureOf: (id) => (state?.participants[id] && !isGuestPlace(state.participants[id]) ? info(id).picture : null),
  }
}

// The score of a match as people read it: "3:1", in sets "2:0 (6:3)".
export const scoreText = (m: MatchView) => (m.score ? (m.score.sets ? `${m.score.sets[0]}:${m.score.sets[1]} (${m.score.legs[0]}:${m.score.legs[1]})` : `${m.score.legs[0]}:${m.score.legs[1]}`) : "")

// The round of a match as players know it ("Halbfinale", "Gruppe A, Runde 2").
export const useRoundLabel = () => {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  return (m: MatchView) => roundLabel(tx, m)
}

// What the one-line rules of the tournament say: "501, First to 3 Legs".
export function rulesLine(state: TournamentState, tx: TournamentTexts): string {
  const r = state.settings.rules
  return tx.rulesLine(r.startScore, r.legsToWin, r.setsToWin)
}

export const boardName = (state: TournamentState | null, board: string | null) => (board && state?.boards[board]?.name) || board || ""

// Runs a tournament change and reports its problem in the person's words (a signer that
// refused, a connection that failed).
export function useProblemText() {
  const px = useAreaT(PROFILE_TEXTS)
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  return (error: unknown) => {
    // A change the bracket can't take says why; it is no signing problem.
    if (error instanceof TournamentError) return tx.errors[error.code]
    const code = (error as { code?: unknown } | null)?.code
    return typeof code === "string" ? signerProblem(px, error) : tx.failed
  }
}

// Why the tournament did not take a change, in the person's words.
export function refusalText(reason: Reason, tx: TournamentTexts): string {
  if (reason === "stale_predecessor" || reason === "superseded") return tx.refused.changed
  if (reason === "already_approved") return tx.refused.decided
  if (reason === "tournament_full") return tx.refused.full
  if (reason === "phase_invalid" || reason === "registration_closed" || reason === "rules_locked") return tx.refused.phase
  return tx.refused.other
}

// Signing and sending records of a tournament from a screen: which action is under way, and
// the problem of the last one in the person's words: the signer's, or why the tournament did
// not take it (another device changed the same thing meanwhile, say). `run` resolves with the
// fresh reading when the tournament took the records (relays get them through the outbox), null
// otherwise.
export function useActions(tournament: string) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const describe = useProblemText()
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (what: string, templates: () => readonly EventTemplate[] | Promise<readonly EventTemplate[]>): Promise<Entry | null> => {
    setBusy(what)
    setProblem(null)
    try {
      const { entry, refused } = await act(tournament, await templates())
      if (refused) setProblem(refusalText(refused, tx))
      return refused ? null : entry
    } catch (error) {
      setProblem(describe(error))
      return null
    } finally {
      setBusy(null)
    }
  }
  return { busy, problem, run, setProblem }
}

// When relays last answered for the tournament, and how many of this device's changes are
// still on their way (the outbox sends them by itself).
export function SyncLine({ entry, onRefresh }: { entry: Entry; onRefresh?: () => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const { read } = entry
  return (
    <div className="mt-6 flex flex-col gap-2">
      {entry.waiting > 0 && <InlineStatus tone="info">{tx.waiting(entry.waiting)}</InlineStatus>}
      <div className="flex items-center justify-between gap-3 px-4 text-[0.8125rem] text-muted-foreground">
        <span>{read.loadedAt === null ? tx.neverLoaded : tx.loadedAt(formatClock(t, read.loadedAt))}</span>
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh} className="h-11 gap-1.5 rounded-xl px-3 text-[0.9375rem] text-primary hover:bg-primary/10 hover:text-primary">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {tx.refresh}
          </Button>
        )}
      </div>
    </div>
  )
}

// A big primary action, the one thing to do on a screen or in a sheet.
export const PRIMARY = "h-14 w-full rounded-2xl text-[1.0625rem] font-semibold"
export const SECONDARY = "h-12 w-full rounded-2xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20"
export const QUIET = "h-12 w-full rounded-2xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary"
