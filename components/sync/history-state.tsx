"use client"

import type { ReactNode } from "react"
import { CloudOff, LoaderCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { useAreaT } from "@/components/i18n-provider"
import { SYNC_TEXTS } from "@/lib/i18n/features/sync.screens"
import { useSyncStatus } from "@/lib/sync/status"

// What the profile's list of games can honestly say while it is empty (decision 0002 §1: not
// loaded is not empty). "Noch keine Spiele" only once this device has looked for the profile's
// games on its relays; before that they are loading, or couldn't be loaded.
export type EmptyHistoryKind = "loading" | "unavailable" | "none"

export function useEmptyHistory(pubkey: string): EmptyHistoryKind {
  const status = useSyncStatus()
  if (status.pubkey !== pubkey) return "loading"
  // A signer that can't decrypt never loads them: the games here are all there will be.
  if (status.lastSync !== null || status.problem === "unsupported") return "none"
  return status.state === "unavailable" && !status.running ? "unavailable" : "loading"
}

// One line for the profile card, in place of "no games yet".
export function useEmptyHistoryLine(pubkey: string, none: string): string {
  const tx = useAreaT(SYNC_TEXTS)
  const kind = useEmptyHistory(pubkey)
  return kind === "none" ? none : kind === "loading" ? tx.history.loadingText : tx.history.unavailableText
}

// The empty state of Profil › Spiele: `none` is what the screen shows once the games were looked for.
export function EmptyHistory({ pubkey, none }: { pubkey: string; none: ReactNode }) {
  const tx = useAreaT(SYNC_TEXTS)
  const kind = useEmptyHistory(pubkey)
  if (kind === "none") return none
  if (kind === "loading") {
    return <EmptyState art={<Spinner />} title={tx.history.loading} description={tx.history.loadingText} />
  }
  const retry = () => void import("@/lib/sync/service").then(({ syncNow }) => syncNow())
  return <EmptyState icon={CloudOff} title={tx.history.unavailable} description={tx.history.unavailableText} secondary={{ label: tx.history.retry, onClick: retry }} />
}

function Spinner() {
  return (
    <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
      <LoaderCircle className="h-9 w-9 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
    </span>
  )
}
