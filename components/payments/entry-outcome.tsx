"use client"

import { useEffect, useState } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { Button } from "@/components/ui/button"
import { useAreaT, useT } from "@/components/i18n-provider"
import { OutcomeHeader, entryStatus } from "@/components/payments/entry-status"
import { useFormat } from "@/components/payments/format"
import { problemText } from "@/components/payments/problem"
import { InvoiceView } from "@/components/payments/receive-flow"
import { ResolveByHand } from "@/components/payments/resolve-by-hand"
import { SheetActions } from "@/components/payments/sheet-actions"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useWallet } from "@/lib/payments/hooks"
import { checkStatus, type PaymentEntry } from "@/lib/payments/journal"
import { capabilities, withWallet } from "@/lib/payments/wallet"
import { watchReceipt } from "@/lib/payments/zap"

// What became of one payment, with what can be done about it: "Status prüfen" for an outcome not
// known yet (never paying again), settling it from what the wallet shows where BlueLine can't ask,
// "Erneut versuchen" after a refusal (`onRetry`), the invoice again while it waits to be paid. A
// paid zap listens for its receipt while shown; until it arrives it says "Bezahlt · Beleg wird
// noch geladen", and nothing here pays again. `reason` says why it is shown instead of a new
// payment (paid in another window), with `onPayAgain` to pay once more.
export function EntryOutcome({
  entry,
  reason,
  onRetry,
  onPayAgain,
  onDone,
}: {
  entry: PaymentEntry
  reason?: string
  onRetry?: () => void
  onPayAgain?: () => void
  onDone: () => void
}) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const p = tx.pay
  const format = useFormat()
  const wallet = useWallet()
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null)
  const listening = entry.direction === "out" && !!entry.zap && !entry.zap.receipt && (entry.state === "paid" || entry.state === "unknown")

  useEffect(() => {
    if (!listening) return
    const watch = watchReceipt(entry)
    return () => watch.close()
    // The entry's id and zap stay the same while it is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, listening])

  if (wallet === undefined) return null
  if (entry.direction === "in") return <InvoiceView entry={entry} info={wallet} />

  const amount = format.msat(entry.amountMsat)
  const name = entry.counterpart.name
  // Another connection can confirm a payment, never rule it out (lib/payments/journal.ts).
  const otherWallet = wallet !== null && wallet.connection !== entry.connection
  const canLookup = wallet !== null && capabilities(wallet).lookup
  // A payment still "sending" is being sent in another window, or was left by one that closed:
  // checking tells which, also without a wallet that can look it up.
  const canCheck = entry.state === "sending" || (entry.state === "unknown" && canLookup)
  const hint = entry.state !== "unknown" ? null : otherWallet ? p.otherWallet : canLookup ? null : p.noLookup

  const check = async () => {
    setChecking(true)
    setNote(null)
    try {
      const result = canLookup ? await withWallet((w) => checkStatus(entry.id, w)) : await checkStatus(entry.id, null)
      if (result === "busy") setNote({ text: p.busy, tone: "info" })
      else if (result?.state === "unknown" && !hint) setNote({ text: p.stillUnknown, tone: "info" })
    } catch (error) {
      setNote({ text: problemText(tx, error), tone: "error" })
    } finally {
      setChecking(false)
    }
  }

  const { label } = entryStatus(tx, entry)
  const header = (() => {
    switch (entry.state) {
      case "sending":
        return <OutcomeHeader tone="progress" working title={p.sending} text={p.sendingText} />
      case "paid":
        return <OutcomeHeader tone="success" title={label} text={entry.via === "manual" ? undefined : entry.resolvedByHand ? tx.byHand.note : p.paidText(amount, name)} />
      case "unknown":
        return <OutcomeHeader tone="warning" title={p.unknownTitle} text={p.unknownText(amount, name)} />
      case "failed":
        if (entry.resolvedByHand) return <OutcomeHeader tone="neutral" title={label} text={tx.byHand.note} />
        return <OutcomeHeader tone="error" title={p.failedTitle} text={`${entry.problem ? tx.problem[entry.problem] : ""} ${p.nothingPaid}`.trim()} />
      default:
        return <OutcomeHeader tone="neutral" title={label} />
    }
  })()

  return (
    <>
      {header}
      {entry.state === "paid" && typeof entry.feesMsat === "number" && <p className="mt-2 text-center text-[0.9375rem] text-muted-foreground">{p.feesPaid(format.msat(entry.feesMsat))}</p>}
      {reason && <InlineStatus className="mt-4">{reason}</InlineStatus>}
      {hint && <InlineStatus className="mt-4">{hint}</InlineStatus>}
      {note && (
        <InlineStatus tone={note.tone} className="mt-4">
          {note.text}
        </InlineStatus>
      )}
      {entry.state === "unknown" && <ResolveByHand entry={entry} />}
      <SheetActions>
        {canCheck && (
          <Button onClick={check} disabled={checking} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {checking ? p.checking : p.check}
          </Button>
        )}
        {entry.state === "failed" && !entry.resolvedByHand && onRetry && (
          <Button onClick={onRetry} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {p.retry}
          </Button>
        )}
        {onPayAgain && (
          <Button variant="secondary" onClick={onPayAgain} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold text-primary">
            {p.payAgain}
          </Button>
        )}
        <Button variant={entry.state === "paid" && !onPayAgain ? "default" : "ghost"} onClick={onDone} className="h-12 w-full rounded-xl text-[1.0625rem]">
          {t.common.done}
        </Button>
      </SheetActions>
    </>
  )
}
