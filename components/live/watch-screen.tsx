"use client"

import { useMemo } from "react"
import { CircleDot } from "lucide-react"
import { readPayload } from "@/components/live/link-payload"
import { MatchView, useFollowed } from "@/components/live/match-view"
import { useT } from "@/components/i18n-provider"
import { EmptyState } from "@/components/ui/empty-state"
import { liveRelays } from "@/lib/live/keys"
import type { ScreenProps } from "@/lib/shell/registry"

// "Zuschauen" (/#watch=…): a live game, read-only, on a phone or, full screen, on a TV.
export default function WatchScreen({ params }: ScreenProps) {
  const t = useT()
  const link = useMemo(() => readPayload("watch", params.payload), [params.payload])
  const followed = useFollowed(link && { match: link.match, key: link.key ?? null, relays: link.relays.length > 0 ? link.relays : liveRelays() })
  if (!link) return <EmptyState icon={CircleDot} title={t.live.watch.invalid} />
  return <MatchView followed={followed} />
}
