"use client"

import { useEffect, useState } from "react"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { BadgeIcon } from "@/components/badges/badge-icon"
import { BADGE_SCREENS } from "@/components/badges/screens"
import { awardTexts } from "@/components/badges/texts"
import { awardVoided, useOwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile } from "@/components/profile/use-profile"
import type { ValidAward } from "@/lib/badges/awards"
import { SHOWN_ON_CARD } from "@/lib/badges/selection"
import { shownBadges } from "@/lib/badges/store"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"

// The badges on a profile card (registry "profile.card"): the first three the profile shows,
// each opening its own screen. Nothing while they aren't known yet, and nothing at all for a
// profile that shows none (PLAN.md "Profilansicht": up to three chosen badges).
export default function ProfileBadgesLine({ pubkey, own }: { pubkey: string; own: boolean }) {
  return own ? <OwnLine pubkey={pubkey} /> : <OtherLine pubkey={pubkey} />
}

interface Chip {
  award: ValidAward
  // The result it rests on was corrected: the card says so, as the lists do.
  voided: boolean
}

function OwnLine({ pubkey }: { pubkey: string }) {
  const own = useOwnProfile()
  const badges = useOwnBadges(pubkey)
  if (!own) return null
  return <Chips chips={badges.shown.slice(0, SHOWN_ON_CARD).map((award) => ({ award, voided: awardVoided(own, badges, award) }))} />
}

function OtherLine({ pubkey }: { pubkey: string }) {
  const [awards, setAwards] = useState<ValidAward[] | null>(null)
  useEffect(() => {
    let alive = true
    setAwards(null)
    void shownBadges(pubkey, [], SHOWN_ON_CARD).then(
      ({ awards: found }) => alive && setAwards(found),
      () => alive && setAwards([]),
    )
    return () => {
      alive = false
    }
  }, [pubkey])
  return <Chips chips={(awards ?? []).map((award) => ({ award, voided: false }))} />
}

function Chips({ chips }: { chips: Chip[] }) {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  if (chips.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {chips.map(({ award, voided }) => {
        const { name } = awardTexts(tx, award)
        return (
          <li key={award.award.id} className="max-w-full">
            <button
              type="button"
              onClick={() => nav.push(BADGE_SCREENS.badge, { id: award.award.id, name, pubkey: award.recipient })}
              className="flex min-h-11 max-w-full items-center gap-2 rounded-xl bg-secondary/70 py-1 pl-1.5 pr-3 text-left text-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary"
            >
              <BadgeIcon image={award.image} size={32} />
              <span className="min-w-0 leading-snug [overflow-wrap:anywhere]">
                {name}
                {voided && <span className="block text-[0.8125rem] font-normal text-muted-foreground">{tx.list.corrected}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
