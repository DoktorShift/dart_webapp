"use client"

import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { fixed } from "@/components/profile/format"
import { formatWhen, modeName } from "@/lib/i18n"
import type { PlayedGame } from "@/lib/profile/history"
import { gameValue } from "@/lib/storage/stats"

// One game in a profile's list: won or lost against whom (in words, not only colour), what and
// when, and in X01 the average of that game. Opens the game's details.
export function GameRow({ game }: { game: PlayedGame }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const nav = useNav()
  const { match, seat } = game
  const others = match.players.filter((_, i) => i !== seat).map((p) => p.name.trim())
  const title = others.length === 0 ? tx.games.practice : match.players[seat].won ? tx.games.won(others.join(", ")) : tx.games.lost(others.join(", "))
  const average = match.modeType === "x01" ? gameValue(match, seat) : null
  return (
    <ListRow
      title={title}
      subtitle={`${modeName(t, match.modeId, match.modeName)} · ${formatWhen(match.finishedAt, t)}`}
      value={average === null ? undefined : tx.games.average(fixed(t, average))}
      onClick={() => nav.push(PROFILE_SCREENS.match, { id: match.id })}
    />
  )
}
