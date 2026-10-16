"use client"

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
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { signerProblem } from "@/components/profile/signer-status"
import { CLUBS_TEXTS, type ClubsTexts } from "@/lib/i18n/features/clubs.screens"
import { PROFILE_TEXTS, type ProfileTexts } from "@/lib/i18n/features/profile.screens"
import type { Messages } from "@/lib/i18n"
import type { ClubTask, ClubView } from "@/lib/clubs/club"
import type { ClubGame } from "@/lib/clubs/games"
import { ClubSignerError, resend } from "@/lib/clubs/send"
import type { NameInfo } from "@/components/clubs/use-names"

// Small pieces every club screen shares: how times and people are written, what to say when
// signing fails, the honest lines about the local copy (when relays last answered, what is not
// sent yet), and the one question before something is removed or given away.

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

// What to tell the person when a club change couldn't be signed or encrypted.
function problemText(error: unknown, tx: ClubsTexts, px: ProfileTexts): string {
  return error instanceof ClubSignerError ? tx.club.noEncryption : signerProblem(px, error)
}

// Runs a club change and reports its problem in the caller's words.
export function useChange() {
  const tx = useAreaT(CLUBS_TEXTS)
  const px = useAreaT(PROFILE_TEXTS)
  return (error: unknown) => problemText(error, tx, px)
}

// When relays last answered for the club, and what this device wrote that no relay confirmed
// yet, with one way to send it again.
export function SyncLine({ view, onRefresh }: { view: ClubView; onRefresh?: () => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  return (
    <div className="mt-6 flex flex-col gap-2">
      {view.unsent.length > 0 && (
        <InlineStatus tone="info">
          {tx.club.unsent(view.unsent.length)}{" "}
          <button type="button" onClick={() => void resend(view.id, view.unsent)} className="font-semibold text-primary underline-offset-2 hover:underline">
            {tx.club.resend}
          </button>
        </InlineStatus>
      )}
      <div className="flex items-center justify-between gap-3 px-4 text-[0.8125rem] text-muted-foreground">
        <span>{view.loadedAt === null ? tx.club.neverLoaded : tx.club.loadedAt(formatTime(view.loadedAt, t))}</span>
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh} className="h-9 gap-1.5 rounded-lg px-2 text-[0.8125rem] text-primary hover:bg-primary/10 hover:text-primary">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {tx.club.refresh}
          </Button>
        )}
      </div>
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
    case "requests":
      return tx.tasks.requests(task.count)
    case "decide":
      return tx.tasks.decide(gameLabel(task.game))
    case "answer":
      return tx.tasks.answer(formatDateTime(task.date.starts, t))
  }
}

// One question with a cancel and one answer; red when the answer removes something.
export function Confirm({
  open,
  onOpenChange,
  title,
  text,
  confirm,
  destructive,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  text: string
  confirm: string
  destructive?: boolean
  onConfirm: () => void
}) {
  const t = useT()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">{title}</AlertDialogTitle>
          <AlertDialogDescription>{text}</AlertDialogDescription>
        </AlertDialogHeader>
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
