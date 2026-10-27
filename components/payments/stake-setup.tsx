"use client"

import { lazy, Suspense, useState } from "react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useT } from "@/components/i18n-provider"
import { useMoney } from "@/components/payments/use-money"
import { MSAT_PER_UNIT } from "@/lib/payments/money"
import { readStake } from "@/lib/payments/stake"
import type { SetupExtraProps } from "@/lib/shell/registry"

// "Einsatz" in game setup ("setup.extras"): one row, for two players only. The amount is noted
// with the game ("Verlierer zahlt"); nothing is paid here, and no wallet is needed to note it.
// Every two-player setup shows the row, so it carries only its own few texts and asks for no
// rate until a stake is set; the sheet that sets the amount loads when it is first opened.
const StakeSheet = lazy(() => import("@/components/payments/stake-sheet"))

export default function StakeSetup({ config, value, onChange }: SetupExtraProps) {
  const t = useT()
  const s = t.payments.stake
  const stake = readStake(value)
  const money = useMoney({ live: stake !== null })
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(false)

  // A stake is between a winner and a loser: with more players the row steps aside (the value
  // stays, and counts again if it goes back to two).
  if (config.players.length !== 2) return null

  return (
    <>
      <Group footer={s.hint}>
        <ListRow
          title={s.title}
          value={stake ? money.primary(stake.sats * MSAT_PER_UNIT, stake.fiat) : s.none}
          onClick={() => {
            setOpened(true)
            setOpen(true)
          }}
        />
      </Group>
      {opened && (
        <Suspense fallback={null}>
          <StakeSheet open={open} onOpenChange={setOpen} stake={stake} onChange={(next) => onChange(next ?? undefined)} />
        </Suspense>
      )}
    </>
  )
}
