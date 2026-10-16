"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { Medal, MonitorPlay, Printer, Settings, Share, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { Waiting } from "@/components/live/waiting"
import { readPayload } from "@/components/live/link-payload"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { BracketView } from "@/components/tournaments/bracket-view"
import { formatDateTime, rulesLine, SECONDARY, SyncLine, useParticipantNames } from "@/components/tournaments/common"
import { MatchesList } from "@/components/tournaments/matches-list"
import { PhaseCard } from "@/components/tournaments/phase-card"
import { TOURNAMENT_SCREENS } from "@/components/tournaments/screens"
import { ShareSheet } from "@/components/tournaments/share-sheet"
import { useLiveMatches } from "@/components/tournaments/use-live-matches"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { useAutoAdmission, useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import { nowSeconds } from "@/lib/nostr/time"
import { nextMatch } from "@/lib/tournaments/engine"
import { awaitingApproval, admitted, requests, shortKey } from "@/lib/tournaments/read"
import type { ScreenProps } from "@/lib/shell/registry"

type Tab = "matches" | "bracket" | "info"

// A tournament as players, spectators and the organizer see it first: what is played, when and
// where, then the one thing to do in this phase (PhaseCard), then "Spiele" (the default on
// phones), the bracket or the tables, and "Infos". Opened from the tab (params.tournament) or a
// link (/#tournament=T1…, params.payload); the navigation bar names it once it is loaded.
// Viewing needs no profile.
export default function TournamentScreen({ params, setParams }: ScreenProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const link = useMemo(() => readPayload("tournament", params.payload), [params.payload])
  const id = params.tournament ?? link?.tournament ?? null
  const { entry, loaded, missing, refresh } = useTournament(id, link?.relays ?? [])
  useLiveMatches(entry?.read)
  useAutoAdmission(entry)
  const name = entry?.read.state?.settings.name
  useEffect(() => {
    if (name && name !== params.name) setParams({ name })
    // The title follows the tournament's name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, params.name])
  if (!id) return <EmptyState icon={Medal} title={tx.tournament.notFound} description={tx.tournament.notFoundText} />
  if (!loaded) return null
  const read = entry?.read
  if (!read?.state) {
    if (read?.problem === "sealed") return <EmptyState icon={Medal} title={tx.tournament.unreadable} description={tx.tournament.unreadableText} />
    if (read?.problem === "unknown_version") return <EmptyState icon={Medal} title={tx.tournament.newer} />
    if (missing || read?.problem === "missing") return <EmptyState icon={WifiOff} title={tx.tournament.notFound} description={tx.tournament.notFoundText} primary={{ label: tx.retry, onClick: () => void refresh() }} />
    return <Waiting>{tx.tournament.loading}</Waiting>
  }
  return <TournamentView entry={entry as Entry} onRefresh={() => void refresh()} />
}

function TournamentView({ entry, onRefresh }: { entry: Entry; onRefresh: () => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const nav = useNav()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const names = useParticipantNames(read)
  const organizerInfo = useProfileNames([state.organizer])(state.organizer)
  const [tab, setTab] = useState<Tab>("matches")
  const [sharing, setSharing] = useState(false)
  const s = state.settings
  const now = nowSeconds()
  const tasks = read.me.organizer ? requests(state).length + awaitingApproval(state).length + (read.view?.matches.filter((m) => m.affected).length ?? 0) : 0
  // A called or running match of the reader's comes first, above the details: where to play is
  // the one thing to see at a glance, also on a phone in landscape.
  const mine = read.me.participant?.id
  const next = mine && read.view && (state.phase === "running" || state.phase === "drawn") ? nextMatch(read.view, mine) : null
  const urgent = next?.state === "ready" || next?.state === "live"
  // When the reader's match is called or starts, the card comes into view, wherever the page
  // was scrolled to (after registering, say).
  const card = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const calledMatch = urgent ? next.match.id : null
  useEffect(() => {
    if (calledMatch) card.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" })
    // Once per match that turns urgent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calledMatch])
  const phaseCard = (
    <div ref={card} className="scroll-mt-16">
      <PhaseCard entry={entry} names={names} />
    </div>
  )
  const bracketLabel = s.format === "roundRobin" || (s.format === "groups" && !read.view?.matches.some((m) => m.bracket === "main" && m.state !== "pending")) ? tx.tournament.tabs.groups : tx.tournament.tabs.bracket

  return (
    <div className="pb-4">
      {urgent && phaseCard}
      <header className="mt-2">
        <p className="text-[1.0625rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
          {[rulesLine(state, tx), tx.formats[s.format].name].join(" · ")}
          {s.final && ` · ${tx.finalLine(s.final.legsToWin, s.final.setsToWin)}`}
        </p>
        <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
          {[s.starts !== undefined ? (s.timezone ? tx.tournament.startsAtZone(formatDateTime(s.starts, t), s.timezone) : tx.tournament.startsAt(formatDateTime(s.starts, t))) : tx.home.noDate, s.online ? tx.tournament.online : s.place]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{tx.tournament.organizedBy(organizerInfo.name ?? shortKey(state.organizer))}</p>
      </header>

      {!urgent && phaseCard}

      {read.me.organizer && (
        <Group>
          <ListRow icon={Settings} iconTone="gray" title={tx.tournament.organize} subtitle={tasks > 0 ? tx.tournament.organizeTasks(tasks) : undefined} onClick={() => nav.push(TOURNAMENT_SCREENS.organize, { tournament: read.id })} />
        </Group>
      )}

      <div className="mt-6">
        <Segmented
          label={tx.tournament.tabs.matches}
          options={[
            { value: "matches", label: tx.tournament.tabs.matches },
            { value: "bracket", label: bracketLabel },
            { value: "info", label: tx.tournament.tabs.info },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "matches" && <MatchesList read={read} names={names} me={read.me.participant?.id ?? null} />}
      {tab === "bracket" && <BracketView read={read} names={names} me={read.me.participant?.id ?? null} />}
      {tab === "info" && (
        <>
          <Group title={tx.tournament.rules}>
            <ListRow title={tx.formats[s.format].name} subtitle={tx.formats[s.format].summary} />
            <ListRow title={rulesLine(state, tx)} subtitle={s.final ? tx.finalLine(s.final.legsToWin, s.final.setsToWin) : undefined} />
            {s.format === "double" && <ListRow title={tx.grandFinalReset} subtitle={s.grandFinalReset === false ? undefined : tx.grandFinalResetHint} />}
            {(s.format === "roundRobin" || s.format === "groups") && (
              <ListRow title={tx.scoring.title} subtitle={[tx.scoring.points, tx.scoring.order, tx.tiebreak.points, tx.tiebreak.legDifference, tx.tiebreak.legsWon, tx.tiebreak.headToHead, tx.tiebreak.lot].join(" ")} />
            )}
            <ListRow title={tx.seeding.reproducible} subtitle={tx.tournament.drawHint} />
          </Group>
          <Group title={tx.tournament.field}>
            <ListRow title={tx.tournament.fieldLine(admitted(state).length, s.capacity)} subtitle={state.phase === "registration" && s.registrationCloses !== undefined && s.registrationCloses > now ? formatDateTime(s.registrationCloses, t) : undefined} />
            <ListRow title={tx.tournament.boardsLine(Object.values(state.boards).filter((b) => b.active).length)} />
            {s.about && <ListRow title={s.about} />}
          </Group>
          <Group>
            <ListRow icon={MonitorPlay} iconTone="purple" title={tx.tournament.tv} onClick={() => nav.push(TOURNAMENT_SCREENS.tv, { tournament: read.id })} />
            <ListRow icon={Printer} iconTone="gray" title={tx.tournament.print} onClick={() => nav.push(TOURNAMENT_SCREENS.print, { tournament: read.id })} />
          </Group>
          <SyncLine entry={entry} onRefresh={onRefresh} />
        </>
      )}

      <Button variant="secondary" onClick={() => setSharing(true)} className={`${SECONDARY} mt-6 gap-2`}>
        <Share className="h-5 w-5" aria-hidden="true" />
        {tx.tournament.share}
      </Button>
      <ShareSheet open={sharing} onOpenChange={setSharing} tournament={read.id} name={s.name} relays={read.relays} />
    </div>
  )
}
