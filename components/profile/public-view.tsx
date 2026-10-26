"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatWhen } from "@/lib/i18n"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { Figures, ProfileCard, sportFigures } from "@/components/profile/profile-card"
import { useVerifiedNip05, type PublicProfileState } from "@/components/profile/use-profile"
import { readMetadata } from "@/lib/profile/metadata"
import { sharesNothing, type StatsCard } from "@/lib/protocol/profile"
import { readStatsCard } from "@/lib/protocol/stats-card"

// A public profile exactly as relays have it: name, picture and, if the player shares one, the
// stats card, labelled as the player's own figures with their date. Loading, partly loaded and
// offline (with the last loaded version and its time) are told apart (PLAN.md "Profilansicht").
// Used for other players and for "So sehen andere dein Profil".

// The three card figures from a shared stats card's raw counts; what a card doesn't carry is "—".
export const cardFigures = (x: NonNullable<StatsCard["x01"]>) => ({
  average: x.darts > 0 ? (x.points / x.darts) * 3 : null,
  checkoutRate: x.checkouts !== undefined && x.dartsAtDouble ? x.checkouts / x.dartsAtDouble : null,
  checkouts: x.checkouts,
  dartsAtDouble: x.dartsAtDouble,
  wins: x.wins,
  versus: x.versus,
})

export function PublicProfileView({
  pubkey,
  own,
  preview,
  state,
  children,
}: {
  pubkey: string
  own: boolean
  // Under Profil › Sichtbarkeit the heading already says whose profile this is.
  preview?: boolean
  state: PublicProfileState
  // Actions below the card; gets the name the profile shows.
  children?: (name: string | null) => ReactNode
}) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const p = tx.public
  const { profile, status, reload } = state
  const metadata = readMetadata(profile?.metadata)
  const address = useVerifiedNip05(metadata.nip05, pubkey)
  const shared = profile?.card ? readStatsCard(profile.card, pubkey) : null
  const card = shared && !sharesNothing(shared.card) ? shared : null
  const known = !!(profile?.metadata || profile?.card)

  if (!profile && status === null) {
    return (
      <p role="status" className="mt-6 px-4 text-[1.0625rem] text-muted-foreground">
        {p.loading}
      </p>
    )
  }

  // Shared figures are the player's own statement, so they always say so, with their date.
  const caption = card ? `${p.sharedBy}, ${p.asOf(formatWhen(new Date(card.createdAt * 1000).toISOString(), t))}` : ""
  const others = card ? [card.card.cricket && `${tx.stats.modes.cricket}: ${tx.gamesCount(card.card.cricket.games)}`, card.card.clock && `${tx.stats.modes.clock}: ${tx.gamesCount(card.card.clock.games)}`].filter(Boolean) : []

  return (
    <>
      {status === "offline" && (
        <div className="mt-6">
          <InlineStatus tone="error">{profile?.loadedAt ? p.offline(formatWhen(new Date(profile.loadedAt).toISOString(), t)) : p.offlineNever}</InlineStatus>
          <Button variant="secondary" onClick={reload} className="mt-2 h-11 rounded-xl px-5 text-[1.0625rem]">
            {p.retry}
          </Button>
        </div>
      )}
      {status === "partial" && <InlineStatus className="mt-6">{p.partial}</InlineStatus>}
      {status === "complete" && !known && <InlineStatus className="mt-6">{p.notFound}</InlineStatus>}

      {known && (
        <ProfileCard
          seed={pubkey}
          name={metadata.name}
          picture={metadata.picture}
          subtitle={
            (address || own) && (
              <>
                {address && <span className="block">{address}</span>}
                {own && !preview && <span className="block">{p.own}</span>}
              </>
            )
          }
          slot={{ pubkey, own }}
        >
          {card ? (
            <>
              {card.card.x01 ? (
                <Figures figures={sportFigures(t, tx, cardFigures(card.card.x01))} caption={`${tx.card.scope} · ${caption}`} />
              ) : (
                <p className="mt-4 border-t border-border pt-3 text-[0.8125rem] text-muted-foreground">{caption}</p>
              )}
              {others.length > 0 && <p className="mt-2 text-[0.9375rem] text-muted-foreground">{others.join(" · ")}</p>}
            </>
          ) : (
            <p className="mt-4 border-t border-border pt-3 text-[0.9375rem] leading-snug text-muted-foreground">{p.noCard}</p>
          )}
        </ProfileCard>
      )}
      {(known || status !== null) && children?.(metadata.name)}
    </>
  )
}
