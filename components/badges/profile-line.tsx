"use client"

import { useEffect, useState } from "react"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { BadgeIcon } from "@/components/badges/badge-icon"
import { BADGE_SCREENS } from "@/components/badges/screens"
import { awardTexts } from "@/components/badges/texts"
import { useOwnBadges } from "@/components/badges/use-badges"
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

function OwnLine({ pubkey }: { pubkey: string }) {
  const { shown } = useOwnBadges(pubkey)
  return <Chips awards={shown.slice(0, SHOWN_ON_CARD)} />
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
  return <Chips awards={awards ?? []} />
}

function Chips({ awards }: { awards: ValidAward[] }) {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  if (awards.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {awards.map((award) => {
        const { name } = awardTexts(tx, award)
        return (
          <li key={award.award.id} className="max-w-full">
            <button
              type="button"
              onClick={() => nav.push(BADGE_SCREENS.badge, { id: award.award.id, name })}
              className="flex min-h-11 max-w-full items-center gap-2 rounded-xl bg-secondary/70 py-1 pl-1.5 pr-3 text-left text-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary"
            >
              <BadgeIcon image={award.image} size={32} />
              <span className="min-w-0 leading-snug [overflow-wrap:anywhere]">{name}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
