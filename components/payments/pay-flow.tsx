"use client"

import { useEffect, useRef, useState } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT, useT } from "@/components/i18n-provider"
import { ConnectPanel } from "@/components/payments/connect"
import { EntryOutcome } from "@/components/payments/entry-outcome"
import { OutcomeHeader } from "@/components/payments/entry-status"
import { useFormat } from "@/components/payments/format"
import { LearnMore } from "@/components/payments/learn-more"
import { problemText } from "@/components/payments/problem"
import { SheetActions } from "@/components/payments/sheet-actions"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import type { PayEndpoint } from "@/lib/nostr/ext/lnurl"
import { getSigner } from "@/lib/profile/session"
import { useEuroRate, useJournal, useWallet } from "@/lib/payments/hooks"
import { addressInvoice, InvoiceError, scanKind, scannedInvoice } from "@/lib/payments/invoices"
import { blockingEntry, isDone, pay, type Counterpart, type InvoiceSource } from "@/lib/payments/journal"
import { lookupRecipient } from "@/lib/payments/recipient"
import { capabilities, withWallet } from "@/lib/payments/wallet"
import { zapInvoice } from "@/lib/payments/zap"

// Paying someone (PLAN.md "Bezahlen und Empfangen im Spiel"): who and how much, from which wallet
// and at what fees, are on screen before the one button that pays ("Bestätigung erforderlich").
// The invoice comes from the person's Lightning address, or is scanned from their device
// ("Geld empfangen"); it is checked before anything is paid, and the journal
// (lib/payments/journal.ts) makes sure an action is never paid twice. "Zahlung läuft" shows only
// once the wallet has the payment; until then it can be cancelled and nothing is paid. Afterwards
// the outcome stays on screen, followed in the journal.

export type PayRoute =
  // The other player shows an invoice; this device scans it.
  | { kind: "scan" }
  | { kind: "address"; address: string; endpoint: PayEndpoint }
  // A public congratulation (NIP-57), signed by the profile.
  | { kind: "zap"; address: string; endpoint: PayEndpoint; comment: string }

type Step =
  | { kind: "route" }
  | { kind: "scan"; problem?: string }
  | { kind: "review"; scanned?: string; amountMsat: number; problem?: string }
  // Confirmed at `since` (ms): the invoice is asked for (`fetching`) and the wallet opened, then
  // the wallet pays.
  | { kind: "paying"; since: number; fetching: boolean }
  | { kind: "outcome"; id: string }
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
  amountSats,
  route: givenRoute,
  onDone,
}: {
  action: string
  once: boolean
  counterpart: Counterpart
  // The agreed amount; null pays what a scanned invoice asks, after showing it.
  amountSats: number | null
  route?: PayRoute
  onDone: () => void
}) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const p = tx.pay
  const format = useFormat()
  const wallet = useWallet()
  const journal = useJournal()
  const euro = useEuroRate()
  const found = useRoute(counterpart, givenRoute)
  const [route, setRoute] = useState<PayRoute | null>(null)
  const [step, setStep] = useState<Step>({ kind: "route" })
  const [reconnect, setReconnect] = useState(false)
  const amountMsat = amountSats === null ? null : amountSats * 1000
  const active = route ?? found?.route ?? null

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
    setStep(active.kind === "scan" || amountMsat === null ? { kind: "scan" } : { kind: "review", amountMsat })
  }, [step.kind, active, amountMsat])

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
    return <EntryOutcome entry={entry} onRetry={() => setStep({ kind: "route" })} onDone={onDone} />
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

  const context = { amount: amountMsat === null ? undefined : format.msat(amountMsat), address: active && active.kind !== "scan" ? active.address : undefined }

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
      const result = await withWallet((client) => pay({ action, once, counterpart, invoice: () => source(review), signal: controller.signal }, client))
      setStep(result === "busy" ? { kind: "busy" } : { kind: "outcome", id: result.id })
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
      setStep({ kind: "review", scanned: text, amountMsat: checked.amountMsat })
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
      const amount = format.msat(step.amountMsat)
      const zap = active?.kind === "zap"
      return (
        <>
          <div ref={reviewTop} className="flex flex-col items-center text-center">
            <Avatar seed={counterpart.pubkey ?? counterpart.name} name={counterpart.name} size={56} />
            <p className="mt-2 text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{counterpart.name}</p>
            {active && active.kind !== "scan" && !step.scanned && <p className="text-[0.8125rem] text-muted-foreground [overflow-wrap:anywhere]">{p.toAddress(active.address)}</p>}
            <p className="mt-3 font-display text-4xl font-semibold tabular-nums tracking-tight">{amount}</p>
            {euro && <p className="mt-1 text-[0.8125rem] text-muted-foreground">{tx.euro(format.euros(step.amountMsat / 1000, euro.rate), format.time(euro.at))}</p>}
          </div>
          <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            <ListRow title={p.fromWallet} value={wallet.alias ?? tx.yourWallet} />
            <ListRow title={p.fees} value={p.feesUnknown} />
          </div>
          {zap ? (
            <InlineStatus className="mt-3">{tx.congratulate.publicHint(counterpart.name)}</InlineStatus>
          ) : (
            <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{tx.explain.pay(counterpart.name)}</p>
          )}
          <div className="mt-3">
            <LearnMore inline />
          </div>
          {step.problem && (
            <InlineStatus tone="error" className="mt-3">
              {step.problem}
            </InlineStatus>
          )}
          <SheetActions>
            <Button onClick={() => void confirm(step)} className="h-auto min-h-12 w-full whitespace-normal rounded-xl py-2 text-[1.0625rem] font-semibold">
              {zap ? tx.congratulate.send(amount, counterpart.name) : p.confirm(amount, counterpart.name)}
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
