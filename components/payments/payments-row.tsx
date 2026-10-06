"use client"

import { Bitcoin } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { StatusLabel } from "@/components/payments/entry-status"
import { PAYMENT_SCREENS } from "@/components/payments/screens"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useJournal, useWallet } from "@/lib/payments/hooks"

// "Zahlungen" in the Profile tab ("profile.rows"), signed in or as a guest. Shown only once
// payments are in use on this device (a wallet connected, or a payment made; ./gate.tsx): setting
// them up starts where a payment does (PLAN.md: "Zahlungen einrichten" erscheint erst bei Nutzung).
export default function PaymentsRow() {
  const t = useT()
  const row = useAreaT(PAYMENTS_TEXTS).row
  const nav = useNav()
  const wallet = useWallet()
  const journal = useJournal()
  if (wallet === undefined || journal === undefined) return null
  const unresolved = journal.some((entry) => entry.state === "unknown")
  return (
    <ListRow
      icon={Bitcoin}
      iconTone="orange"
      title={t.payments.title}
      subtitle={unresolved ? <StatusLabel tone="warning">{row.unresolved}</StatusLabel> : wallet ? row.connected : row.notConnected}
      onClick={() => nav.push(PAYMENT_SCREENS.home)}
    />
  )
}
