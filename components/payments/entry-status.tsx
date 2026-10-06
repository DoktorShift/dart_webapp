"use client"

import type { ComponentType, ReactNode } from "react"
import { useReducedMotion } from "framer-motion"
import { CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT } from "@/components/i18n-provider"
import { useFormat } from "@/components/payments/format"
import { PAYMENTS_TEXTS, type PaymentTexts } from "@/lib/i18n/features/payments.screens"
import type { PaymentEntry } from "@/lib/payments/journal"
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

export const TONE_COLORS: Record<Tone, string> = {
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
export function StatusIcon({ tone, className }: { tone: Tone; className?: string }) {
  const Icon = ICONS[tone]
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", TONE_COLORS[tone], className)} aria-hidden />
}

// A small symbol with the status text, for rows and lists.
export function StatusLabel({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-start gap-1.5", TONE_COLORS[tone], className)}>
      <StatusIcon tone={tone} className="mt-[0.1875rem]" />
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

// A payment in a list: who, how it stands, how much.
export function EntryRow({ entry, onClick }: { entry: PaymentEntry; onClick: () => void }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const format = useFormat()
  const { label, tone } = entryStatus(tx, entry)
  return <ListRow title={entryTitle(tx, entry)} subtitle={<StatusLabel tone={tone}>{label}</StatusLabel>} value={format.msat(entry.amountMsat)} onClick={onClick} />
}
