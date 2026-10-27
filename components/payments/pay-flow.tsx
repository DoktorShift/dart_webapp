"use client"

import { useEffect, useRef, useState } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT, useT } from "@/components/i18n-provider"
import { AmountBlock } from "@/components/payments/amount-block"
import { ConnectPanel } from "@/components/payments/connect"
import { EntryOutcome } from "@/components/payments/entry-outcome"
import { OutcomeHeader } from "@/components/payments/entry-status"
import { LearnMore } from "@/components/payments/learn-more"
import { problemText } from "@/components/payments/problem"
import { SheetActions } from "@/components/payments/sheet-actions"
import { useMoney } from "@/components/payments/use-money"
import { useWalletFigures } from "@/components/payments/wallet-details"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import type { PayEndpoint } from "@/lib/nostr/ext/lnurl"
import { getSigner } from "@/lib/profile/session"
import { useJournal, useWallet } from "@/lib/payments/hooks"
import { addressInvoice, InvoiceError, scanKind, scannedInvoice } from "@/lib/payments/invoices"
import { blockingEntry, isDone, pay, type Counterpart, type InvoiceSource } from "@/lib/payments/journal"
import { MSAT_PER_UNIT, type Amount, type FiatAmount } from "@/lib/payments/money"
import { lookupRecipient } from "@/lib/payments/recipient"
import { capabilities, withWallet } from "@/lib/payments/wallet"
import { zapInvoice } from "@/lib/payments/zap"

// Paying someone (PLAN.md "Bezahlen und Empfangen im Spiel"): who and how much, from which wallet
// and at what fees, are on screen before the one button that pays ("Bestätigung erforderlich").
// The invoice comes from the person's Lightning address, or is scanned from their device
// ("Geld empfangen"); it is checked before anything is paid, and the journal
// (lib/payments/journal.ts) makes sure an action is never paid twice. "Zahlung läuft" shows only
// once the wallet has the payment; until then it can be cancelled and nothing is paid. Before
// the review, the wallet's balance and limit are asked once, so a payment the wallet would refuse
// is said in words instead of failing. Paid, the sheet says so and closes by itself.

export type PayRoute =
  // The other player shows an invoice; this device scans it.
  | { kind: "scan" }
  | { kind: "address"; address: string; endpoint: PayEndpoint }
  // A public congratulation (NIP-57), signed by the profile.
  | { kind: "zap"; address: string; endpoint: PayEndpoint; comment: string }

type Step =
  | { kind: "route" }
  | { kind: "scan"; problem?: string }
  // `fiat`: the agreed currency amount, when there is one.
  | { kind: "review"; scanned?: string; amountMsat: number; fiat?: FiatAmount; problem?: string }
  // Confirmed at `since` (ms): the invoice is asked for (`fetching`) and the wallet opened, then
  // the wallet pays.
  | { kind: "paying"; since: number; fetching: boolean }
  // `fresh`: just paid here, not an outcome found in the journal.
  | { kind: "outcome"; id: string; fresh: boolean }
  | { kind: "busy" }

// Where the invoice comes from when the caller doesn't say: the Lightning address in the person's
// profile, else scanning. `note` says why it is scanning.
function useRoute(counterpart: Counterpart, given: PayRoute | undefined) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const [found, setFound] = useState<{ route: PayRoute; note: string | null } | null>(() =>
    given ? { route: given, note: null } : counterpart.pubkey ? null : { route: { kind: "scan" }, note: null },
  )
  useEffect(() => {
    if (found || !counterpart.pubkey) return
    let alive = true
    void lookupRecipient(counterpart.pubkey).then(({ address, status }) => {
      if (!alive) return
      if (address?.endpoint) setFound({ route: { kind: "address", address: address.address, endpoint: address.endpoint }, note: null })
      else if (address) setFound({ route: { kind: "scan" }, note: tx.invoice.addressUnreachable(address.address) })
      else setFound({ route: { kind: "scan" }, note: status === "complete" ? tx.pay.noAddress(counterpart.name) : tx.pay.profilePartial(counterpart.name) })
    })
    return () => {
      alive = false
    }
  }, [found, counterpart.pubkey, counterpart.name, tx])
  return found
}

