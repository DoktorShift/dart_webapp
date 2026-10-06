"use client"

import { StatsView } from "@/components/profile/stats-view"
import { useOwnProfile } from "@/components/profile/use-profile"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"

// Profil › Statistik: the profile's own figures from this device's games.
export default function StatsScreen() {
  const tx = useAreaT(PROFILE_TEXTS)
  const own = useOwnProfile()
  if (!own || !own.history.loaded) return null
  if (!own.key) return <p className="mt-6 px-4 text-[1.0625rem] leading-snug text-muted-foreground">{tx.games.noneText}</p>
  return <StatsView matches={own.history.all} playerKey={own.key} aliases={own.history.aliases} sameAs={own.sameAs} />
}
