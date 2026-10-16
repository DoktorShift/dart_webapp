"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { InlineStatus } from "@/components/common/inline-status"
import { QRCodeView } from "@/components/common/qr-code-view"
import { ShareActions } from "@/components/common/share-actions"
import { Button } from "@/components/ui/button"
import { useAreaT, useT } from "@/components/i18n-provider"
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
import { cn } from "@/lib/utils"

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

// An invoice this device shows, and what became of it, with the buttons that end the step. `info`
// is the wallet connected now (none after "Verbindung entfernen"). `onNew` offers a new invoice
// once it expired.
export function InvoiceView({ entry, info, onNew, onDone }: { entry: PaymentEntry; info: WalletInfo | null; onNew?: () => void; onDone: () => void }) {
  const t = useT()
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
  // "Fertig": filled where it confirms an outcome, plain where it only closes the sheet.
  const done = (primary: boolean) => (
    <Button variant={primary ? "default" : "ghost"} onClick={onDone} className={cn("h-12 w-full rounded-xl text-[1.0625rem]", primary && "font-semibold")}>
      {t.common.done}
    </Button>
  )

  if (entry.state === "received") {
    return (
      <>
        <OutcomeHeader tone="success" title={entry.resolvedByHand ? tx.state.receivedByHand : tx.state.received} text={entry.resolvedByHand ? tx.byHand.note : r.receivedText(amount)} />
        <SheetActions>{done(true)}</SheetActions>
      </>
    )
  }
  if (entry.state === "expired") {
    return (
      <>
        <OutcomeHeader tone="neutral" title={entry.resolvedByHand ? tx.state.notReceivedByHand : tx.state.expired} text={entry.resolvedByHand ? tx.byHand.note : r.expiredText} />
        <SheetActions>
          {onNew && (
            <Button onClick={onNew} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
              {r.again}
            </Button>
          )}
          {done(!onNew)}
        </SheetActions>
      </>
    )
  }
  // Ran out while waiting, and no connection here can ask whether it was paid before.
  if (expired && !own?.lookup) {
    return (
      <>
        <OutcomeHeader tone="neutral" title={tx.state.expired} text={r.expiredUnchecked} />
        <ResolveByHand entry={entry} />
        <SheetActions>{done(false)}</SheetActions>
      </>
    )
  }
  const link = `lightning:${entry.invoice}`
  return (
    <>
      {/* The status stays above the code, in view without scrolling; on a phone in landscape the
          code sits beside the amount and the status, its column wide enough for 160 px of code
          inside the card's padding (enough to scan). */}
      <div className="flex flex-col items-center xshort:grid xshort:grid-cols-[11.5rem_minmax(0,1fr)] xshort:items-start xshort:gap-x-4">
        <div className="flex flex-col items-center text-center xshort:col-start-2 xshort:items-start xshort:text-left">
          <p className="font-display text-4xl font-semibold tabular-nums tracking-tight">{amount}</p>
          <StatusLabel tone="progress" className="mt-1 text-[0.9375rem] font-medium">
            {tx.state.waiting}
          </StatusLabel>
          {offline && (
            <InlineStatus tone="error" className="mt-3 w-full text-left">
              {tx.problem.unreachable}
            </InlineStatus>
          )}
        </div>
        <QRCodeView
          value={link}
          label={r.qrLabel(amount)}
          caption={entry.counterpart.name ? r.show(entry.counterpart.name) : r.showAnyone}
          className="mt-4 w-full max-w-[min(18rem,42dvh)] xshort:col-start-1 xshort:row-span-2 xshort:row-start-1 xshort:mt-0 xshort:max-w-none"
        />
        <ShareActions url={link} copyLabel={r.copy} className="mt-4 w-full max-w-xs xshort:col-start-2 xshort:mt-3" />
      </div>
      {follows ? (
        <p className="mt-3 px-4 text-center text-[0.8125rem] leading-snug text-muted-foreground">{r.keepOpen}</p>
      ) : (
        <ResolveByHand entry={entry} hint={info === null ? r.noWallet : own ? r.noStatus : r.otherWallet} />
      )}
      {/* Nothing is pending on this side, so on a phone in landscape the button may scroll. */}
      <SheetActions className="xshort:static">{done(false)}</SheetActions>
    </>
  )
}

// Receiving for an action (the stake of a game, or any amount): shows the invoice already out
// for it, or makes one. Connecting a wallet first happens right here.
export function ReceiveFlow({ action, once, counterpart, amountSats, onDone }: { action: string; once: boolean; counterpart: Counterpart; amountSats: number | null; onDone: () => void }) {
  const t = useT()
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
  const canReceive = !!wallet && capabilities(wallet).receive

  const create = useCallback(async () => {
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
  }, [action, amount, counterpart, once, r.offline, tx])

  // An agreed amount leaves nothing to decide: the invoice is made as soon as the sheet opens
  // (once the journal shows there is none yet), and again only on request.
  const atOnce = amountSats !== null && !startOver
  const started = useRef(false)
  useEffect(() => {
    if (!atOnce || started.current || journal === undefined || current || !canReceive) return
    started.current = true
    void create()
  }, [atOnce, journal, current, canReceive, create])

  if (wallet === undefined || journal === undefined) return null
  if (current && !(current.state === "expired" && startOver)) return <InvoiceView entry={current} info={wallet} onNew={() => setStartOver(true)} onDone={onDone} />
  if (!wallet || reconnect) return <ConnectPanel titled onConnected={() => setReconnect(false)} onCancel={onDone} />
  const cancel = (
    <Button variant="ghost" onClick={onDone} className="h-12 w-full rounded-xl text-[1.0625rem]">
      {t.common.cancel}
    </Button>
  )
  if (!canReceive) {
    return (
      <>
        <InlineStatus>{tx.wallet.cantReceive}</InlineStatus>
        <SheetActions>
          <Button variant="secondary" onClick={() => setReconnect(true)} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold text-primary">
            {tx.wallet.reconnect}
          </Button>
          {cancel}
        </SheetActions>
      </>
    )
  }

  return (
    <>
      {amountSats === null ? (
        <AmountPicker label={r.amount} presets={AMOUNT_PRESETS} value={amount} onChange={setAmount} />
      ) : (
        <div className="flex flex-col items-center text-center">
          <p className="font-display text-4xl font-semibold tabular-nums tracking-tight">{format.sats(amountSats)}</p>
          {creating && (
            <StatusLabel tone="progress" className="mt-1 text-[0.9375rem] font-medium">
              {r.creating}
            </StatusLabel>
          )}
        </div>
      )}
      <p className="mt-3 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{tx.explain.receive}</p>
      <SheetActions note={problem && <InlineStatus tone="error">{problem}</InlineStatus>}>
        {(!atOnce || problem) && (
          <Button onClick={create} disabled={amount === null || creating} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {creating ? r.creating : r.create}
          </Button>
        )}
        {cancel}
      </SheetActions>
    </>
  )
}
