"use client"

import { useMemo } from "react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useT } from "@/components/i18n-provider"
import { Figures, ProfileCard, x01Figures } from "@/components/profile/profile-card"
import { StatsView } from "@/components/profile/stats-view"
import { useOwnProfile } from "@/components/profile/use-profile"
import { useMatchHistory } from "@/lib/leaderboard"
import type { ScreenProps } from "@/lib/shell/registry"
import { headToHead, summarizePlayer } from "@/lib/storage/stats"

// A player who has no public profile, as this device knows them from its games (PLAN.md: for a
// guest, the local player view, never an invented public profile). With a profile signed in,
// also how the two played against each other.
export default function PlayerScreen({ params }: ScreenProps) {
  const t = useT()
  const { all, aliases, loaded } = useMatchHistory()
  const own = useOwnProfile()
  const key = params.key ?? ""
  const summary = useMemo(() => summarizePlayer(all, key, { type: "x01", aliases }), [all, key, aliases])
  const together = useMemo(() => (own?.key && own.key !== key ? headToHead(all, own.key, key, { aliases, sameAs: own.sameAs }) : null), [all, key, aliases, own?.key, own?.sameAs])
  if (!loaded) return null
  return (
    <>
      <ProfileCard seed={key} name={params.name ?? summary?.name ?? null} subtitle={t.profile.player.onDevice}>
        {summary?.x01 && (
          <Figures figures={x01Figures(t, { ...summary, points: summary.x01.points, darts: summary.x01.darts })} caption={t.profile.figures.allTime} />
        )}
      </ProfileCard>
      {together && together.games > 0 && (
        <Group>
          <ListRow title={t.profile.player.together} value={t.profile.player.togetherValue(together.wins[0], together.wins[1])} />
        </Group>
      )}
      <StatsView matches={all} playerKey={key} aliases={aliases} />
    </>
  )
}
