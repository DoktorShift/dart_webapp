"use client"

import { Bitcoin } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { StatusLabel } from "@/components/payments/entry-status"
import { PAYMENT_SCREENS } from "@/components/payments/screens"
import { useMoney } from "@/components/payments/use-money"
import { useWalletFigures } from "@/components/payments/wallet-details"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useJournal, useWallet } from "@/lib/payments/hooks"

// "Zahlungen" in the Profile tab ("profile.rows"), signed in or as a guest: the way to the
// wallet and the payments made here. Its second line says how things stand: a payment not
// confirmed yet, else the balance as the wallet last reported it (unless switched off in
// Einstellungen), else whether a wallet is connected.
export default function PaymentsRow() {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const nav = useNav()
  const wallet = useWallet()
  const journal = useJournal()
  const money = useMoney({ live: false })
  const { figures } = useWalletFigures(wallet ?? null, false)
  if (wallet === undefined || journal === undefined) return null
  const unresolved = journal.some((entry) => entry.state === "unknown")
  const balance = wallet && money.settings.balanceInProfile && figures?.balanceMsat != null ? tx.row.balance(money.primary(figures.balanceMsat), wallet.alias ?? tx.yourWallet) : null
  return (
    <ListRow
      icon={Bitcoin}
      iconTone="orange"
      title={t.payments.title}
      subtitle={unresolved ? <StatusLabel tone="warning">{tx.row.unresolved}</StatusLabel> : wallet ? (balance ?? tx.row.connected) : tx.row.notConnected}
      onClick={() => nav.push(PAYMENT_SCREENS.home)}
    />
  )
}
