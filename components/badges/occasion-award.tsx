"use client"

import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { awardTexts } from "@/components/badges/texts"
import { useChange, useOwnBadges } from "@/components/badges/use-badges"
import { showAward } from "@/lib/badges/actions"
import type { ValidAward } from "@/lib/badges/awards"
import { ORGANIZER_BADGES } from "@/lib/badges/catalog"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"

// The highest first, as the catalog lists them (a finalist's "Finalist" before "Dabei").
const RANKS: readonly string[] = Object.keys(ORGANIZER_BADGES)
const rankOf = (award: ValidAward) => {
  const rank = RANKS.indexOf(award.blueline?.badge ?? "")
  return rank < 0 ? RANKS.length : rank
}

// The award an organizer gave the profile for an occasion (a tournament it played), on the
// occasion's page: where the highest of them is, and "Im Profil zeigen" in one tap while the
// profile card doesn't show it. `pending` says what comes while there is none (yet) on this
// device.
export function OccasionAward({ pubkey, issuer, scopeId, pending }: { pubkey: string; issuer: string; scopeId: string; pending: string }) {
  const tx = useAreaT(BADGES_TEXTS)
  const badges = useOwnBadges(pubkey)
  const { busy, problem, run } = useChange()
  const award = badges.awards?.filter((a) => a.issuer === issuer && a.blueline?.scopeId === scopeId && !a.voided).sort((a, b) => rankOf(a) - rankOf(b))[0]
  if (!award) return <p className="text-[0.9375rem] text-muted-foreground">{pending}</p>
  const { name } = awardTexts(tx, award)
  const shown = badges.shown.some((a) => a.award.id === award.award.id)
  return (
    <>
      <p className="text-[0.9375rem] text-muted-foreground">{shown ? tx.occasion.shown(name) : tx.occasion.given(name)}</p>
      {!shown && (
        <Button variant="secondary" disabled={busy} onClick={() => void run(() => showAward(pubkey, award))} className="h-11 w-full rounded-xl text-[1.0625rem] font-semibold">
          {tx.detail.show}
        </Button>
      )}
      {problem && <InlineStatus tone="error">{problem}</InlineStatus>}
    </>
  )
}
