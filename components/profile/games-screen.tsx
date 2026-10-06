"use client"

import { History } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { useT } from "@/components/i18n-provider"
import { GameRow } from "@/components/profile/game-row"
import { useOwnProfile, useProfileGames } from "@/components/profile/use-profile"

// Profil › Spiele: every game of the profile on this device, newest first.
export default function GamesScreen() {
  const t = useT()
  const own = useOwnProfile()
  const games = useProfileGames(own)
  if (!own || !own.history.loaded) return null
  if (games.length === 0) return <EmptyState icon={History} title={t.profile.games.none} description={t.profile.games.noneText} />
  return (
    <Group>
      {games.map((game) => (
        <GameRow key={game.match.id} game={game} />
      ))}
    </Group>
  )
}
