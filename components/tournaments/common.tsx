"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { signerProblem } from "@/components/profile/signer-status"
import { useNames } from "@/components/tournaments/use-names"
import { act } from "@/components/tournaments/use-tournaments"
import type { EventTemplate } from "@/lib/nostr/types"
import type { Messages } from "@/lib/i18n"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import type { Widen } from "@/lib/i18n"
import type { tournamentsScreensDe } from "@/lib/i18n/features/tournaments.screens.de"
import type { TournamentState } from "@/lib/protocol/tournament-state"
import type { MatchView } from "@/lib/tournaments/engine"
import { roundLabel } from "@/lib/tournaments/labels"
import { isGuestPlace, shortKey, type TournamentRead } from "@/lib/tournaments/read"
import { resendUnsent } from "@/lib/tournaments/send"

// Small pieces every tournament screen shares: how times, people and matches are written,
// what to say when signing fails, and the honest lines about the local copy.

export type TournamentTexts = Widen<typeof tournamentsScreensDe>

export const formatDateTime = (unix: number, t: Messages) =>
  new Date(unix * 1000).toLocaleString(t.intl, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export const formatTime = (ms: number, t: Messages) => new Date(ms).toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit" })

// What a participant is called: their public profile's name, else the alias they gave, else
// the start of their key. Guests are the alias the organizer entered. Two people showing the
// same name get the start of the key as a hint (design rules, impostor prevention).
export function useParticipantNames(read: TournamentRead | undefined): { nameOf: (id: string | null) => string; hintOf: (id: string) => string | null; pictureOf: (id: string) => string | null } {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const state = read?.state
  const pubkeys = state ? Object.values(state.participants).filter((p) => !isGuestPlace(p)).map((p) => p.id) : []
  const info = useNames(pubkeys)
  const shown = (id: string) => (state?.participants[id] && !isGuestPlace(state.participants[id]) ? info(id).name : null) ?? read?.names[id] ?? tx.unnamed
  const counts = new Map<string, number>()
  for (const id of Object.keys(state?.participants ?? {})) counts.set(shown(id), (counts.get(shown(id)) ?? 0) + 1)
  return {
    nameOf: (id) => (id ? shown(id) : tx.tournament.tbd),
    hintOf: (id) => ((counts.get(shown(id)) ?? 0) > 1 ? tx.tournament.sameName(shortKey(id)) : null),
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
    const code = (error as { code?: unknown } | null)?.code
    return typeof code === "string" ? signerProblem(px, error) : tx.failed
  }
}

// Signing and sending records of a tournament from a screen: which action is under way, and
// the problem of the last one in the person's words. `run` resolves true when the records went
// out (whatever the relays said), false when signing failed.
export function useActions(tournament: string) {
  const describe = useProblemText()
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (what: string, templates: () => readonly EventTemplate[] | Promise<readonly EventTemplate[]>): Promise<boolean> => {
    setBusy(what)
    setProblem(null)
    try {
      await act(tournament, await templates())
      return true
    } catch (error) {
      setProblem(describe(error))
      return false
    } finally {
      setBusy(null)
    }
  }
  return { busy, problem, run, clear: () => setProblem(null) }
}

// When relays last answered for the tournament, and what this device wrote that no relay
// confirmed yet, with one way to send it again.
export function SyncLine({ read, onRefresh }: { read: TournamentRead; onRefresh?: () => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  return (
    <div className="mt-6 flex flex-col gap-2">
      {read.unsent.length > 0 && (
        <InlineStatus tone="info">
          {tx.unsent(read.unsent.length)}{" "}
          <button type="button" onClick={() => void resendUnsent(read.id)} className="font-semibold text-primary underline-offset-2 hover:underline">
            {tx.resend}
          </button>
        </InlineStatus>
      )}
      <div className="flex items-center justify-between gap-3 px-4 text-[0.8125rem] text-muted-foreground">
        <span>{read.loadedAt === null ? tx.neverLoaded : tx.loadedAt(formatTime(read.loadedAt, t))}</span>
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh} className="h-9 gap-1.5 rounded-lg px-2 text-[0.8125rem] text-primary hover:bg-primary/10 hover:text-primary">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
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
