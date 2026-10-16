"use client"

import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { formatDateTime, personName } from "@/components/clubs/common"
import { useProfileNames } from "@/components/profile/use-profile-names"
import type { ClubGame } from "@/lib/clubs/games"
import { cn } from "@/lib/utils"

// One club game's result: each seat with its legs, the winner named, who recorded it and
// when. Players with a profile by their public name (the alias they played under until it is
// known), guests by their alias.
export function GameSummary({ game, me, className }: { game: ClubGame; me: string | null; className?: string }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const seats = game.agreement.seats
  const names = useProfileNames(seats.map((s) => s.pubkey).filter((p): p is string => !!p).concat(game.result ? [game.result.by] : []))
  const result = game.result
  const nameOf = (pubkey: string | undefined, alias: string) => (pubkey ? personName(pubkey, names(pubkey), tx, { me, alias }) : alias)
  // The viewer's own deeds in their own words ("Du hast gewonnen"), never "Du hat".
  const mine = (pubkey: string | undefined) => !!me && pubkey === me
  return (
    <div className={cn("rounded-2xl border border-border bg-card px-4 py-3", className)}>
      <ul className="flex flex-col gap-1">
        {seats.map((seat, i) => (
          <li key={i} className={cn("flex items-baseline justify-between gap-3 text-[1.0625rem]", result?.winner === i && "font-semibold")}>
            <span className="min-w-0 [overflow-wrap:anywhere]">{nameOf(seat.pubkey, seat.alias)}</span>
            <span className="shrink-0 tabular-nums">{result ? result.legs[i] : "—"}</span>
          </li>
        ))}
      </ul>
      {result && (
        <p className="mt-2 text-[0.8125rem] leading-snug text-muted-foreground">
          {result.winner === null ? tx.game.draw : mine(seats[result.winner]?.pubkey) ? tx.game.wonMe : tx.game.won(nameOf(seats[result.winner]?.pubkey, seats[result.winner]?.alias ?? ""))}
          {" · "}
          {mine(result.by) ? tx.game.recordedByMe : tx.game.recordedBy(nameOf(result.by, tx.unnamed))}
          {" · "}
          {formatDateTime(result.at, t)}
          {result.replaces && ` · ${tx.game.corrected}`}
        </p>
      )}
    </div>
  )
}
