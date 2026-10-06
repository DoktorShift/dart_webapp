"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet } from "@/components/ui/sheet"
import { useT } from "@/components/i18n-provider"
import { AmountPicker } from "@/components/payments/amount-picker"
import { formatSats } from "@/components/payments/format"
import { LearnMore } from "@/components/payments/learn-more"
import { readStake, AMOUNT_PRESETS } from "@/lib/payments/stake"
import type { SetupExtraProps } from "@/lib/shell/registry"

// "Einsatz" in game setup ("setup.extras"): one row, for two players only. The amount is noted
// with the game ("Verlierer zahlt"); nothing is paid here, and no wallet is needed to note it.
export default function StakeSetup({ config, value, onChange }: SetupExtraProps) {
  const t = useT()
  const s = t.payments.stake
  const stake = readStake(value)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState<number | null>(null)

  // A stake is between a winner and a loser: with more players the row steps aside (the value
  // stays, and counts again if it goes back to two).
  if (config.players.length !== 2) return null

  const close = (next: number | null | undefined) => {
    if (next !== undefined) onChange(next === null ? undefined : { sats: next })
    setOpen(false)
  }

  return (
    <>
      <Group footer={s.hint}>
        <ListRow
          title={s.title}
          value={stake ? formatSats(t, stake.sats) : s.none}
          onClick={() => {
            setAmount(stake?.sats ?? null)
            setOpen(true)
          }}
        />
      </Group>
      <Sheet open={open} onOpenChange={setOpen} title={s.title} description={s.sheetText}>
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
          {open && <AmountPicker label={s.title} presets={AMOUNT_PRESETS} value={amount} onChange={setAmount} />}
          <div className="mt-4">
            <LearnMore inline />
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 pt-4">
          <Button onClick={() => close(amount)} disabled={amount === null} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {s.apply}
          </Button>
          <Button variant="ghost" onClick={() => close(stake ? null : undefined)} className="h-12 w-full rounded-xl text-[1.0625rem]">
            {stake ? s.remove : t.common.cancel}
          </Button>
        </div>
      </Sheet>
    </>
  )
}
