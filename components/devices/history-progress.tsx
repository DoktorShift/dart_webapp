"use client"

import { useEffect, useState } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/common/waiting"
import { Button } from "@/components/ui/button"
import { useAreaT } from "@/components/i18n-provider"
import { BACKUP_TEXTS } from "@/lib/i18n/features/backup.screens"
import { useSyncStatus } from "@/lib/sync/status"

// Once the profile is on this device: how its games from the other devices are coming, as the
// sync reports it (lib/sync/status.ts), honestly: loading, all there, some, or none yet, with
// one retry. Loading is bounded: after a while without any answer it says so.
const LOADING_FOR_MS = 20_000

export function HistoryProgress({ pubkey }: { pubkey: string }) {
  const h = useAreaT(BACKUP_TEXTS).history
  const status = useSyncStatus()
  const [waited, setWaited] = useState(false)
  const loading = status.pubkey !== pubkey || status.running || status.state === null
  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => setWaited(true), LOADING_FOR_MS)
    return () => {
      clearTimeout(timer)
      setWaited(false)
    }
  }, [loading])

  if (loading && !waited) return <Waiting className="py-2">{h.loading}</Waiting>
  if (!loading && status.state === "complete") return <InlineStatus tone="success">{h.complete}</InlineStatus>
  const retry = () => void import("@/lib/sync/service").then(({ syncNow }) => syncNow())
  return (
    <div className="grid gap-2">
      <InlineStatus>{!loading && status.state === "partial" ? h.partial : h.unavailable}</InlineStatus>
      <Button variant="secondary" onClick={retry} className="h-11 w-full rounded-xl text-[1.0625rem] text-primary">
        {h.retry}
      </Button>
    </div>
  )
}
