"use client"

import type { ReactNode } from "react"
import { ChevronRight, FileText } from "lucide-react"
import { Chip, Chips, type ChipTone } from "@/components/ui/chip"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { CardSection } from "@/components/common/card-section"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDateTime } from "@/lib/i18n"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { PHASE_TONES, rulesLine, type TournamentTexts } from "@/components/tournaments/common"
import { TOURNAMENT_SCREENS } from "@/components/tournaments/screens"
import { useTournaments, type Entry } from "@/components/tournaments/use-tournaments"
import { nowSeconds } from "@/lib/nostr/time"
import { useSession } from "@/lib/profile/session"
import { freePlaces, registrationOpen } from "@/lib/tournaments/read"
import { SCREENS } from "@/lib/shell/registry"

// The Tournaments tab (registry slot "tournaments.root"): drafts being written, "Meine Turniere"
// (organized, playing in, or this device scores at; what runs now first), and tournaments opened
// lately. Each card answers in chips how the tournament stands and where this person stands,
// then what is played, when and where. The two ways in, scanning a code and creating one, are on
// the bar (components/shell/tab-roots.tsx). Without any, the shell's own view.
export default function TournamentsHome({ fallback }: { fallback: ReactNode }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const nav = useNav()
  const session = useSession()
  const { entries, drafts, boards, loaded } = useTournaments()
  if (session === undefined || !loaded) return null
  const boardOf = (entry: Entry) => boards.find((b) => b.tournament === entry.stored.tournament)
  const known = entries.filter((e) => e.read.state)
  const mine = known.filter((e) => e.read.me.organizer || e.read.me.participant || boardOf(e))
  const recent = known.filter((e) => !mine.includes(e) && e.stored.openedAt !== null).sort((a, b) => (b.stored.openedAt ?? 0) - (a.stored.openedAt ?? 0))
  const open = (entry: Entry) => {
    const board = boardOf(entry)
    if (board && !entry.read.me.organizer) nav.push(TOURNAMENT_SCREENS.board, { tournament: entry.stored.tournament, name: entry.read.state?.boards[board.board]?.name ?? "" })
    else nav.push(SCREENS.tournamentView, { tournament: entry.stored.tournament, name: entry.read.state?.settings.name ?? "" })
  }
  const rank = (e: Entry) => (e.read.state?.phase === "running" || e.read.state?.phase === "paused" ? 0 : e.read.state?.phase === "finished" || e.read.state?.phase === "cancelled" ? 2 : 1)
  const byStart = (a: Entry, b: Entry) => rank(a) - rank(b) || (a.read.state?.settings.starts ?? Number.MAX_SAFE_INTEGER) - (b.read.state?.settings.starts ?? Number.MAX_SAFE_INTEGER)

  if (mine.length === 0 && recent.length === 0 && drafts.length === 0) return fallback
  return (
    <>
      {drafts.length > 0 && (
        <Group title={tx.home.drafts}>
          {drafts.map((d) => (
            <ListRow key={d.id} icon={FileText} iconTone="gray" title={d.name.trim() || tx.home.untitled} subtitle={tx.home.draft} onClick={() => nav.push(SCREENS.tournamentCreate, { draft: d.id })} />
          ))}
        </Group>
      )}
      {mine.length > 0 && (
        <CardSection title={tx.home.mine}>
          {[...mine].sort(byStart).map((entry) => (
            <TournamentCard key={entry.stored.tournament} entry={entry} status={statusLine(entry, boardOf(entry) !== undefined, tx)} onOpen={() => open(entry)} />
          ))}
        </CardSection>
      )}
      {recent.length > 0 && (
        <CardSection title={tx.home.recent}>
          {recent.map((entry) => (
            <TournamentCard key={entry.stored.tournament} entry={entry} status={null} onOpen={() => open(entry)} />
          ))}
        </CardSection>
      )}
    </>
  )
}

// Where this person stands in the tournament, in one word or two, and how the chip reads it.
type Standing = { text: string; tone: ChipTone }
function statusLine(entry: Entry, board: boolean, tx: TournamentTexts): Standing | null {
  const { me } = entry.read
  if (me.organizer) return { text: tx.home.organizer, tone: "accent" }
  if (board) return { text: tx.home.board, tone: "accent" }
  switch (me.participant?.status) {
    case "registered":
      return { text: me.participant.checkedIn ? tx.home.checkedIn : tx.home.registered, tone: "success" }
    case "pending":
      return { text: tx.home.pending, tone: "neutral" }
    case "waitlist":
      return { text: tx.home.waitlist, tone: "neutral" }
    default:
      return null
  }
}

// One tournament: name and rules, when and where, places and phase, and where this person stands.
export function TournamentCard({ entry, status, onOpen }: { entry: Entry; status: Standing | null; onOpen: () => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const state = entry.read.state
  if (!state) return null
  const s = state.settings
  const now = nowSeconds()
  const where = s.online ? tx.home.online : s.place
  const when = s.starts !== undefined ? formatDateTime(t, s.starts * 1000) : tx.home.noDate
  const open = registrationOpen(state, now)
  // Matches being played right now, as the bracket counts them (the same rule as the live strip).
  const live = state.phase === "running" ? (entry.read.view?.matches.filter((m) => m.state === "live" && !m.affected).length ?? 0) : 0
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors active:bg-secondary/70">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="block text-[1.0625rem] font-semibold leading-snug">{s.name}</span>
        <Chips className="mt-1">
          <Chip tone={PHASE_TONES[state.phase]}>{tx.phase[state.phase]}</Chip>
          {live > 0 && <Chip tone="live">{tx.home.liveCount(live)}</Chip>}
          {open && <Chip>{tx.home.free(freePlaces(state))}</Chip>}
          {status && <Chip tone={status.tone}>{status.text}</Chip>}
        </Chips>
        <span className="mt-1 block text-[0.8125rem] leading-snug text-muted-foreground">{[rulesLine(state, tx), tx.formats[s.format].name].join(" · ")}</span>
        <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{[when, where].filter(Boolean).join(" · ")}</span>
      </span>
      <ChevronRight className="-mr-1 h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </button>
  )
}
