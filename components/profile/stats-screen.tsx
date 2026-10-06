"use client"

import { StatsView } from "@/components/profile/stats-view"
import { useOwnProfile } from "@/components/profile/use-profile"
import { useT } from "@/components/i18n-provider"

// Profil › Statistik: the profile's own figures from this device's games.
export default function StatsScreen() {
  const t = useT()
  const own = useOwnProfile()
  if (!own || !own.history.loaded) return null
  if (!own.key) return <p className="mt-6 px-4 text-[1.0625rem] leading-snug text-muted-foreground">{t.profile.games.noneText}</p>
  return <StatsView matches={own.history.all} playerKey={own.key} aliases={own.history.aliases} sameAs={own.sameAs} />
}
