"use client"

import { useEffect, useState } from "react"
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
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { useFormat } from "@/components/payments/format"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { hasExpired, resolveByHand, type PaymentEntry } from "@/lib/payments/journal"
import { cn } from "@/lib/utils"

// "In deiner Wallet nachgesehen?": an open payment that BlueLine can't ask the wallet about (it
// went through another connection, the wallet may not look payments up, or it has no answer) is
// settled from what the person's wallet shows (lib/payments/journal.ts resolveByHand). "Not paid"
// is offered only once the code has expired and can't be paid any more. Each choice is confirmed
// first, and the payment stays marked as noted by hand.

const DAY_MS = 86_400_000

// Whether the entry's code has expired, turning true when it does while shown.
export function useHasExpired(entry: PaymentEntry) {
  const [now, setNow] = useState(() => Date.now())
  const expired = hasExpired(entry, now)
  useEffect(() => {
    if (expired || entry.expiresAt === null) return
    // setTimeout can't wait longer than about 24 days; a day at a time is plenty.
    const timer = setTimeout(() => setNow(Date.now()), Math.min(entry.expiresAt * 1000 - Date.now() + 100, DAY_MS))
    return () => clearTimeout(timer)
  }, [expired, entry.expiresAt, now])
  return expired
}

export function ResolveByHand({ entry }: { entry: PaymentEntry }) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const format = useFormat()
  const expired = useHasExpired(entry)
  // The choice to confirm; kept while the alert closes, so its text doesn't change meanwhile.
  const [choice, setChoice] = useState<"done" | "not-done">("done")
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const texts = entry.direction === "out" ? tx.byHand.outgoing : tx.byHand.incoming
  const amount = format.msat(entry.amountMsat)

  const ask = (outcome: "done" | "not-done") => {
    setChoice(outcome)
    setAsking(true)
  }
  const note = async () => setBusy((await resolveByHand(entry.id, choice)) === "busy")

  return (
    <>
      <Group title={tx.byHand.title} footer={!expired && entry.expiresAt !== null ? texts.notYet(format.time(entry.expiresAt * 1000)) : undefined}>
        <ListRow title={texts.done} chevron={false} onClick={() => ask("done")} className="text-primary" />
        {expired && <ListRow title={texts.notDone} chevron={false} onClick={() => ask("not-done")} className="text-primary" />}
      </Group>
      {busy && <InlineStatus className="mt-3">{tx.pay.busy}</InlineStatus>}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{choice === "done" ? texts.doneTitle : texts.notDoneTitle}</AlertDialogTitle>
            <AlertDialogDescription>{choice === "done" ? texts.doneText(amount, entry.counterpart.name) : texts.notDoneText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void note()} className={cn("h-11", choice === "not-done" && "bg-danger text-white hover:bg-danger/90")}>
              {tx.byHand.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
