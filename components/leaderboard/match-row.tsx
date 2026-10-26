"use client"

import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { useT } from "@/components/i18n-provider"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { formatWhen, modeName } from "@/lib/i18n"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { hasScreen } from "@/lib/shell/registry"

// One of the last games under the Rangliste: who won what, against whom, when. Opens the game's
// details where the profile area provides that screen.
export function MatchRow({ match }: { match: ArchivedMatch }) {
  const t = useT()
  const nav = useNav()
  useRegistryVersion()
  const winner = match.players.find((p) => p.won)
  const others = match.players.filter((p) => !p.won).map((p) => p.name.trim())
  const mode = modeName(t, match.modeId, match.modeName)
  const opens = hasScreen(PROFILE_SCREENS.match)
  return (
    <ListRow
      title={winner ? t.leaderboard.won(winner.name.trim()) : mode}
      subtitle={[winner && others.length > 0 ? t.leaderboard.against(mode, others.join(", ")) : winner ? mode : null, formatWhen(match.finishedAt, t)].filter(Boolean).join(" · ")}
      onClick={opens ? () => nav.push(PROFILE_SCREENS.match, { id: match.id }) : undefined}
    />
  )
}
