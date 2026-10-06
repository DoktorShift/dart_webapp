"use client"

import { useEffect, useState } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { QRCodeView } from "@/components/common/qr-code-view"
import { ShareActions } from "@/components/common/share-actions"
import { Button } from "@/components/ui/button"
import { useAreaT } from "@/components/i18n-provider"
import { AmountPicker } from "@/components/payments/amount-picker"
import { ConnectPanel } from "@/components/payments/connect"
import { OutcomeHeader, StatusLabel } from "@/components/payments/entry-status"
import { useFormat } from "@/components/payments/format"
import { problemText } from "@/components/payments/problem"
import { ResolveByHand, useHasExpired } from "@/components/payments/resolve-by-hand"
import { SheetActions } from "@/components/payments/sheet-actions"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
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
// seconds, and again whenever the app comes back to the screen. Only the connection that made the
// invoice can tell; where none can, the person settles it from what their wallet shows.

// How often to ask the wallet while an invoice is shown; with notifications only as a safety net.
const POLL_MS = 5000
const POLL_WITH_NOTIFICATIONS_MS = 30_000

// Follows the invoice `id` while it waits to be paid, through one open connection that hears of
// its payment (`notifies`) or asks about it (`lookup`); with neither it isn't followed. One check
// at a time, the next planned when it is done, so a slow wallet never gets a second connection.
// True while the wallet can't be reached.
function useWatchIncoming(id: string, notifies: boolean, lookup: boolean) {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (!notifies && !lookup) return
    let stopped = false
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let client: WalletClient | null = null
    let stopListening = () => {}
    const disconnect = () => {
      stopListening()
      stopListening = () => {}
      client?.close()
      client = null
    }
    const check = async () => {
      if (stopped || running || document.hidden) return
      running = true
      clearTimeout(timer)
      try {
        if (!client) {
          const opened = await openWallet()
          if (stopped) return opened.close()
          client = opened
          if (notifies) stopListening = opened.onPaymentReceived((hash) => hash === id && void markReceived(hash))
        }
        if (lookup) await checkStatus(id, client)
        if (!stopped) setOffline(false)
      } catch {
        disconnect()
        if (!stopped) setOffline(true)
      } finally {
        running = false
        if (!stopped) timer = setTimeout(check, notifies ? POLL_WITH_NOTIFICATIONS_MS : POLL_MS)
      }
    }
    void check()
    const onVisible = () => void check()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
      disconnect()
    }
  }, [id, notifies, lookup])
  return offline
}

// An invoice this device shows, and what became of it. `info` is the wallet connected now (none
// after "Verbindung entfernen"). `onNew` offers a new one once it expired.
export function InvoiceView({ entry, info, onNew }: { entry: PaymentEntry; info: WalletInfo | null; onNew?: () => void }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const r = tx.receive
  const format = useFormat()
  // Only the connection that made the invoice hears of its payment or can ask about it.
  const own = info !== null && info.connection === entry.connection ? capabilities(info) : null
  const follows = !!own && (own.notifies || own.lookup)
  const waiting = entry.state === "waiting"
  const offline = useWatchIncoming(entry.id, waiting && !!own?.notifies, waiting && !!own?.lookup)
  const expired = useHasExpired(entry)
  const amount = format.msat(entry.amountMsat)

  if (entry.state === "received") {
    return <OutcomeHeader tone="success" title={entry.resolvedByHand ? tx.state.receivedByHand : tx.state.received} text={entry.resolvedByHand ? tx.byHand.note : r.receivedText(amount)} />
  }
  if (entry.state === "expired") {
    return (
      <>
        <OutcomeHeader tone="neutral" title={entry.resolvedByHand ? tx.state.notReceivedByHand : tx.state.expired} text={entry.resolvedByHand ? tx.byHand.note : r.expiredText} />
        {onNew && (
          <Button onClick={onNew} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {r.again}
          </Button>
        )}
      </>
    )
  }
  // Ran out while waiting, and no connection here can ask whether it was paid before.
  if (expired && !own?.lookup) {
    return (
      <>
        <OutcomeHeader tone="neutral" title={tx.state.expired} text={r.expiredUnchecked} />
        <ResolveByHand entry={entry} />
      </>
    )
  }
  const link = `lightning:${entry.invoice}`
  return (
    <div className="flex flex-col items-center">
      <p className="font-display text-4xl font-semibold tabular-nums tracking-tight">{amount}</p>
      <StatusLabel tone="progress" className="mt-1 text-[0.9375rem] font-medium">
        {tx.state.waiting}
      </StatusLabel>
      {/* Small enough on a short screen that the status and the actions stay near it. */}
      <QRCodeView value={link} label={r.qrLabel(amount)} caption={entry.counterpart.name ? r.show(entry.counterpart.name) : r.showAnyone} className="mt-4 w-full max-w-[min(18rem,42dvh)]" />
      {offline && (
        <InlineStatus tone="error" className="mt-3 w-full">
          {tx.problem.unreachable}
        </InlineStatus>
      )}
      {!follows && <InlineStatus className="mt-3 w-full">{own ? r.noStatus : r.otherWallet}</InlineStatus>}
      <ShareActions url={link} copyLabel={r.copy} className="mt-4 w-full max-w-xs" />
      {follows ? (
        <p className="mt-3 px-4 text-center text-[0.8125rem] leading-snug text-muted-foreground">{r.keepOpen}</p>
      ) : (
        <div className="w-full">
          <ResolveByHand entry={entry} />
        </div>
      )}
    </div>
  )
}

// Receiving for an action (the stake of a game, or any amount): shows the invoice already out
// for it, or makes one. Connecting a wallet first happens right here.
export function ReceiveFlow({ action, once, counterpart, amountSats }: { action: string; once: boolean; counterpart: Counterpart; amountSats: number | null }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  const r = tx.receive
  const format = useFormat()
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
  if (current && !(current.state === "expired" && startOver)) return <InvoiceView entry={current} info={wallet} onNew={() => setStartOver(true)} />
  if (!wallet || reconnect) return <ConnectPanel titled onConnected={() => setReconnect(false)} />
  if (!capabilities(wallet).receive) {
    return (
      <>
        <InlineStatus>{tx.wallet.cantReceive}</InlineStatus>
        <Button variant="secondary" onClick={() => setReconnect(true)} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold text-primary">
          {tx.wallet.reconnect}
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
      setProblem(offline ? r.offline : problemText(tx, error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {amountSats === null ? (
        <AmountPicker label={r.amount} presets={AMOUNT_PRESETS} value={amount} onChange={setAmount} />
      ) : (
        <p className="text-center font-display text-4xl font-semibold tabular-nums tracking-tight">{format.sats(amountSats)}</p>
      )}
      <p className="mt-3 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{tx.explain.receive}</p>
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
