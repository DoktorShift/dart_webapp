"use client"

import { Trophy } from "lucide-react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { StatsTable, allRows } from "@/components/game/result-stats"
import { LegVisits } from "@/components/game/visit-list"
import { formatWhen } from "@/components/leaderboard-screen"
import { useNav } from "@/components/nav/nav-context"
import { useT } from "@/components/i18n-provider"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { legsWonInGame, playsSets } from "@/lib/game/engine"
import { rulesSummary } from "@/lib/game/words"
import { formatNumber, modeName } from "@/lib/i18n"
import { useMatchHistory } from "@/lib/leaderboard"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"
import { matchState, playerKey } from "@/lib/storage/stats"

// One finished game from the archive: what was played, who won, every figure and every visit,
// replayed from its throws by the game engine. Results from the earlier version have only their
// totals, and say so. A player opens their profile, or what this device knows about them.
export default function MatchScreen({ params }: ScreenProps) {
  const t = useT()
  const nav = useNav()
  const { all, aliases, loaded } = useMatchHistory()
  const match = all.find((m) => m.id === params.id)
  if (!loaded) return null
  if (!match) return <InlineStatus className="mt-6">{t.profile.games.notFound}</InlineStatus>

  const state = matchState(match)
  const solo = match.players.length === 1
  const score =
    state && match.players.length === 2
      ? playsSets(state.config)
        ? t.result.setScore(state.setsWon[0], state.setsWon[1])
        : state.config.legsToWin > 1
          ? t.result.legScore(legsWonInGame(state, 0), legsWonInGame(state, 1))
          : null
      : null

  const open = (index: number) => {
    const player = match.players[index]
    if (player.pubkey) return () => nav.push(SCREENS.profilePublic, { pubkey: player.pubkey! })
    const key = playerKey(match, player, aliases)
    if (!key || player.unnamed) return undefined
    return () => nav.push(PROFILE_SCREENS.player, { key, name: player.name.trim() })
  }

  return (
    <>
      <section className="mt-4 rounded-2xl border border-border bg-card px-4 py-4">
        <p className="text-[0.9375rem] text-muted-foreground">{formatWhen(match.finishedAt, t)}</p>
        <h2 className="mt-0.5 text-xl font-semibold leading-tight">{[modeName(t, match.modeId, match.modeName), score].filter(Boolean).join(", ")}</h2>
        {match.config && <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">{rulesSummary(t, match.config)}</p>}
      </section>

      <Group title={t.profile.games.players}>
        {match.players.map((player, i) => (
          <ListRow
            key={`${i}-${player.playerId ?? player.name}`}
            title={player.name}
            subtitle={!solo && player.won ? t.profile.games.winner : undefined}
            trailing={!solo && player.won ? <Trophy className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" /> : undefined}
            onClick={open(i)}
          />
        ))}
      </Group>

      {state ? (
        <>
          <section className="mt-8">
            <h2 className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{t.result.allStats}</h2>
            <StatsTable state={state} rows={allRows(state, t)} />
          </section>
          <section className="mt-8 space-y-4">
            <h2 className="px-4 text-[0.8125rem] text-muted-foreground">{t.profile.games.visits}</h2>
            <LegVisits state={state} />
          </section>
        </>
      ) : (
        <>
          <InlineStatus className="mt-6">{t.profile.games.imported}</InlineStatus>
          <Group title={t.profile.games.totals}>
            {match.players.map((player, i) => (
              <ListRow
                key={`${i}-${player.name}`}
                title={player.name}
                value={match.modeType === "x01" ? t.profile.games.totalsX01(formatNumber(t, player.darts), formatNumber(t, player.points)) : t.profile.games.totalsDarts(formatNumber(t, player.darts))}
              />
            ))}
          </Group>
        </>
      )}
    </>
  )
}
