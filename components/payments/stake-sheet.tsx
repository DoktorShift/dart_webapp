"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { useAreaT, useT } from "@/components/i18n-provider"
import { AmountPicker } from "@/components/payments/amount-picker"
import { LearnMore } from "@/components/payments/learn-more"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { AMOUNT_PRESETS, type Stake } from "@/lib/payments/stake"

// Setting the stake of a game (./stake-setup.tsx): an amount, "Übernehmen", and "Kein Einsatz"
// to take one back. `onChange` gets the new stake, or null for none.
export default function StakeSheet({ open, onOpenChange, stake, onChange }: { open: boolean; onOpenChange: (open: boolean) => void; stake: Stake | null; onChange: (stake: Stake | null) => void }) {
  const t = useT()
  const s = useAreaT(PAYMENTS_TEXTS).stake
  const title = t.payments.stake.title
  const [amount, setAmount] = useState<number | null>(stake?.sats ?? null)
  // Each time it opens, it starts from the stake as it is (set before the picker shows).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setAmount(stake?.sats ?? null)
  }

  const finish = (next: Stake | null) => {
    onChange(next)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={s.sheetText}>
      <SheetBody>
        {open && <AmountPicker label={title} presets={AMOUNT_PRESETS} value={amount} onChange={setAmount} />}
        <div className="mt-4">
          <LearnMore inline />
        </div>
      </SheetBody>
      <div className="flex shrink-0 flex-col gap-2 pt-4">
        <Button onClick={() => amount !== null && finish({ sats: amount })} disabled={amount === null} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {s.apply}
        </Button>
        <Button variant="ghost" onClick={() => (stake ? finish(null) : onOpenChange(false))} className="h-12 w-full rounded-xl text-[1.0625rem]">
          {stake ? s.remove : t.common.cancel}
        </Button>
      </div>
    </Sheet>
  )
}
