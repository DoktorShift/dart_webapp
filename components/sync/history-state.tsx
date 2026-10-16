"use client"

import { useEffect, useState, type ReactNode } from "react"
import { CircleAlert, CloudOff, LoaderCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { useAreaT } from "@/components/i18n-provider"
import { SYNC_TEXTS, type SyncTexts } from "@/lib/i18n/features/sync.screens"
import { useSyncStatus, type SyncStatus } from "@/lib/sync/status"

// What the profile's list of games can honestly say while it is empty (decision 0002 §1: not
// loaded is not empty). "Noch keine Spiele" only once this device has looked for the profile's
// games on its relays; before that they are loading, or couldn't be loaded: no relay answered
// ("offline"), or the profile didn't open ("signer": no answer or declined; "key": its data key
// doesn't open with this signer). Loading is bounded: after a while without any answer the
// screen says so and offers a retry, rather than spinning on.
export type EmptyHistoryKind = "loading" | "offline" | "signer" | "key" | "none"

const LOADING_FOR_MS = 20_000

function kindOf(status: SyncStatus, pubkey: string): EmptyHistoryKind {
  if (status.pubkey !== pubkey) return "loading"
  // A signer that can't decrypt never loads them: the games here are all there will be.
  if (status.lastSync !== null || status.problem === "unsupported") return "none"
  if (status.state !== "unavailable" || status.running) return "loading"
  return status.problem === "signer" || status.problem === "key" ? status.problem : "offline"
}

export function useEmptyHistory(pubkey: string): EmptyHistoryKind {
  const kind = kindOf(useSyncStatus(), pubkey)
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    if (kind !== "loading") return
    const timer = setTimeout(() => setWaited(true), LOADING_FOR_MS)
    return () => {
      clearTimeout(timer)
      setWaited(false)
    }
  }, [kind])
  return kind === "loading" && waited ? "offline" : kind
}

// What each state short of "none" says.
function wording(h: SyncTexts["history"], kind: Exclude<EmptyHistoryKind, "none">) {
  switch (kind) {
    case "loading":
      return { title: h.loading, text: h.loadingText }
    case "offline":
      return { title: h.unavailable, text: h.unavailableText }
    case "signer":
      return { title: h.notOpened, text: h.notOpenedText }
    case "key":
      return { title: h.notOpened, text: h.keyText }
  }
}

// One line for the profile card, in place of "no games yet".
export function useEmptyHistoryLine(pubkey: string, none: string): string {
  const tx = useAreaT(SYNC_TEXTS)
  const kind = useEmptyHistory(pubkey)
  return kind === "none" ? none : wording(tx.history, kind).text
}

// The empty state of Profil › Spiele: `none` is what the screen shows once the games were looked for.
export function EmptyHistory({ pubkey, none }: { pubkey: string; none: ReactNode }) {
  const tx = useAreaT(SYNC_TEXTS)
  const kind = useEmptyHistory(pubkey)
  if (kind === "none") return none
  const { title, text } = wording(tx.history, kind)
  if (kind === "loading") return <EmptyState art={<Spinner />} title={title} description={text} />
  const retry = () => void import("@/lib/sync/service").then(({ syncNow }) => syncNow())
  return <EmptyState icon={kind === "offline" ? CloudOff : CircleAlert} title={title} description={text} primary={{ label: tx.history.retry, onClick: retry }} />
}

function Spinner() {
  return (
    <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
      <LoaderCircle className="h-9 w-9 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
    </span>
  )
}
