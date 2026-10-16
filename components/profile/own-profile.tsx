"use client"

import { useMemo, useState } from "react"
import { ChartColumn, Eye, History, Info, Settings, Share, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { SlotItems } from "@/components/shell/slot-items"
import { useEmptyHistoryLine } from "@/components/sync/history-state"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { EditSheet } from "@/components/profile/edit-sheet"
import { GameRow } from "@/components/profile/game-row"
import { Figures, ProfileCard, x01Figures } from "@/components/profile/profile-card"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { ShareSheet } from "@/components/profile/share-sheet"
import { useStatsCardFollowsGames } from "@/components/profile/use-stats-card"
import { useOwnProfile, useProfileGames, type OwnProfile } from "@/components/profile/use-profile"
import { ownRelaySettings } from "@/lib/profile/own-events"
import { SCREENS } from "@/lib/shell/registry"
import { summarizePlayer } from "@/lib/storage/stats"

// The signed-in Profile tab (./profile-root.tsx), shown once this device's data is read: name
// and figures come from here, so it waits for them rather than show "no name" first. "Abmelden"
// opens the root's dialog, which outlasts this view.
export default function SignedInProfile({ onSignOut }: { onSignOut: () => void }) {
  const own = useOwnProfile()
  if (!own?.events || !own.history.loaded) return null
  return <OwnProfileView own={own} onSignOut={onSignOut} />
}

// A sports card first (picture, name, three X01 figures with their period, the areas' line for
// badges), "Profil teilen" as the one prominent action, the last three games, then everything
// else on rows: statistics and games, the areas' own rows (devices, backup, payments, badges),
// the public preview, settings, technical details, sign out.
function OwnProfileView({ own, onSignOut }: { own: OwnProfile; onSignOut: () => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const h = tx.home
  const nav = useNav()
  const { session, metadata, name, player, lookup, history, key, sameAs } = own
  const games = useProfileGames(own)
  const summary = useMemo(() => (key ? summarizePlayer(history.all, key, { type: "x01", aliases: history.aliases, sameAs }) : null), [key, history.all, history.aliases, sameAs])
  const [shareOpen, setShareOpen] = useState(false)
  // Each opening starts from the profile as it is now.
  const [edit, setEdit] = useState({ open: false, round: 0 })
  useStatsCardFollowsGames(own)
  // Until this device has looked for the profile's games from its other devices, "no games" is
  // not known yet (components/sync/history-state.tsx).
  const noGames = useEmptyHistoryLine(session.pubkey, h.noGames)

  return (
    <>
      <ProfileCard
        seed={session.pubkey}
        name={name}
        // No name here yet: say whether it is still being looked up, not "no name".
        placeholder={lookup?.state === "complete" ? undefined : lookup?.state === "incomplete" ? h.nameNotLoaded : h.nameLoading}
        picture={metadata.picture}
        subtitle={player && metadata.name && player.name !== metadata.name ? h.boardName(player.name) : undefined}
        slot={{ pubkey: session.pubkey, own: true }}
      >
        {summary?.x01 ? (
          <Figures figures={x01Figures(t, tx, { ...summary, points: summary.x01.points, darts: summary.x01.darts })} caption={tx.figures.allTime} />
        ) : (
          <p className="mt-4 border-t border-border pt-3 text-[0.9375rem] leading-snug text-muted-foreground">{noGames}</p>
        )}
      </ProfileCard>

      <div className="mt-4 grid gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto]">
        <Button onClick={() => setShareOpen(true)} className="h-12 gap-2 whitespace-normal rounded-xl text-[1.0625rem] font-semibold">
          <Share className="h-5 w-5 shrink-0" aria-hidden="true" />
          {h.share}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setEdit((e) => ({ open: true, round: e.round + 1 }))}
          className="h-12 rounded-xl bg-primary/10 px-5 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20"
        >
          {h.edit}
        </Button>
      </div>

      {games.length > 0 && (
        <Group title={h.recent}>
          {games.slice(0, 3).map((game) => (
            <GameRow key={game.match.id} game={game} />
          ))}
        </Group>
      )}

      <Group>
        <ListRow icon={ChartColumn} iconTone="blue" title={t.profile.titles.stats} onClick={() => nav.push(PROFILE_SCREENS.stats)} />
        <ListRow icon={History} iconTone="teal" title={t.profile.titles.games} value={games.length} onClick={() => nav.push(PROFILE_SCREENS.games)} />
        <SlotItems list="profile.rows" props={() => ({})} />
      </Group>

      <Group>
        <ListRow icon={Eye} iconTone="purple" title={t.profile.titles.preview} onClick={() => nav.push(PROFILE_SCREENS.preview)} />
        <ListRow icon={Settings} iconTone="gray" title={t.settings.title} onClick={() => nav.push(SCREENS.settings)} />
        <ListRow icon={Info} iconTone="blue" title={t.nav.about} onClick={() => nav.push(SCREENS.about)} />
        <ListRow icon={Wrench} iconTone="gray" title={t.profile.titles.advanced} onClick={() => nav.push(PROFILE_SCREENS.advanced)} />
      </Group>

      <Group>
        <ListRow title={h.signOut} destructive onClick={onSignOut} />
      </Group>

      <ShareSheet open={shareOpen} onOpenChange={setShareOpen} pubkey={session.pubkey} name={name} writeRelays={own.events ? ownRelaySettings(own.events).write : []} />
      <EditSheet key={edit.round} own={own} open={edit.open} onOpenChange={(open) => setEdit((e) => ({ ...e, open }))} />
    </>
  )
}

