"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { formatWhen } from "@/components/leaderboard-screen"
import { useT } from "@/components/i18n-provider"
import { Figures, ProfileCard, x01Figures } from "@/components/profile/profile-card"
import { useVerifiedNip05, type PublicProfileState } from "@/components/profile/use-profile"
import { readMetadata } from "@/lib/profile/metadata"
import { sharesNothing } from "@/lib/protocol/profile"
import { readStatsCard } from "@/lib/protocol/stats-card"

// A public profile exactly as relays have it: name, picture and, if the player shares one, the
// stats card, labelled as the player's own figures with their date. Loading, partly loaded and
// offline (with the last loaded version and its time) are told apart (PLAN.md "Profilansicht").
// Used for other players and for "So sehen andere dein Profil".
export function PublicProfileView({
  pubkey,
  own,
  state,
  children,
}: {
  pubkey: string
  own: boolean
  state: PublicProfileState
  // Actions below the card; gets the name the profile shows.
  children?: (name: string | null) => ReactNode
}) {
  const t = useT()
  const p = t.profile.public
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
  const others = card ? [card.card.cricket && `${t.profile.stats.modes.cricket}: ${t.profile.gamesCount(card.card.cricket.games)}`, card.card.clock && `${t.profile.stats.modes.clock}: ${t.profile.gamesCount(card.card.clock.games)}`].filter(Boolean) : []

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
                {own && <span className="block">{p.own}</span>}
              </>
            )
          }
          slot={{ pubkey, own }}
        >
          {card ? (
            <>
              {card.card.x01 ? (
                <Figures figures={x01Figures(t, card.card.x01)} caption={`${t.profile.figures.allTime} · ${caption}`} />
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
