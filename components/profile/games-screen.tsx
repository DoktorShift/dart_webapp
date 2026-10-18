"use client"

import { History } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { GameRow } from "@/components/profile/game-row"
import { useOwnProfile, useProfileGames } from "@/components/profile/use-profile"
import { EmptyHistory } from "@/components/sync/history-state"

// Profil › Spiele: every game of the profile on this device, newest first. While there is none,
// the sync area says whether the games from other devices were looked for yet.
export default function GamesScreen() {
  const tx = useAreaT(PROFILE_TEXTS)
  const own = useOwnProfile()
  const games = useProfileGames(own)
  if (!own || !own.history.loaded) return null
  if (games.length === 0) return <EmptyHistory pubkey={own.session.pubkey} none={<EmptyState icon={History} title={tx.games.none} description={tx.games.noneText} />} />
  return (
    <Group>
      {games.map((game) => (
        <GameRow key={game.match.id} game={game} />
      ))}
    </Group>
  )
}
