"use client"

import type { ComponentType, ReactNode } from "react"
import { useReducedMotion } from "framer-motion"
import { CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT } from "@/components/i18n-provider"
import { useMoney } from "@/components/payments/use-money"
import { PAYMENTS_TEXTS, type PaymentTexts } from "@/lib/i18n/features/payments.screens"
import { describeAction } from "@/lib/payments/actions"
import { isDone, type PaymentEntry } from "@/lib/payments/journal"
import { negative } from "@/lib/payments/money"
import { cn } from "@/lib/utils"

// How a payment stands, in words and with a symbol, never by colour alone (PLAN.md "Zustände").

export type Tone = "success" | "progress" | "warning" | "error" | "neutral"

export function entryStatus(tx: PaymentTexts, entry: PaymentEntry): { label: string; tone: Tone } {
  const s = tx.state
  switch (entry.state) {
    case "paid":
      if (entry.via === "manual") return { label: s.settledHere, tone: "success" }
      if (entry.resolvedByHand) return { label: s.paidByHand, tone: "success" }
      if (entry.zap) return entry.zap.receipt ? { label: s.receiptConfirmed, tone: "success" } : { label: s.receiptPending, tone: "success" }
      return { label: s.paid, tone: "success" }
    case "received":
      return { label: entry.via === "manual" ? s.settledHere : entry.resolvedByHand ? s.receivedByHand : s.received, tone: "success" }
    case "sending":
      return { label: s.sending, tone: "progress" }
    case "waiting":
      return { label: s.waiting, tone: "progress" }
    case "unknown":
      return { label: s.unknown, tone: "warning" }
    case "failed":
      return entry.resolvedByHand ? { label: s.notPaidByHand, tone: "neutral" } : { label: s.failed, tone: "error" }
    case "expired":
      return { label: entry.resolvedByHand ? s.notReceivedByHand : s.expired, tone: "neutral" }
  }
}

const ICONS: Record<Tone, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  success: CircleCheck,
  progress: Clock,
  warning: CircleAlert,
  error: CircleX,
  neutral: Clock,
}

const TONE_COLORS: Record<Tone, string> = {
  success: "text-success",
  progress: "text-primary",
  warning: "text-warning",
  error: "text-danger",
  neutral: "text-muted-foreground",
}

const CIRCLES: Record<Tone, string> = {
  success: "bg-success/10",
  progress: "bg-primary/10",
  warning: "bg-warning/15",
  error: "bg-danger/10",
  neutral: "bg-secondary",
}

// The small symbol of a status, in its colour, next to text that says it.
function StatusIcon({ tone, className }: { tone: Tone; className?: string }) {
  const Icon = ICONS[tone]
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", TONE_COLORS[tone], className)} aria-hidden />
}

// A small symbol with the status text, for rows and lists.
export function StatusLabel({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-start gap-1.5", TONE_COLORS[tone], className)}>
      <StatusIcon tone={tone} className="mt-0.75" />
      <span>{children}</span>
    </span>
  )
}

// The big outcome at the top of a payment sheet: symbol, title and one or two sentences.
// `working` shows a spinner instead (standing still with reduced motion).
export function OutcomeHeader({ tone, title, text, working = false }: { tone: Tone; title: string; text?: ReactNode; working?: boolean }) {
  const reduceMotion = useReducedMotion()
  const Icon = working ? LoaderCircle : ICONS[tone]
  return (
    <div role="status" className="flex flex-col items-center px-2 pt-2 text-center">
      <span className={cn("flex h-14 w-14 items-center justify-center rounded-full", CIRCLES[tone], TONE_COLORS[tone])}>
        <Icon className={cn("h-8 w-8", working && !reduceMotion && "animate-spin")} aria-hidden />
      </span>
      <h3 className="mt-3 text-xl font-semibold leading-tight text-foreground">{title}</h3>
      {text && <p className="mt-1.5 max-w-sm text-[0.9375rem] leading-snug text-muted-foreground">{text}</p>}
    </div>
  )
}

// What a payment is called in a list and as a sheet's title: who it went to or came from; an
// invoice from Zahlungen names nobody.
export function entryTitle(tx: PaymentTexts, { direction, counterpart }: PaymentEntry) {
  if (direction === "out") return counterpart.name ? tx.to(counterpart.name) : tx.pay.invoice
  return counterpart.name ? tx.from(counterpart.name) : tx.receive.title
}

// What a payment in a list was for: its game ("Einsatz · 301 gegen Ben", `game` as the caller
// knows it from the archive), else who it went to or came from.
export function entryLabel(tx: PaymentTexts, entry: PaymentEntry, game: string | null): string {
  const { kind } = describeAction(entry.action)
  const name = entry.counterpart.name
  const who = entryTitle(tx, entry)
  switch (kind) {
    case "stake":
      return tx.entry.stake(game ?? who)
    case "pay":
      return game ? tx.entry.afterGame(game) : who
    case "receive":
      return game ? tx.entry.receivedAfter(game) : tx.entry.received
    case "congratulate":
      if (!name) return tx.detail.reasons.congratulate
      return entry.direction === "out" ? tx.entry.congratulateTo(name) : tx.entry.congratulateFrom(name)
    default:
      return entry.direction === "out" ? (name ? tx.to(name) : tx.entry.code) : tx.entry.received
  }
}

// A payment in a list: what for, how it stands and when, how much on both sides. Money that
// went out carries a minus once it is paid; nothing else is signed.
export function EntryRow({ entry, title, onClick }: { entry: PaymentEntry; title?: string; onClick: () => void }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const money = useMoney({ live: false })
  const { label, tone } = entryStatus(tx, entry)
  const sign = (text: string) => (entry.direction === "out" && isDone(entry) ? negative(text) : text)
  const secondary = money.secondary(entry.amountMsat, entry.fiat)
  return (
    <ListRow
      title={title ?? entryTitle(tx, entry)}
      subtitle={
        <StatusLabel tone={tone}>
          {label} · {money.time(entry.updatedAt)}
        </StatusLabel>
      }
      value={
        <span className="flex flex-col items-end tabular-nums">
          <span>{sign(money.primary(entry.amountMsat, entry.fiat))}</span>
          {secondary && <span className="text-[0.8125rem] text-muted-foreground">{sign(secondary)}</span>}
        </span>
      }
      onClick={onClick}
    />
  )
}
