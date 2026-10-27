"use client"

import { useEffect, useState } from "react"
import { Confirm } from "@/components/ui/confirm"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { useMoney } from "@/components/payments/use-money"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { hasExpired, resolveByHand, type PaymentEntry } from "@/lib/payments/journal"

// "In deiner Wallet nachgesehen?": an open payment that BlueLine can't ask the wallet about (it
// went through another connection, the wallet may not look payments up, or it has no answer) is
// settled from what the person's wallet shows (lib/payments/journal.ts resolveByHand). "Not paid"
// is offered only once the code has expired and can't be paid any more. Each choice is confirmed
// first, and the payment stays marked as noted by hand. `hint` says why it is up to the person,
// as the group's footnote.

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

export function ResolveByHand({ entry, hint }: { entry: PaymentEntry; hint?: string }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const money = useMoney({ live: false })
  const expired = useHasExpired(entry)
  // The choice to confirm; kept while the alert closes, so its text doesn't change meanwhile.
  const [choice, setChoice] = useState<"done" | "not-done">("done")
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const texts = entry.direction === "out" ? tx.byHand.outgoing : tx.byHand.incoming
  const amount = money.primary(entry.amountMsat, entry.fiat)
  const footer = [hint, !expired && entry.expiresAt !== null ? texts.notYet(money.time(entry.expiresAt * 1000)) : null].filter(Boolean).join(" ")

  const ask = (outcome: "done" | "not-done") => {
    setChoice(outcome)
    setAsking(true)
  }
  const note = async () => setBusy((await resolveByHand(entry.id, choice)) === "busy")

  return (
    <>
      <Group title={tx.byHand.title} footer={footer || undefined}>
        <ListRow title={texts.done} chevron={false} onClick={() => ask("done")} className="text-primary" />
        {expired && <ListRow title={texts.notDone} chevron={false} onClick={() => ask("not-done")} className="text-primary" />}
      </Group>
      {busy && <InlineStatus className="mt-3">{tx.pay.busy}</InlineStatus>}
      <Confirm
        open={asking}
        onOpenChange={setAsking}
        title={choice === "done" ? texts.doneTitle : texts.notDoneTitle}
        text={choice === "done" ? texts.doneText(amount, entry.counterpart.name) : texts.notDoneText}
        confirm={tx.byHand.confirm}
        destructive={choice === "not-done"}
        onConfirm={() => void note()}
      />
    </>
  )
}
