"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { EntryOutcome } from "@/components/payments/entry-outcome"
import { EntryRow, entryTitle } from "@/components/payments/entry-status"
import { PayFlow } from "@/components/payments/pay-flow"
import { ReceiveFlow } from "@/components/payments/receive-flow"
import { PAYMENT_SCREENS } from "@/components/payments/screens"
import { LearnMore } from "@/components/payments/learn-more"
import { PaymentSignet } from "@/components/payments/signet"
import { WalletCard, WalletRights } from "@/components/payments/wallet-details"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useJournal, useWallet } from "@/lib/payments/hooks"
import { actions } from "@/lib/payments/journal"
import { capabilities, removeWallet } from "@/lib/payments/wallet"

// Profil › Zahlungen: the connected wallet (what it allows, its balance and limit as far as it
// reports them), receiving and paying an invoice, the payments made on this device, the technical
// details under "Erweitert", and "Verbindung entfernen". Without a wallet: what payments are for
// and "Wallet verbinden"; playing never needs one.

// How many payments the list shows; older ones stay in the journal.
const HISTORY = 20

type Open = { kind: "receive"; action: string } | { kind: "pay"; action: string } | { kind: "entry"; id: string }

export default function PaymentsScreen() {
  const t = useT()
  const nav = useNav()
  const p = useAreaT(PAYMENTS_TEXTS)
  const w = p.wallet
  const wallet = useWallet()
  const journal = useJournal()
  const [open, setOpen] = useState<Open | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (wallet === undefined || journal === undefined) return null

  const can = wallet ? capabilities(wallet) : null
  const close = () => setOpen(null)
  const entry = open?.kind === "entry" ? journal.find((e) => e.id === open.id) : undefined
  const sheetTitle = open?.kind === "receive" ? p.receive.title : open?.kind === "pay" ? w.payInvoice : entry ? entryTitle(p, entry) : t.payments.title

  return (
    <>
      {wallet ? (
        <>
          <WalletCard info={wallet} />
          <WalletRights info={wallet} figures />
          {(can?.receive || can?.pay) && (
            <Group>
              {can.receive && <ListRow title={w.receiveMoney} onClick={() => setOpen({ kind: "receive", action: actions.single() })} />}
              {can.pay && <ListRow title={w.payInvoice} onClick={() => setOpen({ kind: "pay", action: actions.single() })} />}
            </Group>
          )}
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

      <div className="mt-2 px-4">
        <p className="text-[0.8125rem] leading-snug text-muted-foreground">{p.explain.screen}</p>
        <div className="-ml-3">
          <LearnMore />
        </div>
      </div>

      {journal.length > 0 && (
        <Group title={w.history}>
          {journal.slice(0, HISTORY).map((item) => (
            <EntryRow key={item.id} entry={item} onClick={() => setOpen({ kind: "entry", id: item.id })} />
          ))}
        </Group>
      )}

      {wallet && (
        <>
          <Group>
            <ListRow title={t.payments.advancedTitle} onClick={() => nav.push(PAYMENT_SCREENS.advanced)} />
          </Group>
          <Group footer={w.privacy}>
            <ListRow title={w.remove} destructive onClick={() => setConfirmRemove(true)} />
          </Group>
        </>
      )}

      <Sheet open={open !== null} onOpenChange={(next) => !next && close()} title={sheetTitle}>
        <SheetBody>
          {open?.kind === "receive" && <ReceiveFlow action={open.action} once={false} counterpart={{ name: "" }} amountSats={null} onDone={close} />}
          {open?.kind === "pay" && <PayFlow action={open.action} once counterpart={{ name: "" }} amountSats={null} route={{ kind: "scan" }} onDone={close} />}
          {entry && <EntryOutcome entry={entry} onDone={close} />}
        </SheetBody>
      </Sheet>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen} title={p.help.title} description={p.help.text}>
        <PaymentSignet size="large" className="mx-auto my-3" />
        <Button onClick={() => setHelpOpen(false)} className="mt-2 h-12 w-full shrink-0 rounded-xl text-[1.0625rem] font-semibold">
          {p.help.ok}
        </Button>
      </Sheet>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{w.removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{w.removeText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeWallet()} className="h-11 bg-danger text-white hover:bg-danger/90">
              {w.removeConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
