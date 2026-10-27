"use client"

import { useEffect, useState } from "react"
import { Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { InlineStatus } from "@/components/common/inline-status"
import { PersonRow } from "@/components/common/person-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { FRIENDS_SCREENS } from "@/components/friends/screens"
import { useFriends } from "@/components/friends/use-friends"
import { StandingRow } from "@/components/leaderboard/standing-row"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { byState } from "@/lib/friends/model"
import type { NostrEvent } from "@/lib/nostr/types"
import { loadProfiles } from "@/lib/profile/public-profile"
import { useSession } from "@/lib/profile/session"
import { readStatsCard } from "@/lib/protocol/stats-card"
import { SCREENS } from "@/lib/shell/registry"
import { STANDINGS_MIN_GAMES, type Standing } from "@/lib/storage/stats"

// Rangliste › Freunde: you and your friends by win rate, from the stats card each of you shares
// (profile.stats): the same self-statement the public profile shows, never more. X01 against
// others, ranked from the usual minimum of games; friends who share nothing stand below with a
// plain word, and while no relay answered, with "not loaded yet" instead of a claim about their
// choice. Your own row is tinted; every row opens the person.

interface Figures {
  games: number
  wins: number
  winRate: number
  average: number | null
}

interface Cards {
  key: string
  events: Map<string, NostrEvent | null>
  // Whether a relay answered; false means the cards are whatever was cached here.
  answered: boolean
}

function figuresOf(event: NostrEvent | null, pubkey: string): Figures | null {
  const x01 = event ? readStatsCard(event, pubkey)?.card.x01 : null
  if (!x01 || x01.versus === 0) return null
  return { games: x01.versus, wins: x01.wins, winRate: x01.wins / x01.versus, average: x01.darts > 0 ? (x01.points / x01.darts) * 3 : null }
}

export default function FriendsSection() {
  const t = useT()
  const ftx = useAreaT(FRIENDS_TEXTS)
  const tx = ftx.ranks
  const nav = useNav()
  const session = useSession()
  const { friends, loaded } = useFriends()
  const me = session?.pubkey ?? null
  const list = friends ? byState(friends, "friend") : []
  const everyone = me ? [me, ...list.map((f) => f.pubkey)] : []
  const key = everyone.join(",")
  const names = useProfileNames(everyone)
  const [cards, setCards] = useState<Cards | null>(null)

  useEffect(() => {
    if (!key) return
    let alive = true
    void loadProfiles(key.split(","), { cards: true }).then(
      (found) => alive && setCards({ key, events: new Map([...found].map(([pubkey, profile]) => [pubkey, profile.card])), answered: found.answered === true }),
      () => alive && setCards({ key, events: new Map(), answered: false }),
    )
    return () => {
      alive = false
    }
  }, [key])

  if (session === undefined || !loaded) return null
  if (!session) return <EmptyState icon={Users} title={tx.guestTitle} description={tx.guestText} primary={{ label: tx.guestAction, onClick: () => nav.selectTab("profile") }} />
  if (list.length === 0) return <EmptyState icon={Users} title={tx.emptyTitle} description={tx.emptyText} primary={{ label: tx.emptyAction, onClick: () => nav.push(FRIENDS_SCREENS.list, undefined, { tab: "profile" }) }} />

  const current = cards?.key === key ? cards : null
  const nameOf = (pubkey: string) => names(pubkey).name ?? ftx.unnamed
  const withFigures = everyone.flatMap((pubkey) => {
    const figures = figuresOf(current?.events.get(pubkey) ?? null, pubkey)
    return figures ? [{ pubkey, figures }] : []
  })
  const ranked = withFigures
    .filter((r) => r.figures.games >= STANDINGS_MIN_GAMES)
    .sort((a, b) => b.figures.winRate - a.figures.winRate || (b.figures.average ?? 0) - (a.figures.average ?? 0) || b.figures.games - a.figures.games)
  const below = withFigures.filter((r) => r.figures.games < STANDINGS_MIN_GAMES)
  const silent = everyone.filter((pubkey) => !withFigures.some((r) => r.pubkey === pubkey))
  const standing = (pubkey: string, figures: Figures, rank: number | null): Standing => ({ key: pubkey, name: nameOf(pubkey), playerId: null, imported: false, includesImported: false, games: figures.games, wins: figures.wins, winRate: figures.winRate, average: figures.average, lastPlayed: "", rank })
  // Competition ranks ("1, 1, 3"): a tie keeps the rank of the row before it.
  const ranks: number[] = []
  ranked.forEach((r, i) => ranks.push(i > 0 && ranked[i - 1].figures.winRate === r.figures.winRate ? ranks[i - 1] : i + 1))
  const rows = [...ranked.map((r, i) => standing(r.pubkey, r.figures, ranks[i])), ...below.map((r) => standing(r.pubkey, r.figures, null))]
  const openProfile = (pubkey: string) => (pubkey === me ? nav.selectTab("profile") : nav.push(SCREENS.profilePublic, { pubkey }))

  return (
    <>
      <p className="mt-4 px-1 text-[0.9375rem] leading-snug text-muted-foreground">{tx.scope(STANDINGS_MIN_GAMES)}</p>
      {!current && (
        <p role="status" className="mt-3 px-1 text-[0.9375rem] text-muted-foreground">
          {tx.loading}
        </p>
      )}
      {current && !current.answered && <InlineStatus className="mt-3">{tx.offline}</InlineStatus>}
      {rows.length > 0 && (
        <ul className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((s) => (
            <StandingRow key={s.key} standing={s} sortBy="winRate" showAverage you={s.key === me} picture={names(s.key).picture} hint={s.rank === null ? t.leaderboard.unranked : null} onClick={() => openProfile(s.key)} />
          ))}
        </ul>
      )}
      {current && silent.length > 0 && (
        <Group title={tx.silent}>
          {silent.map((pubkey) => (
            <PersonRow
              key={pubkey}
              pubkey={pubkey}
              name={nameOf(pubkey)}
              picture={names(pubkey).picture}
              subtitle={!current.answered && !current.events.get(pubkey) ? tx.notLoaded : pubkey === me ? tx.youNoCard : tx.noCard}
              onClick={() => openProfile(pubkey)}
              action={
                pubkey === me ? (
                  <Button variant="secondary" onClick={() => nav.push(PROFILE_SCREENS.visibility, undefined, { tab: "profile" })} className="h-11 rounded-full px-4 text-[0.9375rem] font-semibold text-primary">
                    {tx.openVisibility}
                  </Button>
                ) : undefined
              }
            />
          ))}
        </Group>
      )}
    </>
  )
}
