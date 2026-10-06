"use client"

import { useEffect, useState } from "react"
import { LoaderCircle, RefreshCw } from "lucide-react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatWhen } from "@/lib/i18n"
import { SYNC_TEXTS } from "@/lib/i18n/features/sync.screens"
import { onStorageChange } from "@/lib/storage/db"
import { outboxCounts, type OutboxCounts } from "@/lib/sync/outbox"
import { useSyncStatus } from "@/lib/sync/status"

// The sync's part of Profil › Erweitert (registry slot "profile.advanced"): when the profile's
// games were last synced and how that went, what still waits in the outbox, how many events fewer
// than two relays confirmed, and "Jetzt abgleichen". Figures come from this device; nothing here
// opens a connection until the person asks for a sync.
export default function SyncSection({ pubkey }: { pubkey: string }) {
  const t = useT()
  const tx = useAreaT(SYNC_TEXTS)
  const a = tx.advanced
  const status = useSyncStatus()
  const counts = useOutboxCounts()
  const mine = status.pubkey === pubkey
  const when = (ms: number | null) => (ms === null ? a.never : formatWhen(new Date(ms).toISOString(), t))
  const state = mine && status.state ? a.states[status.state] : null
  const problem = mine && status.problem ? a.problems[status.problem] : null

  return (
    <>
      <Group title={a.title} footer={a.footer}>
        <ListRow title={a.lastSync} subtitle={state} value={when(mine ? status.lastSync : null)} />
        <ListRow title={a.lastCheck} value={when(mine ? status.lastCheck : null)} />
        {counts && <ListRow title={a.waiting} value={counts.waiting} />}
        {counts && <ListRow title={a.fewCopies} value={counts.fewCopies} />}
        <ListRow
          icon={status.running ? LoaderCircle : RefreshCw}
          iconTone="blue"
          title={status.running ? a.syncing : a.syncNow}
          chevron={false}
          disabled={status.running}
          onClick={() => void import("@/lib/sync/service").then(({ syncNow }) => syncNow())}
        />
      </Group>
      {problem && (
        <InlineStatus tone={status.state === "unavailable" ? "error" : "info"} className="mt-4">
          {problem}
        </InlineStatus>
      )}
    </>
  )
}

// What the outbox holds, kept current with this tab's and other tabs' writes. null until read.
function useOutboxCounts() {
  const [counts, setCounts] = useState<OutboxCounts | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      void outboxCounts().then(
        (found) => alive && setCounts(found),
        () => alive && setCounts(null),
      )
    load()
    const stop = onStorageChange((message) => {
      if (message.type === "wipe" || message.stores.includes("outbox")) load()
    })
    return () => {
      alive = false
      stop()
    }
  }, [])
  return counts
}
