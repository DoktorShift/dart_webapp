"use client"

import { useEffect, useState, type ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useAreaT, useT } from "@/components/i18n-provider"
import { signerProblem } from "@/components/profile/signer-status"
import { CLUBS_TEXTS, type ClubsTexts } from "@/lib/i18n/features/clubs.screens"
import { PROFILE_TEXTS, type ProfileTexts } from "@/lib/i18n/features/profile.screens"
import { formatClock, formatDateTime, type Messages } from "@/lib/i18n"
import type { ClubTask, ClubView } from "@/lib/clubs/club"
import type { ClubGame } from "@/lib/clubs/games"
import { ClubOutdatedError } from "@/lib/clubs/membership"
import { ClubSignerError, unsentEvents, type Unsent } from "@/lib/clubs/send"
import { useClubs } from "@/components/clubs/use-clubs"
import type { NameInfo } from "@/components/profile/use-profile-names"
import { onStorageChange } from "@/lib/storage/db"
import { cn } from "@/lib/utils"

// Small pieces every club screen shares: how times and people are written, what to say when
// signing fails, the honest lines about the local copy (when relays last answered, what is still
// on its way), the one question before something is removed or given away, and the shape of a
// club sheet.

// What a person is called in a club: their public name, or the alias they played under here,
// or "Ohne Namen". `me` names the signed-in person "Du".
export function personName(pubkey: string, info: NameInfo, tx: ClubsTexts, options: { me?: string | null; alias?: string } = {}) {
  if (options.me && options.me === pubkey) return tx.you
  return info.name ?? options.alias ?? tx.unnamed
}

// What to tell the person when a club change couldn't be signed, encrypted or built on what
// this device has.
function problemText(error: unknown, tx: ClubsTexts, px: ProfileTexts): string {
  if (error instanceof ClubSignerError) return tx.club.noEncryption
  if (error instanceof ClubOutdatedError) return tx.club.outdated
  return signerProblem(px, error)
}

// Runs a club change and reports its problem in the caller's words.
export function useChange() {
  const tx = useAreaT(CLUBS_TEXTS)
  const px = useAreaT(PROFILE_TEXTS)
  return (error: unknown) => problemText(error, tx, px)
}

// How many of the club's events the outbox still sends, or holds as refused, read again
// whenever the outbox or the club's copy changes (in this tab or another).
function useUnsent(club: string): Unsent {
  const [count, setCount] = useState<Unsent>({ waiting: 0, refused: 0 })
  useEffect(() => {
    let current = true
    const read = () =>
      void unsentEvents(club).then(
        (n) => current && setCount(n),
        () => {},
      )
    read()
    const stop = onStorageChange((message) => {
      if (message.type === "wipe" || message.stores.includes("outbox") || message.stores.includes("objects")) read()
    })
    return () => {
      current = false
      stop()
    }
  }, [club])
  return count
}

// When relays last answered for the club, and what this device wrote that is still on its way
// (the outbox sends it by itself) or that the relays refused. "Aktualisieren" shows that it is
// working and, when no relay answers, that the tap changed nothing but the knowledge.
export function SyncLine({ view, onRefresh }: { view: ClubView; onRefresh?: () => Promise<unknown> }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const { refreshing, online } = useClubs()
  const unsent = useUnsent(view.id)
  const [busy, setBusy] = useState(false)
  const loading = busy || refreshing
  const refresh = async () => {
    setBusy(true)
    try {
      await onRefresh?.()
    } finally {
      setBusy(false)
    }
  }
  const when = view.loadedAt === null ? tx.club.neverLoaded : tx.club.loadedAt(formatClock(t, view.loadedAt))
  return (
    <div className="mt-6 flex items-center justify-between gap-3 px-4 text-[0.8125rem] text-muted-foreground">
      <p className="[overflow-wrap:anywhere]">
        {online === false && !loading ? `${tx.club.offline} · ${when}` : when}
        {unsent.waiting > 0 && <span className="block">{tx.club.waiting(unsent.waiting)}</span>}
        {unsent.refused > 0 && <span className="block text-warning">{tx.club.refused(unsent.refused)}</span>}
      </p>
      {onRefresh && (
        <Button variant="ghost" disabled={loading} onClick={() => void refresh()} className="h-11 shrink-0 gap-1.5 rounded-xl px-3 text-[0.9375rem] text-primary hover:bg-primary/10 hover:text-primary">
          <RefreshCw className={cn("h-4 w-4", loading && "motion-safe:animate-spin")} aria-hidden="true" />
          {loading ? tx.club.refreshing : tx.club.refresh}
        </Button>
      )}
    </div>
  )
}

// The head of a club: picture, name, description, and where this person stands in it.
export function ClubHeader({ view, subtitle }: { view: ClubView; subtitle?: string }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const info = view.info
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card px-4 py-4">
      <div className="flex items-center gap-4">
        <Avatar seed={view.id} name={info?.name ?? undefined} src={info?.picture} size={64} />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{info?.name ?? tx.unnamed}</h2>
          {subtitle && <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p>}
        </div>
      </div>
      {info?.about && <p className="mt-3 text-[0.9375rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{info.about}</p>}
    </section>
  )
}

// Where this person stands in the club, in one line.
export function membershipLine(view: ClubView, tx: ClubsTexts): string {
  const { me, info } = view
  if (info?.archived) return tx.home.status.archived
  switch (me.status) {
    case "member":
      return tx.roles[me.role ?? "member"]
    case "request":
      return tx.home.status.request
    case "joined":
      return tx.home.status.joined
    case "removed":
      return tx.home.status.removed
    case "left":
      return tx.home.status.left
    default:
      return view.invite ? tx.home.status.invitation : tx.home.status.outsider
  }
}

// A game by the names its players played under: "Olaf – Ben".
export const gameLabel = (game: ClubGame) => game.agreement.seats.map((s) => s.alias).join(" – ")

export function taskLabel(task: ClubTask, tx: ClubsTexts, t: Messages): string {
  switch (task.kind) {
    case "ownership":
      return tx.tasks.ownership
    case "verdict":
      return tx.tasks.verdict(gameLabel(task.game))
    case "access":
      return tx.tasks.access(task.count)
    case "requests":
      return tx.tasks.requests(task.count)
    case "decide":
      return task.why === "disputed" ? tx.tasks.disputed(gameLabel(task.game)) : tx.tasks.decide(gameLabel(task.game))
    case "answer":
      return tx.tasks.answer(formatDateTime(t, task.date.starts * 1000))
  }
}

// The task line's way into the club: which task to open there (club-screen.tsx).
export function taskParams(task: ClubTask): Record<string, string> {
  return { task: task.kind, ...(task.kind === "verdict" || task.kind === "decide" ? { game: task.game.match } : {}) }
}

// The pinned quiet button at the end of a club sheet ("Abbrechen", "Fertig"), with a fade above
// it so content scrolling under it reads as more, never as cut off.
export function SheetButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div className="relative shrink-0 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-gradient-to-t before:from-background before:to-transparent">
      <Button variant="ghost" onClick={onClick} className="h-12 w-full rounded-2xl text-[1.0625rem]">
        {children}
      </Button>
    </div>
  )
}
