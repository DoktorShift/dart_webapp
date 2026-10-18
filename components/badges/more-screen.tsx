"use client"

import { Group } from "@/components/ui/group"
import { useAreaT } from "@/components/i18n-provider"
import { AwardRow } from "@/components/badges/rows"
import { awardVoided, useOwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile } from "@/components/profile/use-profile"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"

// Profil › Auszeichnungen › Weitere erhaltene Auszeichnungen: awards from issuers the profile
// doesn't know yet (lib/badges/awards.ts splitReceived). Nothing here counts as new, and a
// badge's picture loads only when the person opens it. Showing one in the profile makes its
// issuer known, so the issuer's other badges count from then on.
export default function MoreBadgesScreen() {
  const tx = useAreaT(BADGES_TEXTS)
  const own = useOwnProfile()
  const badges = useOwnBadges(own?.session.pubkey ?? null)
  if (!own || badges.unvouched.length === 0) return null
  return (
    <Group footer={tx.list.moreFooter}>
      {badges.unvouched.map((award) => (
        <AwardRow key={award.award.id} award={award} subtitle={tx.list.received} voided={awardVoided(own, badges, award)} />
      ))}
    </Group>
  )
}
