"use client"

import { useMemo, useState } from "react"
import { UserRound } from "lucide-react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { ImportedSheet } from "@/components/data/imported-sheet"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { fixed } from "@/components/profile/format"
import { Figures, ProfileCard, sportFigures, sportFiguresOf } from "@/components/profile/profile-card"
import { cardFigures } from "@/components/profile/public-view"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { StatsView } from "@/components/profile/stats-view"
import { useOwnProfile, usePublicProfile } from "@/components/profile/use-profile"
import { legsWonInGame } from "@/lib/game/engine"
import { formatNumber, formatPercent, formatWhen, modeName, type Messages } from "@/lib/i18n"
import { useMatchHistory } from "@/lib/leaderboard"
import { readStatsCard } from "@/lib/protocol/stats-card"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { headToHead, matchState, playerKey as keyOf, summarizePlayer, type PlayerSummary } from "@/lib/storage/stats"
import { cn } from "@/lib/utils"

// A player as this device knows them from its games, opened from the Rangliste or a game: the
// same card as one's own, then, signed in, the two of you against each other as pairs of bars
// (the leading side blue, values at both ends, never colour alone), the games between you, and
// for a profile that shares its figures what they say overall. Then the statistics. Results of
// the earlier version under this name can be assigned from here (E28).
const H2H_GAMES = 10

export default function PlayerScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const nav = useNav()
  const { all, players, aliases, loaded } = useMatchHistory()
  const own = useOwnProfile()
  const key = params.key ?? ""
  const me = !!own?.key && own.key === key
  const [assigning, setAssigning] = useState(false)
  const sameAs = own?.sameAs
  const summary = useMemo(() => summarizePlayer(all, key, { type: "x01", scope: "versus", aliases, sameAs }), [all, key, aliases, sameAs])
  const anySummary = useMemo(() => summarizePlayer(all, key, { aliases, sameAs }), [all, key, aliases, sameAs])
  const shared = useMemo(
    () => (own?.key && !me ? all.filter((m) => m.players.length >= 2 && [own.key, key].every((k) => m.players.some((p) => keyOf(m, p, aliases, own.sameAs) === k))) : []),
    [all, own?.key, own?.sameAs, key, aliases, me],
  )
  const together = useMemo(() => (own?.key && !me ? headToHead(all, own.key, key, { aliases, sameAs: own.sameAs }) : null), [all, key, aliases, own?.key, own?.sameAs, me])
  const pair = useMemo(() => {
    if (!own?.key || shared.length === 0) return null
    const options = { type: "x01" as const, scope: "versus" as const, aliases, sameAs: own.sameAs }
    return { theirs: summarizePlayer(shared, key, options), mine: summarizePlayer(shared, own.key, options) }
  }, [shared, key, own?.key, own?.sameAs, aliases])
  const pubkey = players?.find((p) => p.id === (anySummary?.playerId ?? ""))?.pubkey ?? null
  const published = usePublicProfile(me ? null : pubkey)
  const card = published.profile?.card && pubkey ? readStatsCard(published.profile.card, pubkey) : null
  const name = params.name ?? anySummary?.name ?? null
  const imported = key.startsWith("imported:") || !!anySummary?.includesImported

  if (!loaded) return null
  return (
    <>
      <ProfileCard seed={anySummary?.playerId ?? key} name={name} subtitle={me ? tx.player.you : tx.player.onDevice}>
        {summary && <Figures figures={sportFigures(t, tx, sportFiguresOf(summary))} caption={tx.card.scope} />}
      </ProfileCard>

      {together && together.games > 0 && pair && name && (
        <section aria-labelledby="h2h-title" className="mt-4 rounded-2xl border border-border bg-card px-4 py-3">
          <h2 id="h2h-title" className="text-[0.8125rem] font-medium text-muted-foreground">{tx.player.versusYou(name)}</h2>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="text-[0.9375rem] font-semibold">
                <th scope="col" className="w-20 py-0.5 text-left font-semibold [overflow-wrap:anywhere]">{name}</th>
                <th scope="col" className="py-0.5">
                  <span className="sr-only">{tx.stats.scoring}</span>
                </th>
                <th scope="col" className="w-20 py-0.5 text-right font-semibold">{tx.player.me}</th>
              </tr>
            </thead>
            <tbody>
              <BarPair label={tx.stats.wins} left={together.wins[1]} right={together.wins[0]} write={(n) => formatNumber(t, n)} />
              {together.legs && <BarPair label={tx.stats.legs} left={together.legs[1]} right={together.legs[0]} write={(n) => formatNumber(t, n)} />}
              <BarPair label={tx.card.average} left={pair.theirs?.x01?.average ?? null} right={pair.mine?.x01?.average ?? null} write={(n) => fixed(t, n)} />
              <BarPair label={tx.stats.first9} left={pair.theirs?.x01?.first9 ?? null} right={pair.mine?.x01?.first9 ?? null} write={(n) => fixed(t, n)} />
              <BarPair label={tx.card.checkout} left={pair.theirs?.x01?.checkoutRate ?? null} right={pair.mine?.x01?.checkoutRate ?? null} write={(n) => formatPercent(t, n)} />
              <BarPair label={tx.stats.highestFinish} left={pair.theirs?.x01?.highestFinish ?? null} right={pair.mine?.x01?.highestFinish ?? null} write={(n) => formatNumber(t, n)} />
            </tbody>
          </table>
        </section>
      )}

      {shared.length > 0 && name && own?.key && (
        <Group title={tx.player.gamesTogether}>
          {shared.slice(0, H2H_GAMES).map((match) => (
            <ListRow key={match.id} title={gameTitle(t, tx, match, own.key!, name, aliases, own.sameAs)} subtitle={`${modeName(t, match.modeId, match.modeName)} · ${formatWhen(match.finishedAt, t)}`} onClick={() => nav.push(PROFILE_SCREENS.match, { id: match.id })} />
          ))}
        </Group>
      )}

      {card?.card.x01 && name && (
        <section aria-label={tx.player.overall(name)} className="mt-4 rounded-2xl border border-border bg-card px-4 pb-1 pt-3">
          <h2 className="text-[0.8125rem] font-medium text-muted-foreground">{tx.player.overall(name)}</h2>
          <Figures figures={sportFigures(t, tx, cardFigures(card.card.x01))} caption={`${tx.public.sharedBy}, ${tx.public.asOf(formatWhen(new Date(card.createdAt * 1000).toISOString(), t))}`} />
        </section>
      )}

      {(pubkey && !me) || (imported && anySummary) ? (
        <Group>
          {pubkey && !me && <ListRow icon={UserRound} iconTone="blue" title={t.shell.screens.publicProfile} onClick={() => nav.push(SCREENS.profilePublic, { pubkey })} />}
          {imported && anySummary && <ListRow title={tx.player.assign} subtitle={tx.player.assignHint} onClick={() => setAssigning(true)} />}
        </Group>
      ) : null}

      <StatsView matches={all} playerKey={key} aliases={aliases} sameAs={sameAs} />

      {anySummary && <ImportedSheet standing={assigning ? anySummary : null} matches={all} players={players ?? []} onClose={() => setAssigning(false)} />}
    </>
  )
}

