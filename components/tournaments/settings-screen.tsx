"use client"

import { useState } from "react"
import { ChevronDown, Printer } from "lucide-react"
import { Confirm } from "@/components/ui/confirm"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/live/waiting"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { formatDateTime, SyncLine, useActions, useParticipantNames } from "@/components/tournaments/common"
import { DetailsSheet, HandoverSheet } from "@/components/tournaments/organize-sheets"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { TOURNAMENT_SCREENS } from "@/components/tournaments/screens"
import { useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import { relayHost } from "@/lib/profile/relay-status"
import type { ScreenProps } from "@/lib/shell/registry"
import { cancelOfferTemplate, phaseTemplate } from "@/lib/tournaments/records"
import { tournamentRelays } from "@/lib/tournaments/send"
import { cn } from "@/lib/utils"

// The organizer's settings, behind the workspace's gear: the details, pausing, print and export,
// the hand-over, cancelling, and the technical details behind "Erweitert".
export default function SettingsScreen({ params }: ScreenProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const { entry, loaded, refresh } = useTournament(params.tournament ?? null)
  if (!loaded) return null
  if (!entry?.read.state) return <Waiting>{tx.tournament.loading}</Waiting>
  if (!entry.read.me.organizer) return <EmptyState title={tx.tournament.organize} description={tx.organize.settings.handoverText} />
  return <Settings entry={entry} onRefresh={() => void refresh()} />
}

function Settings({ entry, onRefresh }: { entry: Entry; onRefresh: () => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const s = tx.organize.settings
  const p = tx.organize.participants
  const nav = useNav()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const names = useParticipantNames(read)
  const actions = useActions(read.id)
  const [editing, setEditing] = useState(false)
  const [handingOver, setHandingOver] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const offerTo = useProfileNames(state.offer ? [state.offer.to] : [])(state.offer?.to ?? "")
  const over = state.phase === "finished" || state.phase === "cancelled"
  const busy = actions.busy !== null
  return (
    <div className="pb-4">
      <p className="mt-2 text-[0.9375rem] text-muted-foreground">{tx.phase[state.phase]}</p>
      {actions.problem && (
        <InlineStatus tone="error" className="mt-4">
          {actions.problem}
        </InlineStatus>
      )}
      <Group>
        {!over && <ListRow title={s.details} onClick={() => setEditing(true)} />}
        {state.phase === "running" && <ListRow title={p.pause} chevron={false} disabled={busy} onClick={() => void actions.run("pause", () => [phaseTemplate(state, "paused")])} />}
        {state.phase === "paused" && <ListRow title={p.resume} chevron={false} disabled={busy} onClick={() => void actions.run("resume", () => [phaseTemplate(state, "running")])} />}
        <ListRow icon={Printer} iconTone="gray" title={s.export} onClick={() => nav.push(TOURNAMENT_SCREENS.print, { tournament: read.id })} />
      </Group>
      {!over && (
        <Group footer={state.offer ? s.offerOpen(offerTo.name ?? names.nameOf(state.offer.to), formatDateTime(state.offer.expires, t)) : s.handoverText}>
          {state.offer ? (
            <ListRow title={s.cancelOffer} chevron={false} disabled={busy} onClick={() => void actions.run("cancelOffer", () => [cancelOfferTemplate(state, (state.offer as NonNullable<typeof state.offer>).event)])} />
          ) : (
            <ListRow title={s.handover} onClick={() => setHandingOver(true)} />
          )}
        </Group>
      )}
      {!over && (
        <Group>
          <ListRow title={p.cancel} destructive onClick={() => setCancelling(true)} />
        </Group>
      )}
      <Group footer={s.advancedText}>
        <ListRow title={s.advanced} onClick={() => setAdvanced((a) => !a)} chevron={false} trailing={<ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform motion-reduce:transition-none", advanced && "rotate-180")} aria-hidden="true" />} />
        {advanced && (
          <div className="px-4 py-3 text-[0.8125rem] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            <p>{read.id}</p>
            <p>
              {s.relays}: {tournamentRelays(read.relays).map(relayHost).join(", ")}
            </p>
            {read.skipped.length > 0 && (
              <p>
                {s.skipped}: {read.skipped.map((x) => `${x.slot} (${x.why})`).join("; ")}
              </p>
            )}
          </div>
        )}
      </Group>
      <SyncLine entry={entry} onRefresh={onRefresh} />
      <DetailsSheet entry={entry} open={editing} onOpenChange={setEditing} />
      <HandoverSheet entry={entry} names={names} open={handingOver} onOpenChange={setHandingOver} />
      <Confirm open={cancelling} onOpenChange={setCancelling} title={p.cancelTitle} text={p.cancelText} confirm={p.cancel} destructive onConfirm={() => void actions.run("cancel", () => [phaseTemplate(state, "cancelled")])} />
    </div>
  )
}
