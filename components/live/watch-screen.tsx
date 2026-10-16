"use client"

import { useMemo } from "react"
import { CircleDot } from "lucide-react"
import { readPayload } from "@/components/live/link-payload"
import { MatchView, useFollowed } from "@/components/live/match-view"
import { useAreaT } from "@/components/i18n-provider"
import { LIVE_TEXTS } from "@/lib/i18n/features/live.screens"
import { EmptyState } from "@/components/ui/empty-state"
import { liveRelays } from "@/lib/live/keys"
import type { ScreenProps } from "@/lib/shell/registry"

// "Zuschauen" (/#watch=…): a live game, read-only, on a phone or, full screen, on a TV.
export default function WatchScreen({ params }: ScreenProps) {
  const tx = useAreaT(LIVE_TEXTS)
  const link = useMemo(() => readPayload("watch", params.payload), [params.payload])
  const followed = useFollowed(link && { match: link.match, key: link.key ?? null, relays: link.relays.length > 0 ? link.relays : liveRelays() })
  if (!link) return <EmptyState icon={CircleDot} title={tx.watch.invalid} />
  return <MatchView followed={followed} />
}