// "Du gewinnst 3:1", "Ben gewinnt": the game from the signed-in player's side.
function gameTitle(t: Messages, tx: ReturnType<typeof useAreaT<typeof PROFILE_TEXTS.de>>, match: ArchivedMatch, ownKey: string, name: string, aliases: Map<string, string>, sameAs: Map<string, string>) {
  const mine = match.players.findIndex((p) => keyOf(match, p, aliases, sameAs) === ownKey)
  const state = matchState(match)
  // Legs won, for a game of several legs; a game played in sets shows no score here.
  const score = state && match.players.length === 2 && state.config.legsToWin > 1 && (state.config.setsToWin ?? 1) <= 1 ? `${legsWonInGame(state, mine)}:${legsWonInGame(state, 1 - mine)}` : null
  return match.players[mine]?.won ? tx.player.youWin(score) : tx.player.theyWin(name, score)
}

// One figure for two people, as a table row: the value at each end, the longer bar on the
// leading side in the accent colour, the other grey. Both bars share one scale, so the eye
// compares lengths; VoiceOver reads the column heads (name, "Du") with every value.
function BarPair({ label, left, right, write }: { label: string; left: number | null; right: number | null; write: (n: number) => string }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const max = Math.max(left ?? 0, right ?? 0)
  const width = (n: number | null) => (n === null || max === 0 ? 0 : Math.max(6, (n / max) * 100))
  const lead = left !== null && right !== null && left !== right ? (left > right ? "left" : "right") : null
  const text = (n: number | null) =>
    n === null ? (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{tx.figures.unknownShort}</span>
      </>
    ) : (
      write(n)
    )
  const bar = (side: "left" | "right") => (
    <span className={cn("flex", side === "left" ? "justify-end" : "justify-start")}>
      <span className={cn("h-1.5 rounded-full", lead === side ? "bg-primary" : "bg-muted-foreground/30")} style={{ width: `${width(side === "left" ? left : right)}%` }} />
    </span>
  )
  return (
    <tr className="align-top">
      <td className={cn("py-2 pr-2 text-[1.0625rem] font-semibold tabular-nums", lead === "left" ? "text-primary" : "text-foreground")}>
        <span className="block">{text(left)}</span>
        <span className="mt-1 block" aria-hidden="true">{bar("left")}</span>
      </td>
      <th scope="row" className="py-2 text-center text-[0.8125rem] font-normal text-muted-foreground [overflow-wrap:anywhere]">{label}</th>
      <td className={cn("py-2 pl-2 text-right text-[1.0625rem] font-semibold tabular-nums", lead === "right" ? "text-primary" : "text-foreground")}>
        <span className="block">{text(right)}</span>
        <span className="mt-1 block" aria-hidden="true">{bar("right")}</span>
      </td>
    </tr>
  )
}

export type { PlayerSummary }