export function PayFlow({
  action,
  once,
  counterpart,
  amount,
  route: givenRoute,
  onDone,
}: {
  action: string
  once: boolean
  counterpart: Counterpart
  // The agreed amount; null pays what a scanned invoice asks, after showing it.
  amount: Amount | null
  route?: PayRoute
  onDone: () => void
}) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const p = tx.pay
  const money = useMoney()
  const wallet = useWallet()
  const journal = useJournal()
  const found = useRoute(counterpart, givenRoute)
  const [route, setRoute] = useState<PayRoute | null>(null)
  const [step, setStep] = useState<Step>({ kind: "route" })
  const [reconnect, setReconnect] = useState(false)
  const amountMsat = amount === null ? null : amount.sats * MSAT_PER_UNIT
  const active = route ?? found?.route ?? null
  // What the wallet holds and allows, asked once for the review: a payment it would refuse is
  // said here in words, before anything is tried.
  const { figures } = useWalletFigures(wallet ?? null, step.kind === "review")

  const reviewTop = useRef<HTMLDivElement>(null)
  // Cancels a confirmed payment until the wallet has it, also when the sheet is closed.
  const cancelling = useRef<AbortController | null>(null)
  useEffect(() => () => cancelling.current?.abort(), [])
  // The payments for this action done when the flow opened. One done since was made in another
  // window: it is shown before this one pays again (for payments that may be repeated).
  const doneBefore = useRef<Set<string> | null>(null)
  if (journal && doneBefore.current === null) doneBefore.current = new Set(journal.filter((entry) => entry.action === action && isDone(entry)).map((entry) => entry.id))

  // Once the route is known: review straight away, or scan first.
  useEffect(() => {
    if (step.kind !== "route" || !active) return
    setStep(active.kind === "scan" || amountMsat === null ? { kind: "scan" } : { kind: "review", amountMsat, fiat: amount?.fiat })
  }, [step.kind, active, amountMsat, amount?.fiat])

  // The review starts at its top (who, how much), wherever the sheet was scrolled to while scanning.
  useEffect(() => {
    if (step.kind === "review") reviewTop.current?.scrollIntoView({ block: "start" })
  }, [step.kind])

  if (wallet === undefined || journal === undefined) return null
  if (!wallet || reconnect) return <ConnectPanel titled onConnected={() => setReconnect(false)} onCancel={onDone} />

  const cancel = () => {
    cancelling.current?.abort()
    onDone()
  }
  const cancelButton = (
    <Button variant="ghost" onClick={cancel} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem]">
      {t.common.cancel}
    </Button>
  )

  if (step.kind === "paying") {
    // The journal entry is written right before the wallet is asked: from then on it pays.
    const handedOver = journal.some((entry) => entry.action === action && entry.updatedAt >= step.since)
    if (handedOver) return <OutcomeHeader tone="progress" working title={p.sending} text={p.sendingText} />
    return (
      <>
        <OutcomeHeader tone="progress" working title={step.fetching ? p.requesting : p.preparing} text={p.nothingYet} />
        {cancelButton}
      </>
    )
  }
  if (step.kind === "outcome") {
    const entry = journal.find((item) => item.id === step.id)
    // The entry is on its way into the journal.
    if (!entry) return <OutcomeHeader tone="progress" working title={p.sending} />
    return <EntryOutcome entry={entry} autoClose={step.fresh} onRetry={() => setStep({ kind: "route" })} onDone={onDone} />
  }

  // An earlier payment for this action that is open or done is shown instead of paying again.
  const earlier = blockingEntry(journal, action)
  if (earlier) return <EntryOutcome entry={earlier} onDone={onDone} />
  const paidElsewhere = journal.find((entry) => entry.action === action && isDone(entry) && !doneBefore.current?.has(entry.id))
  if (paidElsewhere) {
    const payAgain = () => {
      doneBefore.current?.add(paidElsewhere.id)
      setStep({ kind: "route" })
    }
    return <EntryOutcome entry={paidElsewhere} reason={p.paidMeanwhile} onPayAgain={payAgain} onDone={onDone} />
  }

  if (!capabilities(wallet).pay) {
    return (
      <>
        <InlineStatus>{tx.wallet.cantPay}</InlineStatus>
        <Button variant="secondary" onClick={() => setReconnect(true)} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold text-primary">
          {tx.wallet.reconnect}
        </Button>
      </>
    )
  }

  const context = { amount: amountMsat === null ? undefined : money.primary(amountMsat, amount?.fiat), address: active && active.kind !== "scan" ? active.address : undefined }

  const source = async (review: Extract<Step, { kind: "review" }>): Promise<InvoiceSource> => {
    if (review.scanned) return scannedInvoice(review.scanned, review.amountMsat)
    if (active?.kind === "address") return addressInvoice(active.address, active.endpoint, review.amountMsat)
    if (active?.kind === "zap" && counterpart.pubkey) {
      return zapInvoice({ recipient: counterpart.pubkey, address: active.address, endpoint: active.endpoint, amountMsat: review.amountMsat, comment: active.comment, signer: await getSigner() })
    }
    throw new InvoiceError("invalid")
  }

  const confirm = async (review: Extract<Step, { kind: "review" }>) => {
    const controller = new AbortController()
    cancelling.current = controller
    setStep({ kind: "paying", since: Date.now(), fetching: !review.scanned })
    try {
      // The currency amount as it stood on the review goes into the journal with the payment.
      const fiat = review.fiat ?? money.noted(review.amountMsat)
      const result = await withWallet((client) => pay({ action, once, counterpart, fiat, invoice: () => source(review), signal: controller.signal }, client))
      setStep(result === "busy" ? { kind: "busy" } : { kind: "outcome", id: result.id, fresh: true })
    } catch (error) {
      if (controller.signal.aborted) return
      // Nothing was paid: an expired scanned invoice means scanning a new one.
      if (review.scanned && error instanceof InvoiceError) setStep({ kind: "scan", problem: problemText(tx, error, context) })
      else setStep({ ...review, problem: problemText(tx, error, context) })
    }
  }

  const onScan = async (text: string): Promise<ScanVerdict> => {
    const kind = scanKind(text)
    if (kind === "wallet") return tx.invoice.isWallet
    if (kind !== "invoice") return tx.invoice.invalid
    try {
      const { checked } = await scannedInvoice(text, amountMsat ?? undefined)
      setStep({ kind: "review", scanned: text, amountMsat: checked.amountMsat, fiat: amount?.fiat })
    } catch (error) {
      return problemText(tx, error, context)
    }
  }

  switch (step.kind) {
    case "route":
      return (
        <>
          <OutcomeHeader tone="progress" working title={p.findRecipient} />
          {cancelButton}
        </>
      )
    case "busy":
      return (
        <>
          <OutcomeHeader tone="progress" title={p.sending} text={p.busy} />
          <Button variant="ghost" onClick={onDone} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem]">
            {t.common.done}
          </Button>
        </>
      )
    case "scan":
      return (
        <>
          {(step.problem || found?.note) && (
            <InlineStatus tone={step.problem ? "error" : "info"} className="mb-4">
              {step.problem ?? found?.note}
            </InlineStatus>
          )}
          <p className="text-[1.0625rem] leading-snug text-muted-foreground">{p.scanIntro(counterpart.name)}</p>
          <QRScanner className="mt-5" onResult={onScan} manualLabel={p.scanManual} manualPlaceholder={p.scanPlaceholder} inputMode="text" />
          {cancelButton}
        </>
      )
    case "review": {
      const zap = active?.kind === "zap"
      // Said from what the wallet last reported; the wallet still has the last word.
      const balance = figures?.balanceMsat ?? null
      const left = figures?.budget ? Math.max(0, figures.budget.totalMsat - figures.budget.usedMsat) : null
      const shortfall = balance !== null && step.amountMsat > balance ? p.notEnough(money.primary(balance)) : left !== null && step.amountMsat > left ? p.overLimit(money.primary(left)) : null
      return (
        <>
          {/* Who (when known) and how much; on a phone in landscape next to the wallet and fees. */}
          <div ref={reviewTop} className="xshort:grid xshort:grid-cols-2 xshort:items-center xshort:gap-3">
            <div className="flex flex-col items-center text-center">
              {counterpart.name && (
                <>
                  <Avatar seed={counterpart.pubkey ?? counterpart.name} name={counterpart.name} size={56} className="xshort:hidden" />
                  <p className="mt-2 text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere] xshort:mt-0">{counterpart.name}</p>
                </>
              )}
              {active && active.kind !== "scan" && !step.scanned && <p className="text-[0.8125rem] text-muted-foreground [overflow-wrap:anywhere]">{p.toAddress(active.address)}</p>}
              <AmountBlock msat={step.amountMsat} fiat={step.fiat} className="mt-3 xshort:mt-1" />
            </div>
            <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card xshort:mt-0">
              <ListRow title={p.fromWallet} value={balance === null ? (wallet.alias ?? tx.yourWallet) : `${wallet.alias ?? tx.yourWallet} · ${money.primary(balance)}`} />
              <ListRow title={p.fees} value={p.feesUnknown} />
            </div>
          </div>
          {shortfall && (
            <InlineStatus tone="error" className="mt-3">
              {shortfall}
            </InlineStatus>
          )}
          {zap ? (
            <InlineStatus className="mt-3">{tx.congratulate.publicHint(counterpart.name)}</InlineStatus>
          ) : (
            <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{tx.explain.pay(counterpart.name)}</p>
          )}
          <div className="mt-3">
            <LearnMore inline />
          </div>
          <SheetActions note={step.problem && <InlineStatus tone="error">{step.problem}</InlineStatus>}>
            <Button onClick={() => void confirm(step)} className="h-auto min-h-12 w-full whitespace-normal rounded-xl py-2 text-[1.0625rem] font-semibold">
              {zap ? tx.congratulate.send(counterpart.name) : p.confirm(counterpart.name)}
            </Button>
            {active?.kind === "address" && !step.scanned && (
              <Button
                variant="ghost"
                onClick={() => {
                  setRoute({ kind: "scan" })
                  setStep({ kind: "scan" })
                }}
                className="h-11 w-full whitespace-normal rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary"
              >
                {p.scanInstead}
              </Button>
            )}
            <Button variant="ghost" onClick={onDone} className="h-12 w-full rounded-xl text-[1.0625rem]">
              {t.common.cancel}
            </Button>
          </SheetActions>
        </>
      )
    }
  }
}
