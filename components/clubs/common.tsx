"use client"

import { useEffect, useState, type ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useAreaT, useT } from "@/components/i18n-provider"
import { signerProblem } from "@/components/profile/signer-status"
import { CLUBS_TEXTS, type ClubsTexts } from "@/lib/i18n/features/clubs.screens"
import { PROFILE_TEXTS, type ProfileTexts } from "@/lib/i18n/features/profile.screens"
import type { Messages } from "@/lib/i18n"
import type { ClubTask, ClubView } from "@/lib/clubs/club"
import type { ClubGame } from "@/lib/clubs/games"
import { ClubOutdatedError } from "@/lib/clubs/membership"
import { ClubSignerError, waitingEvents } from "@/lib/clubs/send"
import { useClubs } from "@/components/clubs/use-clubs"
import type { NameInfo } from "@/components/clubs/use-names"
import { onStorageChange } from "@/lib/storage/db"
import { cn } from "@/lib/utils"

// Small pieces every club screen shares: how times and people are written, what to say when
// signing fails, the honest lines about the local copy (when relays last answered, what is still
// on its way), the one question before something is removed or given away, and the shape of a
// club sheet.

export const formatDateTime = (unix: number, t: Messages) =>
  new Date(unix * 1000).toLocaleString(t.intl, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export const formatDate = (unix: number, t: Messages) => new Date(unix * 1000).toLocaleDateString(t.intl, { day: "numeric", month: "short", year: "numeric" })

export const formatTime = (ms: number, t: Messages) => new Date(ms).toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit" })

// The start of a key, grouped, to tell two people with the same name apart (design rules).
export const shortId = (pubkey: string) => `${pubkey.slice(0, 4)} ${pubkey.slice(4, 8)}`

// What a person is called in a club: their public name, or the alias they played under here,
// or "Ohne Namen". `me` names the signed-in person "Du".
export function personName(pubkey: string, info: NameInfo, tx: ClubsTexts, options: { me?: string | null; alias?: string } = {}) {
  if (options.me && options.me === pubkey) return tx.you
  return info.name ?? options.alias ?? tx.unnamed
}

// Keys whose names are shared with another key in the list: they get the id hint.
export function sameNames(pubkeys: readonly string[], nameOf: (pubkey: string) => string): Set<string> {
  const byName = new Map<string, string[]>()
  for (const pubkey of pubkeys) byName.set(nameOf(pubkey), [...(byName.get(nameOf(pubkey)) ?? []), pubkey])
  return new Set([...byName.values()].filter((keys) => keys.length > 1).flat())
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

// How many of the club's events the outbox still sends, read again whenever the outbox or the
// club's copy changes (in this tab or another).
function useWaiting(club: string): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let current = true
    const read = () =>
      void waitingEvents(club).then(
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
// (the outbox sends it by itself). "Aktualisieren" shows that it is working and, when no relay
// answers, that the tap changed nothing but the knowledge.
export function SyncLine({ view, onRefresh }: { view: ClubView; onRefresh?: () => Promise<unknown> }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const { refreshing, online } = useClubs()
  const waiting = useWaiting(view.id)
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
  const when = view.loadedAt === null ? tx.club.neverLoaded : tx.club.loadedAt(formatTime(view.loadedAt, t))
  return (
    <div className="mt-6 flex items-center justify-between gap-3 px-4 text-[0.8125rem] text-muted-foreground">
      <p className="[overflow-wrap:anywhere]">
        {online === false && !loading ? `${tx.club.offline} · ${when}` : when}
        {waiting > 0 && <span className="block">{tx.club.waiting(waiting)}</span>}
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
      return tx.tasks.answer(formatDateTime(task.date.starts, t))
  }
}

// The task line's way into the club: which task to open there (club-screen.tsx).
export function taskParams(task: ClubTask): Record<string, string> {
  return { task: task.kind, ...(task.kind === "verdict" || task.kind === "decide" ? { game: task.game.match } : {}) }
}

// One question with a cancel and one answer; red when the answer removes something. A field
// the answer needs (an optional reason) sits between question and answer.
export function Confirm({
  open,
  onOpenChange,
  title,
  text,
  confirm,
  destructive,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  text: string
  confirm: string
  destructive?: boolean
  onConfirm: () => void
  children?: ReactNode
}) {
  const t = useT()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">{title}</AlertDialogTitle>
          <AlertDialogDescription>{text}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={destructive ? "h-11 bg-danger text-white hover:bg-danger/90" : "h-11"}>
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// The scrolling part of a club sheet: room at its end, so a button at the bottom is never cut
// through its label by the pinned one on a small phone.
export function SheetBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-h-0 overflow-y-auto overscroll-contain pb-4", className)}>{children}</div>
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
