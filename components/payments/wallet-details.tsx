"use client"

import { useEffect, useState } from "react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT } from "@/components/i18n-provider"
import { AmountBlock } from "@/components/payments/amount-block"
import { PaymentSignet } from "@/components/payments/signet"
import { useMoney } from "@/components/payments/use-money"
import { PAYMENTS_TEXTS, type PaymentTexts } from "@/lib/i18n/features/payments.screens"
import { useJournal } from "@/lib/payments/hooks"
import { fetchWalletFigures, loadWalletFigures } from "@/lib/payments/settings"
import { capabilities, type WalletInfo } from "@/lib/payments/wallet"
import { useStored } from "@/lib/storage/hooks"

// The connected wallet as the person sees it: its name and balance (HIG Wallet: the balance in
// the header, the rest uncluttered), and under "Rechte" what it allows. Balance and limit only
// when the wallet reports them (get_balance, get_budget): no made-up balance, and no limit of
// BlueLine's own passed off as the wallet's (PLAN.md "Wallet-seitige Limits").

export function capabilityText(tx: PaymentTexts, info: WalletInfo) {
  const { pay, receive } = capabilities(info)
  const c = tx.capability
  return pay && receive ? c.both : pay ? c.pay : receive ? c.receive : c.none
}

const readFigures = () => loadWalletFigures().catch(() => null)

// What the wallet last reported for this connection (kept on the device, so it shows at once),
// asked again while `ask` and when `asOf` changes (a payment went out or came in).
export function useWalletFigures(info: WalletInfo | null, ask: boolean, asOf = 0) {
  const saved = useStored("kv", readFigures)[0]
  const [state, setState] = useState<"idle" | "loading" | "unavailable">("idle")
  const can = info ? capabilities(info) : null
  const reports = !!can && (can.balance || can.budget)
  useEffect(() => {
    if (!info || !ask || !reports) return
    let alive = true
    setState("loading")
    fetchWalletFigures(info).then(
      () => alive && setState("idle"),
      () => alive && setState("unavailable"),
    )
    return () => {
      alive = false
    }
    // Asked again for another connection or after a payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.connectedAt, ask, asOf, reports])
  const figures = saved && info && saved.connection === info.connection ? saved : null
  return { figures, reports, loading: state === "loading" && !figures, unavailable: state === "unavailable" }
}

// The wallet by its name; with `figures`, its balance as the wallet last reported it.
export function WalletCard({ info, figures: wanted = false }: { info: WalletInfo; figures?: boolean }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const money = useMoney({ live: wanted })
  const journal = useJournal()
  const asOf = journal?.reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0) ?? 0
  const { figures, reports, loading, unavailable } = useWalletFigures(info, wanted, asOf)
  const can = capabilities(info)
  const balance = figures?.balanceMsat ?? null
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card px-4 py-4">
      <div className="flex items-center gap-4">
        <PaymentSignet size="large" />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{info.alias ?? tx.yourWallet}</h2>
          {!wanted && <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{capabilityText(tx, info)}</p>}
        </div>
      </div>
      {wanted && can.balance && balance !== null && (
        <div className="mt-4">
          <AmountBlock msat={balance} align="start" />
          {unavailable && figures && <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{tx.home.asOf(money.time(figures.at))}</p>}
        </div>
      )}
      {wanted && (!reports || !can.balance) && <p className="mt-3 text-[0.9375rem] text-muted-foreground">{tx.home.balanceByWallet}</p>}
      {wanted && can.balance && balance === null && <p className="mt-3 text-[0.9375rem] text-muted-foreground">{loading ? tx.wallet.loading : tx.wallet.unavailable}</p>}
    </section>
  )
}

// The wallet's rights, and with `figures` its balance and limit, in one inset group.
export function WalletRights({ info, figures: wanted = false }: { info: WalletInfo; figures?: boolean }) {
  const journal = useJournal()
  const asOf = journal?.reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0) ?? 0
  const tx = useAreaT(PAYMENTS_TEXTS)
  const money = useMoney({ live: wanted })
  const w = tx.wallet
  const can = capabilities(info)
  const { figures, loading, unavailable } = useWalletFigures(info, wanted, asOf)
  // A figure as shown: while it loads, when the wallet couldn't say, or its value.
  const pending = loading ? w.loading : unavailable && !figures ? w.unavailable : null
  const balanceText = wanted && can.balance ? (figures?.balanceMsat != null ? money.primary(figures.balanceMsat) : pending) : null
  const limit = figures?.budget ?? null
  const limitText = wanted && can.budget ? (limit ? w.limitOf(money.primary(Math.max(0, limit.totalMsat - limit.usedMsat)), money.primary(limit.totalMsat)) : figures ? null : pending) : null
  const enforced = limit !== null
  const hints = [!can.pay && w.cantPay, !can.receive && w.cantReceive, wanted && (enforced ? w.limitFooter : w.noLimitFooter)].filter(Boolean).join(" ")

  return (
    <Group footer={hints || undefined}>
      <ListRow title={w.pay} value={can.pay ? w.allowed : w.notAllowed} />
      <ListRow title={w.receive} value={can.receive ? w.allowed : w.notAllowed} />
      {balanceText && <ListRow title={w.balance} value={balanceText} />}
      {limitText && <ListRow title={w.limitLeft} value={limitText} />}
    </Group>
  )
}
