"use client"

import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { formatWhen, modeName } from "@/lib/i18n"
import type { PlayedGame } from "@/lib/profile/history"

// One game in a profile's list: won or lost against whom (in words, not only colour), what and
// when. Opens the game's details.
export function GameRow({ game }: { game: PlayedGame }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const nav = useNav()
  const { match, seat } = game
  const others = match.players.filter((_, i) => i !== seat).map((p) => p.name.trim())
  const title = others.length === 0 ? tx.games.practice : match.players[seat].won ? tx.games.won(others.join(", ")) : tx.games.lost(others.join(", "))
  return (
    <ListRow
      title={title}
      subtitle={`${modeName(t, match.modeId, match.modeName)} · ${formatWhen(match.finishedAt, t)}`}
      onClick={() => nav.push(PROFILE_SCREENS.match, { id: match.id })}
    />
  )
}
