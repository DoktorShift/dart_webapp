"use client"

import { useEffect, useState } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/i18n-provider"
import { OutcomeHeader, entryStatus } from "@/components/payments/entry-status"
import { formatMsat } from "@/components/payments/format"
import { problemText } from "@/components/payments/problem"
import { InvoiceView } from "@/components/payments/receive-flow"
import { SheetActions } from "@/components/payments/sheet-actions"
import { useWallet } from "@/lib/payments/hooks"
import { checkStatus, type PaymentEntry } from "@/lib/payments/journal"
import { capabilities, withWallet } from "@/lib/payments/wallet"
import { watchReceipt } from "@/lib/payments/zap"

// What became of one payment, with what can be done about it: "Status prüfen" for an unknown
// outcome (never paying again), "Erneut versuchen" after a refusal (`onRetry`), the invoice again
// while it waits to be paid. A paid zap listens for its receipt while shown; until it arrives it
// says "Bezahlt · Beleg wird noch geladen", and nothing here pays again.
export function EntryOutcome({ entry, onRetry, onDone }: { entry: PaymentEntry; onRetry?: () => void; onDone: () => void }) {
  const t = useT()
  const p = t.payments.pay
  const wallet = useWallet()
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null)
  const amount = formatMsat(t, entry.amountMsat)
  const name = entry.counterpart.name
  const listening = entry.direction === "out" && !!entry.zap && !entry.zap.receipt && (entry.state === "paid" || entry.state === "unknown")

  useEffect(() => {
    if (!listening) return
    const watch = watchReceipt(entry, () => {})
    return () => watch.close()
    // The entry's id and zap stay the same while it is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, listening])

  if (entry.direction === "in" && wallet) return <InvoiceView entry={entry} info={wallet} />

  const check = async () => {
    setChecking(true)
    setNote(null)
    try {
      const result = await withWallet((w) => checkStatus(entry.id, w))
      if (result === "busy") setNote({ text: p.busy, tone: "info" })
      else if (result?.state === "unknown") setNote({ text: p.stillUnknown, tone: "info" })
    } catch (error) {
      setNote({ text: problemText(t, error), tone: "error" })
    } finally {
      setChecking(false)
    }
  }

  const { label } = entryStatus(t, entry)
  const header = (() => {
    switch (entry.state) {
      case "sending":
        return <OutcomeHeader tone="progress" working title={p.sending} text={p.sendingText} />
      case "paid":
      case "received":
        return <OutcomeHeader tone="success" title={label} text={entry.via === "manual" ? undefined : entry.direction === "out" ? p.paidText(amount, name) : t.payments.receive.receivedText(amount)} />
      case "unknown":
        return <OutcomeHeader tone="warning" title={p.unknownTitle} text={p.unknownText(amount, name)} />
      case "failed":
        return <OutcomeHeader tone="error" title={p.failedTitle} text={`${entry.problem ? t.payments.problem[entry.problem] : ""} ${p.nothingPaid}`.trim()} />
      default:
        return <OutcomeHeader tone="neutral" title={label} />
    }
  })()
  const canCheck = entry.state === "unknown" && !!wallet && capabilities(wallet).lookup
  const final = entry.state === "paid" || entry.state === "received"

  return (
    <>
      {header}
      {entry.state === "paid" && typeof entry.feesMsat === "number" && <p className="mt-2 text-center text-[0.9375rem] text-muted-foreground">{p.feesPaid(formatMsat(t, entry.feesMsat))}</p>}
      {entry.state === "unknown" && !canCheck && <InlineStatus className="mt-4">{p.noLookup}</InlineStatus>}
      {note && (
        <InlineStatus tone={note.tone} className="mt-4">
          {note.text}
        </InlineStatus>
      )}
      <SheetActions>
        {canCheck && (
          <Button onClick={check} disabled={checking} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {checking ? p.checking : p.check}
          </Button>
        )}
        {entry.state === "failed" && onRetry && (
          <Button onClick={onRetry} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {p.retry}
          </Button>
        )}
        <Button variant={final ? "default" : "ghost"} onClick={onDone} className="h-12 w-full rounded-xl text-[1.0625rem]">
          {t.common.done}
        </Button>
      </SheetActions>
    </>
  )
}
