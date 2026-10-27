"use client"

import { useEffect, useState, type ReactNode } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { Button } from "@/components/ui/button"
import { useAreaT, useT } from "@/components/i18n-provider"
import { useAutoClose } from "@/components/payments/amount-block"
import { OutcomeHeader, entryStatus } from "@/components/payments/entry-status"
import { useMoney } from "@/components/payments/use-money"
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
// payment (paid in another window), with `onPayAgain` to pay once more. `autoClose`: the
// outcome just arrived in this sheet, so once it says "Bezahlt" the sheet closes by itself.
// `children` are the detail's rows, between the outcome and its buttons.
export function EntryOutcome({
  entry,
  reason,
  autoClose = false,
  onRetry,
  onPayAgain,
  onDone,
  children,
}: {
  entry: PaymentEntry
  reason?: string
  autoClose?: boolean
  onRetry?: () => void
  onPayAgain?: () => void
  onDone: () => void
  children?: ReactNode
}) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const p = tx.pay
  const money = useMoney({ live: false })
  const wallet = useWallet()
  useAutoClose(autoClose && entry.direction === "out" && entry.state === "paid", onDone)
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null)
  // A check that didn't settle it: the person may look in their wallet instead.
  const [unsettled, setUnsettled] = useState(false)
  const listening = entry.direction === "out" && !!entry.zap && !entry.zap.receipt && (entry.state === "paid" || entry.state === "unknown")

  useEffect(() => {
    if (!listening) return
    const watch = watchReceipt(entry)
    return () => watch.close()
    // The entry's id and zap stay the same while it is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, listening])

  if (wallet === undefined) return null
  if (entry.direction === "in") {
    return (
      <InvoiceView entry={entry} info={wallet} autoClose={autoClose} onDone={onDone}>
        {children}
      </InvoiceView>
    )
  }

  const amount = money.primary(entry.amountMsat, entry.fiat)
  const name = entry.counterpart.name
  // Only the connection that paid can say what became of it; another one could at best confirm
  // it (lib/payments/journal.ts), so it isn't asked.
  const otherWallet = wallet !== null && wallet.connection !== entry.connection
  const canAsk = wallet !== null && !otherWallet && capabilities(wallet).lookup
  // A payment still "sending" is being sent in another window, or was left by one that closed:
  // checking tells which, also without a wallet that can look it up.
  const canCheck = entry.state === "sending" || (entry.state === "unknown" && canAsk)
  // Why BlueLine can't ask, where it can't.
  const hint = entry.state !== "unknown" || canAsk ? null : wallet === null ? p.noWallet : otherWallet ? p.otherWallet : p.noLookup
  // "In deiner Wallet nachgesehen?" is the way out where the wallet can't tell, or didn't.
  const byHand = entry.state === "unknown" && (hint !== null || unsettled)

  const check = async () => {
    setChecking(true)
    setNote(null)
    try {
      const result = canAsk ? await withWallet((w) => checkStatus(entry.id, w)) : await checkStatus(entry.id, null)
      if (result === "busy") setNote({ text: p.busy, tone: "info" })
      else if (result?.state === "unknown") {
        setNote({ text: p.stillUnknown, tone: "info" })
        setUnsettled(true)
      }
    } catch (error) {
      setNote({ text: problemText(tx, error), tone: "error" })
      setUnsettled(true)
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
      {entry.state === "paid" && typeof entry.feesMsat === "number" && !children && <p className="mt-2 text-center text-[0.9375rem] text-muted-foreground">{p.feesPaid(money.primary(entry.feesMsat))}</p>}
      {reason && <InlineStatus className="mt-4">{reason}</InlineStatus>}
      {byHand && <ResolveByHand entry={entry} hint={hint ?? undefined} />}
      {children}
      <SheetActions note={note && <InlineStatus tone={note.tone}>{note.text}</InlineStatus>}>
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
