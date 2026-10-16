"use client"

import type { ReactNode } from "react"
import { ChevronRight, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { CardSection } from "@/components/common/card-section"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { formatDateTime, rulesLine, SECONDARY, type TournamentTexts } from "@/components/tournaments/common"
import { TOURNAMENT_SCREENS } from "@/components/tournaments/screens"
import { useTournaments, type Entry } from "@/components/tournaments/use-tournaments"
import { nowSeconds } from "@/lib/nostr/time"
import { useSession } from "@/lib/profile/session"
import { freePlaces, registrationOpen } from "@/lib/tournaments/read"
import { SCREENS, runAction } from "@/lib/shell/registry"

// The Tournaments tab (registry slot "tournaments.root"): drafts being written, "Meine Turniere"
// (organized, playing in, or this device scores at), tournaments opened lately, and the two
// ways in. Each card answers what is played, when and where, how many places are free and
// whether registration is open. Without any, the shell's own view.
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
  const byStart = (a: Entry, b: Entry) => (a.read.state?.settings.starts ?? Number.MAX_SAFE_INTEGER) - (b.read.state?.settings.starts ?? Number.MAX_SAFE_INTEGER)

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
      <div className="mt-6 grid gap-2 min-[360px]:grid-cols-2">
        <Button onClick={() => runAction(SCREENS.tournamentCreate, nav)} className="h-12 whitespace-normal rounded-xl text-[1.0625rem] font-semibold">
          {tx.home.create}
        </Button>
        <Button variant="secondary" onClick={() => runAction(SCREENS.tournamentOpenInvite, nav)} className={`${SECONDARY} h-12 whitespace-normal rounded-xl`}>
          {tx.home.openInvite}
        </Button>
      </div>
    </>
  )
}

// Where this person stands in the tournament, in one line.
function statusLine(entry: Entry, board: boolean, tx: TournamentTexts): string | null {
  const { me } = entry.read
  if (me.organizer) return tx.home.organizer
  if (board) return tx.home.board
  switch (me.participant?.status) {
    case "registered":
      return me.participant.checkedIn ? tx.home.checkedIn : tx.home.registered
    case "pending":
      return tx.home.pending
    case "waitlist":
      return tx.home.waitlist
    default:
      return null
  }
}

// One tournament: name and rules, when and where, places and phase, and where this person stands.
export function TournamentCard({ entry, status, onOpen }: { entry: Entry; status: string | null; onOpen: () => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const state = entry.read.state
  if (!state) return null
  const s = state.settings
  const now = nowSeconds()
  const where = s.online ? tx.home.online : s.place
  const when = s.starts !== undefined ? formatDateTime(s.starts, t) : tx.home.noDate
  const places = registrationOpen(state, now) ? tx.home.free(freePlaces(state)) : tx.phase[state.phase]
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors active:bg-secondary/70">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="block text-[1.0625rem] font-semibold leading-snug">{s.name}</span>
        <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{[rulesLine(state, tx), tx.formats[s.format].name].join(" · ")}</span>
        <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{[when, where].filter(Boolean).join(" · ")}</span>
        <span className="mt-1 block text-[0.9375rem] font-medium leading-snug">{[places, status].filter(Boolean).join(" · ")}</span>
      </span>
      <ChevronRight className="-mr-1 h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </button>
  )
}
