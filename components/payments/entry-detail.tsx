"use client"

import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { EntryOutcome } from "@/components/payments/entry-outcome"
import { useEntryGames } from "@/components/payments/entry-game"
import { useMoney } from "@/components/payments/use-money"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { describeAction } from "@/lib/payments/actions"
import { useWallet } from "@/lib/payments/hooks"
import type { PaymentEntry } from "@/lib/payments/journal"

// One payment from the list: its outcome with what can be done about it (./entry-outcome.tsx),
// and the few rows that place it: the game it belongs to (a tap opens the game), why, to whom or
// from whom, which wallet, the fees, the time.
export function EntryDetail({ entry, onDone }: { entry: PaymentEntry; onDone: () => void }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const d = tx.detail
  const nav = useNav()
  const money = useMoney({ live: false })
  const wallet = useWallet()
  const { game } = useEntryGames()
  const { kind } = describeAction(entry.action)
  const { matchId, match, text } = game(entry)
  const ownWallet = wallet && entry.connection === wallet.connection ? (wallet.alias ?? tx.yourWallet) : null
  const openGame = () => {
    onDone()
    nav.push(PROFILE_SCREENS.match, { id: matchId! })
  }
  return (
    <EntryOutcome entry={entry} onDone={onDone}>
      <Group>
        {matchId && (match ? <ListRow title={d.game} value={text} onClick={openGame} /> : <ListRow title={d.game} value={d.gameGone} />)}
        <ListRow title={d.reason} value={d.reasons[kind]} />
        {(entry.counterpart.name || entry.address) && <ListRow title={entry.direction === "out" ? d.to : d.from} value={entry.counterpart.name || entry.address} subtitle={entry.counterpart.name && entry.address ? entry.address : undefined} />}
        {ownWallet && <ListRow title={d.wallet} value={ownWallet} />}
        {typeof entry.feesMsat === "number" && <ListRow title={d.fees} value={money.primary(entry.feesMsat)} />}
        <ListRow title={d.time} value={money.time(entry.createdAt)} />
      </Group>
    </EntryOutcome>
  )
}
