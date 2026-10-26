"use client"

import { useMemo, useState } from "react"
import { ChartColumn, Eye, FileOutput, Info, Settings, Share, Wrench } from "lucide-react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { NavBarItems, NavIconButton } from "@/components/nav/nav-bar-items"
import { useNav } from "@/components/nav/nav-context"
import { SlotItems } from "@/components/shell/slot-items"
import { useEmptyHistoryLine } from "@/components/sync/history-state"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { EditSheet } from "@/components/profile/edit-sheet"
import { FormCard } from "@/components/profile/form-card"
import { GameRow } from "@/components/profile/game-row"
import { HistorySheet } from "@/components/profile/history-sheet"
import { CardAction, Figures, ProfileCard, sportFigures, sportFiguresOf } from "@/components/profile/profile-card"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { ShareSheet } from "@/components/profile/share-sheet"
import { TrainingCard } from "@/components/profile/training-card"
import { useStatsCard, useStatsCardFollowsGames } from "@/components/profile/use-stats-card"
import { useOwnProfile, useProfileGames, type OwnProfile } from "@/components/profile/use-profile"
import { playedElsewhere } from "@/lib/profile/history"
import { ownRelaySettings } from "@/lib/profile/own-events"
import { SCREENS, type SetupPreset } from "@/lib/shell/registry"
import { isTraining, summarizePlayer } from "@/lib/storage/stats"

// The signed-in Profile tab (./profile-root.tsx), shown once this device's data is read: name
// and figures come from here, so it waits for them rather than show "no name" first. "Abmelden"
// opens the root's dialog, which outlasts this view.
export default function SignedInProfile({ onSignOut }: { onSignOut: () => void }) {
  const own = useOwnProfile()
  if (!own?.events || !own.history.loaded) return null
  return <OwnProfileView own={own} onSignOut={onSignOut} />
}

const RECENT = 3

// The sports card first (picture, name, the areas' line for badges, Ø 3 Darts · Checkout ·
// Siege against others with what they cover), then the form, the training, the last games,
// statistics and badges; the account below that, in its own group, each row with its state
// (proposal 2026-10-26, M1 and M5). "Profil teilen" sits in the bar, "Bearbeiten" in the card.
function OwnProfileView({ own, onSignOut }: { own: OwnProfile; onSignOut: () => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const h = tx.home
  const nav = useNav()
  const { session, metadata, name, player, lookup, history, key, sameAs } = own
  const games = useProfileGames(own)
  const versus = useMemo(() => games.filter((g) => !isTraining(g.match)), [games])
  const summary = useMemo(() => (key ? summarizePlayer(history.all, key, { type: "x01", scope: "versus", aliases: history.aliases, sameAs }) : null), [key, history.all, history.aliases, sameAs])
  const elsewhere = useMemo(() => playedElsewhere(history.all, session.pubkey, player?.id), [history.all, session.pubkey, player?.id])
  const card = useStatsCard(own)
  const [shareOpen, setShareOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Each opening starts from the profile as it is now.
  const [edit, setEdit] = useState({ open: false, round: 0 })
  useStatsCardFollowsGames(own)
  // Until this device has looked for the profile's games from its other devices, "no games" is
  // not known yet (components/sync/history-state.tsx).
  const noGames = useEmptyHistoryLine(session.pubkey, h.noGames)
  const startTraining = (type: "x01" | "cricket" | "clock" = "x01") => {
    const preset: SetupPreset | undefined = player ? { players: [{ name: player.name, pubkey: session.pubkey }] } : undefined
    nav.openSetup(type, preset)
  }

  return (
    <>
      <NavBarItems>
        <NavIconButton icon={Share} label={h.share} onClick={() => setShareOpen(true)} className="-mr-1" />
      </NavBarItems>

      <ProfileCard
        seed={session.pubkey}
        name={name}
        // No name here yet: say whether it is still being looked up, not "no name".
        placeholder={lookup?.state === "complete" ? undefined : lookup?.state === "incomplete" ? h.nameNotLoaded : h.nameLoading}
        picture={metadata.picture}
        subtitle={player && metadata.name && player.name !== metadata.name ? h.boardName(player.name) : undefined}
        slot={{ pubkey: session.pubkey, own: true }}
        action={<CardAction label={h.edit} onClick={() => setEdit((e) => ({ open: true, round: e.round + 1 }))} />}
      >
        {summary ? (
          <Figures figures={sportFigures(t, tx, sportFiguresOf(summary))} caption={`${tx.card.scope} · ${elsewhere ? tx.card.allDevices : tx.card.thisDevice}`} />
        ) : (
          <p className="mt-4 border-t border-border pt-3 text-[0.9375rem] leading-snug text-muted-foreground">{noGames}</p>
        )}
      </ProfileCard>

      <SlotItems list="profile.notices" props={() => ({ pubkey: session.pubkey })} />

      {key && (
        <>
          <FormCard matches={history.all} playerKey={key} aliases={history.aliases} sameAs={sameAs} onOpen={() => nav.push(PROFILE_SCREENS.stats)} />
          <TrainingCard matches={history.all} playerKey={key} aliases={history.aliases} sameAs={sameAs} onOpen={() => nav.push(PROFILE_SCREENS.training)} onStart={() => startTraining()} />
        </>
      )}

      {games.length > 0 && (
        <Group title={h.recent}>
          {versus.slice(0, RECENT).map((game) => (
            <GameRow key={game.match.id} game={game} />
          ))}
          <ListRow title={h.allGames} subtitle={games.length > versus.length ? h.allGamesHint : undefined} value={games.length} onClick={() => nav.push(PROFILE_SCREENS.games)} />
        </Group>
      )}

      <Group>
        <ListRow icon={ChartColumn} iconTone="blue" title={t.profile.titles.stats} onClick={() => nav.push(PROFILE_SCREENS.stats)} />
        <SlotItems list="profile.rows" props={() => ({})} />
      </Group>

      <Group title={h.account}>
        <SlotItems list="profile.account" props={() => ({})} />
        <ListRow icon={FileOutput} iconTone="teal" title={tx.history.title} subtitle={tx.history.row} onClick={() => setHistoryOpen(true)} />
        <ListRow icon={Eye} iconTone="purple" title={t.profile.titles.visibility} subtitle={card.loaded ? (card.enabled ? tx.visibility.rowEveryone : tx.visibility.rowNone) : undefined} onClick={() => nav.push(PROFILE_SCREENS.visibility)} />
        <ListRow icon={Settings} iconTone="gray" title={t.settings.title} onClick={() => nav.push(SCREENS.settings)} />
        <ListRow icon={Info} iconTone="blue" title={t.nav.about} onClick={() => nav.push(SCREENS.about)} />
        <ListRow icon={Wrench} iconTone="gray" title={t.profile.titles.advanced} onClick={() => nav.push(PROFILE_SCREENS.advanced)} />
      </Group>

      <Group>
        <ListRow title={h.signOut} destructive onClick={onSignOut} />
      </Group>

      <ShareSheet open={shareOpen} onOpenChange={setShareOpen} pubkey={session.pubkey} name={name} writeRelays={own.events ? ownRelaySettings(own.events).write : []} />
      <EditSheet key={edit.round} own={own} open={edit.open} onOpenChange={(open) => setEdit((e) => ({ ...e, open }))} />
      <HistorySheet own={own} open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  )
}
