"use client"

import { useEffect, useState } from "react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT } from "@/components/i18n-provider"
import { useFormat } from "@/components/payments/format"
import { PaymentSignet } from "@/components/payments/signet"
import { PAYMENTS_TEXTS, type PaymentTexts } from "@/lib/i18n/features/payments.screens"
import type { Budget } from "@/lib/nostr/wallet"
import { useJournal } from "@/lib/payments/hooks"
import { capabilities, withWallet, type WalletInfo } from "@/lib/payments/wallet"

// What the connected wallet allows, as the person checks it after connecting and in Zahlungen.
// Balance and limit only when the wallet reports them (get_balance, get_budget): no made-up
// balance, and no limit of BlueLine's own passed off as the wallet's (PLAN.md "Wallet-seitige
// Limits").

export function capabilityText(tx: PaymentTexts, info: WalletInfo) {
  const { pay, receive } = capabilities(info)
  const c = tx.capability
  return pay && receive ? c.both : pay ? c.pay : receive ? c.receive : c.none
}

// The wallet by its name, with what it allows.
export function WalletCard({ info }: { info: WalletInfo }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  return (
    <section className="mt-6 flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4">
      <PaymentSignet size="large" />
      <div className="min-w-0">
        <h2 className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{info.alias ?? tx.yourWallet}</h2>
        <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{capabilityText(tx, info)}</p>
      </div>
    </section>
  )
}

type Live<T> = { state: "loading" } | { state: "known"; value: T } | { state: "unavailable" }

// Balance and limit, asked from the wallet while shown, and again when `asOf` changes (a payment
// went out or came in). Undefined for what the wallet can't report.
function useWalletFigures(info: WalletInfo, ask: boolean, asOf: number) {
  const can = capabilities(info)
  const [balance, setBalance] = useState<Live<number> | undefined>(can.balance && ask ? { state: "loading" } : undefined)
  const [budget, setBudget] = useState<Live<Budget | null> | undefined>(can.budget && ask ? { state: "loading" } : undefined)
  useEffect(() => {
    if (!ask || (!can.balance && !can.budget)) return
    let alive = true
    void withWallet(async (wallet) => {
      const [b, l] = await Promise.allSettled([can.balance ? wallet.getBalance() : null, can.budget ? wallet.getBudget() : null])
      if (!alive) return
      if (can.balance) setBalance(b.status === "fulfilled" && b.value !== null ? { state: "known", value: b.value } : { state: "unavailable" })
      if (can.budget) setBudget(l.status === "fulfilled" ? { state: "known", value: l.value } : { state: "unavailable" })
    }).catch(() => {
      if (!alive) return
      if (can.balance) setBalance({ state: "unavailable" })
      if (can.budget) setBudget({ state: "unavailable" })
    })
    return () => {
      alive = false
    }
    // Asked again for another connection or after a payment; the rest follows from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.connectedAt, ask, asOf])
  return { balance, budget }
}

// The wallet's rights, and with `figures` its balance and limit, in one inset group.
export function WalletRights({ info, figures = false }: { info: WalletInfo; figures?: boolean }) {
  const journal = useJournal()
  const asOf = journal?.reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0) ?? 0
  const tx = useAreaT(PAYMENTS_TEXTS)
  const format = useFormat()
  const w = tx.wallet
  const can = capabilities(info)
  const { balance, budget } = useWalletFigures(info, figures, asOf)
  // A figure as shown: while it loads, when the wallet couldn't say, or its value (null: none).
  const figure = <T,>(live: Live<T>, show: (value: T) => string | null) => (live.state === "loading" ? w.loading : live.state === "unavailable" ? w.unavailable : show(live.value))
  const balanceText = balance && figure(balance, (msat) => format.msat(msat))
  const limitText = budget && figure(budget, (limit) => limit && w.limitOf(format.number(Math.max(0, limit.totalMsat - limit.usedMsat) / 1000), format.msat(limit.totalMsat)))
  const enforced = budget?.state === "known" && budget.value !== null
  const hints = [!can.pay && w.cantPay, !can.receive && w.cantReceive, enforced ? w.limitFooter : w.noLimitFooter].filter(Boolean).join(" ")

  return (
    <Group footer={hints}>
      <ListRow title={w.pay} value={can.pay ? w.allowed : w.notAllowed} />
      <ListRow title={w.receive} value={can.receive ? w.allowed : w.notAllowed} />
      {balanceText && <ListRow title={w.balance} value={balanceText} />}
      {limitText && <ListRow title={w.limitLeft} value={limitText} />}
    </Group>
  )
}
