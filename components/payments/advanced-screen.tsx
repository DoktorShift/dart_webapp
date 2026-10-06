"use client"

import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useWallet } from "@/lib/payments/hooks"

// Zahlungen › Erweitert: how the wallet connection works, for those who want to know. The only
// place in the payments area that names the protocol. The connection's secret is never shown.
export default function PaymentsAdvancedScreen() {
  const t = useT()
  const a = useAreaT(PAYMENTS_TEXTS).advanced
  const wallet = useWallet()
  if (!wallet) return null
  const list = (values: string[]) => (values.length > 0 ? values.join(", ") : a.none)

  return (
    <Group footer={a.footer}>
      <ListRow title={a.protocol} value={a.protocolValue} />
      <ListRow title={a.encryption} value={wallet.encryption === "nip44" ? "NIP‑44" : "NIP‑04"} />
      <ListRow title={a.relays} subtitle={<span className="select-text font-mono">{list(wallet.relays)}</span>} />
      <ListRow title={a.methods} subtitle={<span className="select-text font-mono">{list(wallet.methods)}</span>} />
      <ListRow title={a.notifications} subtitle={<span className="select-text font-mono">{list(wallet.notifications)}</span>} />
      {wallet.lightningAddress && <ListRow title={a.lightningAddress} subtitle={<span className="select-text">{wallet.lightningAddress}</span>} />}
      <ListRow title={a.connectedAt} value={new Date(wallet.connectedAt).toLocaleString(t.intl, { dateStyle: "medium", timeStyle: "short" })} />
    </Group>
  )
}
