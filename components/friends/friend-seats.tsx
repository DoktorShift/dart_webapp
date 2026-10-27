"use client"

import { UserRound } from "lucide-react"
import { useAreaT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { useFriends } from "@/components/friends/use-friends"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { byState } from "@/lib/friends/model"
import { useMatchHistory } from "@/lib/leaderboard"
import { recentPlayers } from "@/lib/profile/recent-players"
import { useSession } from "@/lib/profile/session"
import type { SetupPlayersProps } from "@/lib/shell/registry"
import { seatName } from "@/lib/storage/players"

const SHOWN = 8

// Friends in game setup: one chip each, filling a seat linked by their profile (not by a name
// anyone could type). Friends who played here lately already stand under "Zuletzt gespielt"
// (components/setup-screen.tsx, the same chips, now with their profile), so they are left out
// here, as are friends already seated.
export default function FriendSeats({ players, canAdd, addPlayer }: SetupPlayersProps) {
  const tx = useAreaT(FRIENDS_TEXTS)
  const session = useSession()
  const { friends } = useFriends()
  const { all: matches } = useMatchHistory()
  const list = friends ? byState(friends, "friend") : []
  const names = useProfileNames(list.map((f) => f.pubkey))
  if (!session || !canAdd || list.length === 0) return null
  const elsewhere = new Set([...players.map((p) => p.pubkey), ...recentPlayers(matches, null).map((p) => p.pubkey)])
  const chips = list
    .filter((f) => !elsewhere.has(f.pubkey))
    .map((f) => ({ pubkey: f.pubkey, name: names(f.pubkey).name }))
    .filter((c): c is { pubkey: string; name: string } => !!c.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, SHOWN)
  if (chips.length === 0) return null
  return (
    <div className="mt-2">
      <p className="mb-2 px-1 text-[0.8125rem] font-medium text-muted-foreground">{tx.setup.group}</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button key={c.pubkey} type="button" onClick={() => addPlayer({ name: seatName(c.name), pubkey: c.pubkey })} className="flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-4 text-left text-[0.9375rem] active:bg-secondary">
            <UserRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="[overflow-wrap:anywhere]">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
