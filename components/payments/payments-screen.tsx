"use client"

import { useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Settings } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { NavBarItems, NavIconButton } from "@/components/nav/nav-bar-items"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { EntryDetail } from "@/components/payments/entry-detail"
import { groupByDay, useEntryGames } from "@/components/payments/entry-game"
import { EntryRow, entryLabel, entryTitle } from "@/components/payments/entry-status"
import { LearnMore } from "@/components/payments/learn-more"
import { ReceiveFlow } from "@/components/payments/receive-flow"
import { PAYMENT_SCREENS } from "@/components/payments/screens"
import { SendFlow } from "@/components/payments/send-flow"
import { PaymentSignet } from "@/components/payments/signet"
import { WalletCard } from "@/components/payments/wallet-details"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useJournal, useWallet } from "@/lib/payments/hooks"
import { actions } from "@/lib/payments/journal"
import { capabilities } from "@/lib/payments/wallet"

// Profil › Zahlungen (docs/ux/zahlungen-vorschlag.html): the wallet with its balance, "Senden"
// and "Empfangen", and the payments made on this device, each with its game, by day. Settings
// (rights, currency, the connection) sit behind the gear. Without a wallet: what payments are
// for and "Wallet verbinden"; playing never needs one. One sheet at a time.

// How many payments the home shows; the rest under "Alle Zahlungen".
const RECENT = 8

type Open = { kind: "send" } | { kind: "receive"; action: string } | { kind: "entry"; id: string }

export default function PaymentsScreen() {
  const t = useT()
  const nav = useNav()
  const p = useAreaT(PAYMENTS_TEXTS)
  const wallet = useWallet()
  const journal = useJournal()
  const { game, day } = useEntryGames()
  const [open, setOpen] = useState<Open | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  if (wallet === undefined || journal === undefined) return null

  const can = wallet ? capabilities(wallet) : null
  const close = () => setOpen(null)
  const entry = open?.kind === "entry" ? journal.find((e) => e.id === open.id) : undefined
  const sheetTitle = open?.kind === "send" ? p.home.send : open?.kind === "receive" ? p.receive.title : entry ? entryTitle(p, entry) : t.payments.title
  const recent = groupByDay(journal.slice(0, RECENT), day)

  return (
    <>
      {wallet && (
        <NavBarItems>
          <NavIconButton icon={Settings} label={t.payments.settingsTitle} onClick={() => nav.push(PAYMENT_SCREENS.settings)} />
        </NavBarItems>
      )}
      {wallet && can ? (
        <>
          <WalletCard info={wallet} figures />
          {(can.pay || can.receive) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {can.pay && (
                <Button variant="secondary" onClick={() => setOpen({ kind: "send" })} className="h-12 gap-2 rounded-xl text-[1.0625rem] font-semibold text-primary">
                  <ArrowUpRight className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {p.home.send}
                </Button>
              )}
              {can.receive && (
                <Button variant="secondary" onClick={() => setOpen({ kind: "receive", action: actions.single() })} className="h-12 gap-2 rounded-xl text-[1.0625rem] font-semibold text-primary">
                  <ArrowDownLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {p.home.receive}
                </Button>
              )}
            </div>
          )}
          {!can.pay && <InlineStatus className="mt-3">{p.wallet.cantPay}</InlineStatus>}
          {!can.receive && <InlineStatus className="mt-3">{p.wallet.cantReceive}</InlineStatus>}
        </>
      ) : (
        <section className="mt-6 flex flex-col items-center rounded-2xl border border-border bg-card px-4 pb-3 pt-6 text-center">
          <PaymentSignet size="large" label={p.signet} />
          <h2 className="mt-4 text-xl font-semibold leading-tight">{p.intro.title}</h2>
          <p className="mt-2 max-w-sm text-[1.0625rem] leading-snug text-muted-foreground">{p.intro.text}</p>
          <Button onClick={() => nav.push(PAYMENT_SCREENS.connect)} className="mt-5 h-12 w-full max-w-xs rounded-xl text-[1.0625rem] font-semibold">
            {t.payments.connectTitle}
          </Button>
          <Button variant="ghost" onClick={() => setHelpOpen(true)} className="mt-1 h-11 w-full max-w-xs whitespace-normal rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
            {p.intro.noWallet}
          </Button>
        </section>
      )}

      {!wallet && (
        <div className="mt-2 px-4">
          <p className="text-[0.8125rem] leading-snug text-muted-foreground">{p.explain.screen}</p>
          <div className="-ml-3">
            <LearnMore />
          </div>
        </div>
      )}

      {journal.length > 0
        ? recent.map((group) => (
            <Group key={group.label} title={group.label}>
              {group.entries.map((item) => (
                <EntryRow key={item.id} entry={item} title={entryLabel(p, item, game(item).text)} onClick={() => setOpen({ kind: "entry", id: item.id })} />
              ))}
            </Group>
          ))
        : wallet && (
            <section className="mt-8 rounded-2xl border border-border bg-card px-4 py-5 text-center">
              <p className="text-[1.0625rem] font-semibold">{p.home.noneYet}</p>
              <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">{p.home.empty}</p>
            </section>
          )}
      {journal.length > RECENT && (
        <Group>
          <ListRow title={p.home.all} onClick={() => nav.push(PAYMENT_SCREENS.history)} />
        </Group>
      )}
      {wallet && (
        <div className="mt-3 px-4">
          <p className="text-[0.8125rem] leading-snug text-muted-foreground">{p.explain.screen}</p>
          <div className="-ml-3">
            <LearnMore />
          </div>
        </div>
      )}

      <Sheet open={open !== null} onOpenChange={(next) => !next && close()} title={sheetTitle}>
        <SheetBody>
          {open?.kind === "send" && <SendFlow onDone={close} />}
          {open?.kind === "receive" && <ReceiveFlow action={open.action} once={false} counterpart={{ name: "" }} amount={null} onDone={close} />}
          {entry && <EntryDetail entry={entry} onDone={close} />}
        </SheetBody>
      </Sheet>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen} title={p.help.title} description={p.help.text}>
        <PaymentSignet size="large" className="mx-auto my-3" />
        <Button onClick={() => setHelpOpen(false)} className="mt-2 h-12 w-full shrink-0 rounded-xl text-[1.0625rem] font-semibold">
          {p.help.ok}
        </Button>
      </Sheet>
    </>
  )
}
