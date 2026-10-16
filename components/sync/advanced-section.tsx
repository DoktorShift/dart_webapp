"use client"

import { LoaderCircle, RefreshCw } from "lucide-react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatWhen } from "@/lib/i18n"
import { SYNC_TEXTS } from "@/lib/i18n/features/sync.screens"
import { useStored } from "@/lib/storage/hooks"
import { outboxCounts } from "@/lib/sync/outbox"
import { useSyncStatus } from "@/lib/sync/status"
import { cn } from "@/lib/utils"

// The sync's part of Profil › Erweitert (registry slot "profile.advanced"): when the profile's
// games were last synced and how that went, with the reason right there when it wasn't complete,
// what still waits to be sent (only when something does: changes the last sync didn't write,
// and events the relays haven't all taken), and "Jetzt abgleichen". Figures come from this
// device; nothing here opens a connection until the person asks for a sync.
export default function SyncSection({ pubkey }: { pubkey: string }) {
  const t = useT()
  const a = useAreaT(SYNC_TEXTS).advanced
  const status = useSyncStatus()
  const counts = useOutboxCounts()
  const mine = status.pubkey === pubkey
  const state = mine && status.state ? a.states[status.state] : null
  const problem = mine && status.problem ? a.problems[status.problem] : null
  const notSent = (mine ? status.pending : 0) + (counts?.waiting ?? 0)

  return (
    <>
      <Group title={a.title} footer={a.footer}>
        <ListRow title={a.lastSync} subtitle={state && problem ? `${state} · ${problem}` : state} value={mine && status.lastSync !== null ? formatWhen(new Date(status.lastSync).toISOString(), t) : a.never} />
        {notSent > 0 && <ListRow title={a.notSent} subtitle={a.notSentHint} value={notSent} />}
        {status.running ? (
          <ListRow icon={Turning} iconTone="blue" title={a.syncing} />
        ) : (
          <ListRow icon={RefreshCw} iconTone="blue" title={a.syncNow} chevron={false} onClick={() => void import("@/lib/sync/service").then(({ syncNow }) => syncNow())} />
        )}
      </Group>
      <p role="status" className="sr-only">
        {status.running ? a.syncing : ""}
      </p>
    </>
  )
}

// The loader glyph, turning (not with Reduce Motion).
function Turning({ className, ...props }: { className?: string; "aria-hidden"?: boolean }) {
  return <LoaderCircle className={cn("motion-safe:animate-spin", className)} {...props} />
}

// What the outbox holds, kept current with this tab's and other tabs' writes. null until read.
const loadCounts = () => outboxCounts().catch(() => null)
const useOutboxCounts = () => useStored("outbox", loadCounts)[0] ?? null
