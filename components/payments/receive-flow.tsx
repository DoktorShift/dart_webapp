"use client"

import { useEffect, useState } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { QRCodeView } from "@/components/common/qr-code-view"
import { ShareActions } from "@/components/common/share-actions"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/i18n-provider"
import { AmountPicker } from "@/components/payments/amount-picker"
import { ConnectPanel } from "@/components/payments/connect"
import { OutcomeHeader, StatusLabel } from "@/components/payments/entry-status"
import { formatMsat, formatSats } from "@/components/payments/format"
import { problemText } from "@/components/payments/problem"
import { SheetActions } from "@/components/payments/sheet-actions"
import { WalletError, type WalletClient } from "@/lib/nostr/wallet"
import { useJournal, useWallet } from "@/lib/payments/hooks"
import { makeIncoming } from "@/lib/payments/invoices"
import { checkStatus, markReceived, type Counterpart, type PaymentEntry } from "@/lib/payments/journal"
import { AMOUNT_PRESETS } from "@/lib/payments/stake"
import { capabilities, openWallet, type WalletInfo } from "@/lib/payments/wallet"

// "Geld empfangen" (PLAN.md "Bezahlen und Empfangen im Spiel"): the wallet makes an invoice for
// the amount, shown as a code to scan or shared; "Warte auf Zahlung" until the wallet confirms it,
// and only then "Erhalten". Without background messages (decision 0001 F8) this works while the
// app is open: the wallet's notification when it sends one, otherwise asking it every few
// seconds, and again whenever the app comes back to the screen.

// How often to ask the wallet while an invoice is shown; with notifications only as a safety net.
const POLL_MS = 5000
const POLL_WITH_NOTIFICATIONS_MS = 30_000

// Follows an invoice that is waiting to be paid. True while the wallet can't be reached.
function useWatchIncoming(entry: PaymentEntry, info: WalletInfo) {
  const [offline, setOffline] = useState(false)
  const waiting = entry.state === "waiting"
  const { notifies, lookup } = capabilities(info)
  useEffect(() => {
    if (!waiting || (!notifies && !lookup)) return
    let stopped = false
    let client: WalletClient | null = null
    let stopListening = () => {}
    const check = async () => {
      if (stopped || document.hidden) return
      try {
        if (!client) {
          client = await openWallet()
          if (stopped) return client.close()
          if (notifies) stopListening = client.onPaymentReceived((hash) => hash === entry.id && void markReceived(hash))
        }
        if (lookup) await checkStatus(entry.id, client)
        setOffline(false)
      } catch {
        stopListening()
        client?.close()
        client = null
        setOffline(true)
      }
    }
    void check()
    const timer = setInterval(check, notifies ? POLL_WITH_NOTIFICATIONS_MS : POLL_MS)
    const onVisible = () => void check()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      stopListening()
      client?.close()
    }
  }, [entry.id, waiting, notifies, lookup])
  return offline
}

// An invoice this device shows, and what became of it. `onNew` offers a new one once it expired.
export function InvoiceView({ entry, info, onNew }: { entry: PaymentEntry; info: WalletInfo; onNew?: () => void }) {
  const t = useT()
  const r = t.payments.receive
  const offline = useWatchIncoming(entry, info)
  const amount = formatMsat(t, entry.amountMsat)
  const { notifies, lookup } = capabilities(info)

  if (entry.state === "received") return <OutcomeHeader tone="success" title={t.payments.state.received} text={r.receivedText(amount)} />
  if (entry.state === "expired") {
    return (
      <>
        <OutcomeHeader tone="neutral" title={t.payments.state.expired} text={r.expiredText} />
        {onNew && (
          <Button onClick={onNew} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {r.again}
          </Button>
        )}
      </>
    )
  }
  const link = `lightning:${entry.invoice}`
  return (
    <div className="flex flex-col items-center">
      <p className="font-display text-4xl font-semibold tabular-nums tracking-tight">{amount}</p>
      <StatusLabel tone="progress" className="mt-1 text-[0.9375rem] font-medium">
        {t.payments.state.waiting}
      </StatusLabel>
      {/* Small enough on a short screen that the status and the actions stay near it. */}
      <QRCodeView value={link} label={r.qrLabel(amount)} caption={entry.counterpart.name ? r.show(entry.counterpart.name) : r.showAnyone} className="mt-4 w-full max-w-[min(18rem,42dvh)]" />
      {offline && (
        <InlineStatus tone="error" className="mt-3 w-full">
          {t.payments.problem.unreachable}
        </InlineStatus>
      )}
      {!notifies && !lookup && (
        <InlineStatus className="mt-3 w-full">{r.noStatus}</InlineStatus>
      )}
      <ShareActions url={link} copyLabel={r.copy} className="mt-4 w-full max-w-xs" />
      <p className="mt-3 px-4 text-center text-[0.8125rem] leading-snug text-muted-foreground">{r.keepOpen}</p>
    </div>
  )
}

// Receiving for an action (the stake of a game, or any amount): shows the invoice already out
// for it, or makes one. Connecting a wallet first happens right here.
export function ReceiveFlow({ action, once, counterpart, amountSats }: { action: string; once: boolean; counterpart: Counterpart; amountSats: number | null }) {
  const t = useT()
  const r = t.payments.receive
  const wallet = useWallet()
  const journal = useJournal()
  const [amount, setAmount] = useState<number | null>(amountSats)
  const [creating, setCreating] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [reconnect, setReconnect] = useState(false)
  // After an expired invoice, a new one only on request (PLAN.md: erst nach Klärung und neuer Aktion).
  const [startOver, setStartOver] = useState(false)

  const current = journal?.find((entry) => entry.action === action && entry.direction === "in")
  if (wallet === undefined || journal === undefined) return null
  if (!wallet || reconnect) return <ConnectPanel titled onConnected={() => setReconnect(false)} />
  if (current && !(current.state === "expired" && startOver)) return <InvoiceView entry={current} info={wallet} onNew={() => setStartOver(true)} />
  if (!capabilities(wallet).receive) {
    return (
      <>
        <InlineStatus>{t.payments.wallet.cantReceive}</InlineStatus>
        <Button variant="secondary" onClick={() => setReconnect(true)} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold text-primary">
          {t.payments.wallet.reconnect}
        </Button>
      </>
    )
  }

  const create = async () => {
    if (amount === null) return
    setCreating(true)
    setProblem(null)
    try {
      const client = await openWallet()
      try {
        await makeIncoming(client, { action, once, counterpart, amountMsat: amount * 1000 })
        setStartOver(false)
      } finally {
        client.close()
      }
    } catch (error) {
      const offline = error instanceof WalletError && (error.code === "unreachable" || error.code === "no-answer")
      setProblem(offline ? r.offline : problemText(t, error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {amountSats === null ? (
        <AmountPicker label={r.amount} presets={AMOUNT_PRESETS} value={amount} onChange={setAmount} />
      ) : (
        <p className="text-center font-display text-4xl font-semibold tabular-nums tracking-tight">{formatSats(t, amountSats)}</p>
      )}
      <p className="mt-3 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{t.payments.explain.receive}</p>
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <SheetActions>
        <Button onClick={create} disabled={amount === null || creating} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {creating ? r.creating : r.create}
        </Button>
      </SheetActions>
    </>
  )
}
