"use client"

import { useState } from "react"
import { Confirm } from "@/components/ui/confirm"
import { ChoiceRow, Group, SwitchRow } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PAYMENT_SCREENS } from "@/components/payments/screens"
import { useMoney } from "@/components/payments/use-money"
import { WalletCard, WalletRights } from "@/components/payments/wallet-details"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useWallet } from "@/lib/payments/hooks"
import { CURRENCIES } from "@/lib/payments/money"
import { saveMoneySettings } from "@/lib/payments/settings"
import { removeWallet } from "@/lib/payments/wallet"

// Zahlungen › Einstellungen: what the wallet allows, with its balance and limit; how money is
// shown on this device (the currency, which side first, the balance in the profile's row); the
// technical details under "Erweitert"; and "Verbindung entfernen".
export default function SettingsScreen() {
  const t = useT()
  const nav = useNav()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const s = tx.settings
  const w = tx.wallet
  const wallet = useWallet()
  const money = useMoney()
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (wallet === undefined) return null
  if (wallet === null) return null

  const { settings } = money
  return (
    <>
      <WalletCard info={wallet} />
      <WalletRights info={wallet} figures />
      <Group footer={s.rateNote}>
        <ChoiceRow title={s.currency} hint={s.currencies[settings.currency]} options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))} value={settings.currency} onChange={(currency) => void saveMoneySettings({ currency })} />
        <ChoiceRow
          title={s.order}
          options={[
            { value: "fiat", label: s.currencyFirst(money.symbol) },
            { value: "bitcoin", label: s.bitcoinFirst },
          ]}
          value={settings.order}
          onChange={(order) => void saveMoneySettings({ order })}
        />
        <SwitchRow title={s.balanceInProfile} checked={settings.balanceInProfile} onCheckedChange={(balanceInProfile) => void saveMoneySettings({ balanceInProfile })} />
      </Group>
      <Group>
        <ListRow title={t.payments.advancedTitle} onClick={() => nav.push(PAYMENT_SCREENS.advanced)} />
      </Group>
      <Group footer={w.privacy}>
        <ListRow title={w.remove} destructive onClick={() => setConfirmRemove(true)} />
      </Group>
      <Confirm
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={w.removeTitle}
        text={w.removeText}
        confirm={w.removeConfirm}
        destructive
        onConfirm={() => {
          void removeWallet()
          nav.pop()
        }}
      />
    </>
  )
}
