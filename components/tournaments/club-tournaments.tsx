"use client"

import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDateTime } from "@/lib/i18n"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { useTournaments, type Entry } from "@/components/tournaments/use-tournaments"
import { freePlaces } from "@/lib/tournaments/read"
import { SCREENS } from "@/lib/shell/registry"

// A club's tournaments, for the clubs area's slot list "club.tournaments" (registered at
// integration, see ./register.ts): in the club's overview (compact) the one that runs or comes
// next, in "Termine & Turniere" all of them and, for leaders, "Turnier erstellen", which opens
// the creation flow with the club filled in. Rows only: the clubs area puts them in its Group.
export default function ClubTournaments({ club, name, leader, compact }: { club: string; name: string; leader: boolean; compact: boolean }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const nav = useNav()
  const { entries, loaded } = useTournaments()
  if (!loaded) return null
  const over = (e: Entry) => e.read.state?.phase === "finished" || e.read.state?.phase === "cancelled"
  const mine = entries.filter((e) => e.read.state?.settings.club === club && e.read.state.club?.verified !== false).sort((a, b) => (over(a) ? 1 : 0) - (over(b) ? 1 : 0) || (a.read.state?.settings.starts ?? 0) - (b.read.state?.settings.starts ?? 0))
  const shown = compact ? mine.filter((e) => !over(e)).slice(0, 1) : mine
  const row = (e: Entry) => {
    const state = e.read.state
    if (!state) return null
    const when = state.settings.starts !== undefined ? formatDateTime(t, state.settings.starts * 1000) : tx.home.noDate
    return <ListRow key={e.stored.tournament} title={state.settings.name} subtitle={`${when} · ${state.phase === "registration" ? tx.home.free(freePlaces(state)) : tx.phase[state.phase]}`} onClick={() => nav.push(SCREENS.tournamentView, { tournament: e.stored.tournament, name: state.settings.name }, { tab: "tournaments" })} />
  }
  if (compact) return shown.length > 0 ? <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{shown.map(row)}</div> : null
  return (
    <>
      {shown.length === 0 && <ListRow title={tx.club.none} subtitle={leader ? tx.club.noneLeader : undefined} />}
      {shown.map(row)}
      {compact && mine.length > 1 && <ListRow title={tx.club.more(mine.length - 1)} />}
      {leader && <ListRow title={tx.club.create} onClick={() => nav.push(SCREENS.tournamentCreate, { club, name }, { tab: "tournaments" })} />}
    </>
  )
}
